package com.bobmobile

import java.util.concurrent.LinkedBlockingQueue

/** One ordered writer. The byte limit includes the in-flight write, not only queued entries. */
internal class TerminalInputQueue(
    private val sink: (ByteArray) -> Unit,
    private val failed: () -> Unit,
    private val maxBytes: Int = 65536,
    maxItems: Int = 32
) {
    private val lock = Any()
    private val queue = LinkedBlockingQueue<ByteArray>(maxItems)
    private var bytes = 0
    private var closed = false
    private val worker = Thread({
        try {
            while (!Thread.currentThread().isInterrupted) {
                val value = queue.take()
                if (synchronized(lock) { closed }) break
                sink(value)
                synchronized(lock) { bytes -= value.size }
            }
        } catch (_: Exception) {
            val notify = synchronized(lock) { !closed }
            close()
            if (notify) failed()
        }
    }, "BobTerminalInput").apply { isDaemon = true; start() }

    /** False means nothing was queued. Caller must surface saturation, never silently retry. */
    fun offer(value: ByteArray): Boolean = synchronized(lock) {
        if (closed || value.size > maxBytes - bytes) return false
        if (value.isEmpty()) return true
        if (!queue.offer(value)) return false
        bytes += value.size
        true
    }
    fun close() {
        synchronized(lock) { closed = true; queue.clear() }
        worker.interrupt()
    }
}
