package com.bobmobile

import android.os.ParcelFileDescriptor
import android.util.Base64
import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Exactly one local process. Callbacks are always checked against the owning view's admission. */
internal class TerminalClient(
    private val render: (String, Long) -> Unit,
    private val ended: (Boolean) -> Unit
) {
    private val closed = AtomicBoolean(false)
    private val ioLock = Any()
    private var childHandle = -1
    private var writer: TerminalInputQueue? = null
    private var master: ParcelFileDescriptor? = null
    private var input: InputStream? = null
    private var output: OutputStream? = null
    @Volatile private var outputAck: Pair<Long, CountDownLatch>? = null

    fun start(executable: String, config: BobTerminalConfig) {
        val launched = BobTerminalPty.spawn(executable, config.host, config.port, config.key)
        check(launched.size == 2 && launched[0] > 0 && launched[1] >= 0)
        childHandle = launched[0]
        val child = childHandle
        Thread({ BobTerminalPty.waitFor(child) }, "BobTerminalWait").start()
        master = ParcelFileDescriptor.adoptFd(launched[1])
        input = ParcelFileDescriptor.AutoCloseInputStream(ParcelFileDescriptor.dup(master!!.fileDescriptor))
        output = ParcelFileDescriptor.AutoCloseOutputStream(ParcelFileDescriptor.dup(master!!.fileDescriptor))
        val stream = output!!
        writer = TerminalInputQueue({ bytes -> stream.write(bytes); stream.flush() }, { ended(true) })
        val reader = input!!
        Thread({
            val buffer = ByteArray(8192)
            var sequence = 0L
            var failed = false
            try {
                while (!closed.get()) {
                    val count = reader.read(buffer)
                    if (count < 0) break
                    val ack = CountDownLatch(1)
                    val ticket = ++sequence
                    outputAck = ticket to ack
                    if (closed.get()) break
                    render(Base64.encodeToString(buffer, 0, count, Base64.NO_WRAP), ticket)
                    // One chunk at a time, acknowledged by xterm's parser, not just evaluateJavascript.
                    if (!ack.await(5, TimeUnit.SECONDS)) { failed = true; break }
                    outputAck = null
                }
            } catch (_: Exception) { failed = true }
            if (!closed.get()) ended(failed)
        }, "BobTerminalRead").start()
    }
    fun acknowledge(ticket: Long) { outputAck?.takeIf { it.first == ticket }?.second?.countDown() }
    fun send(value: String): Boolean = !closed.get() && writer?.offer(value.toByteArray(Charsets.UTF_8)) == true
    fun resize(cols: Int, rows: Int) {
        if (cols !in 2..500 || rows !in 1..300) return
        synchronized(ioLock) { master?.let { if (!closed.get()) BobTerminalPty.resize(it.fd, cols, rows) } }
    }
    fun close() {
        if (!closed.compareAndSet(false, true)) return
        outputAck?.second?.countDown(); outputAck = null
        // Stop before closing streams: wake any blocked read/write. Never signal a raw PID.
        if (childHandle > 0) BobTerminalPty.stop(childHandle)
        childHandle = -1
        writer?.close(); writer = null
        synchronized(ioLock) {
            try { input?.close() } catch (_: Exception) {}
            try { output?.close() } catch (_: Exception) {}
            try { master?.close() } catch (_: Exception) {}
            input = null; output = null; master = null
        }
    }
}
