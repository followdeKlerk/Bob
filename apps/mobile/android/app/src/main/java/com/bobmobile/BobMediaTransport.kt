package com.bobmobile

import java.io.IOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URI
import java.util.concurrent.atomic.AtomicBoolean

/** Local, bounded reasons only: never forward a URL, response body or credential to the UI. */
internal enum class MediaReadFailure(val message: String) {
    AUTHORIZATION("Cannot authorize this file. Check the paired connection, then retry."),
    IDENTITY("The backend identity changed. Reconnect to it before playing this file."),
    MISSING("This file is no longer available on the backend."),
    RANGE("The backend did not return a valid media range. Retry, or use Open / Save."),
    TIMEOUT("The media connection timed out. Check your connection and retry."),
    NETWORK("The media connection failed. Check your connection and retry.")
}

/** Bounded LRU memory ranges, no file cache, no remote MediaPlayer URL or redirect authority. */
internal class BobMediaTransport(
    private val uri: URI, token: String, private val identity: String, val size: Long,
    private val transfer: (received: Long, fetching: Boolean) -> Unit = { _, _ -> },
    private val connect: (URI) -> HttpURLConnection = { it.toURL().openConnection() as HttpURLConnection }
) : AutoCloseable {
    @Volatile private var bearer = token
    private val closed = AtomicBoolean(false)
    @Volatile private var connection: HttpURLConnection? = null
    private val lock = Any()
    // Only readAt's lock mutates a map. close drops the reference without waiting for I/O.
    @Volatile private var chunks: LinkedHashMap<Long, ByteArray>? = LinkedHashMap(MediaRangePolicy.CACHE_CHUNKS, 0.75f, true)
    @Volatile var failure: MediaReadFailure? = null
        private set
    @Volatile var receivedBytes = 0L
        private set

    private fun report(fetching: Boolean) {
        // Progress is observational. A UI listener must never break or authorize a read.
        if (!closed.get()) try { transfer(receivedBytes, fetching) } catch (_: Exception) {}
    }
    private fun fetch(start: Long, end: Long): ByteArray {
        report(true)
        var current: HttpURLConnection? = null
        try {
            if (closed.get()) throw IOException("Media source closed")
            current = connect(uri)
            connection = current
            current.apply {
                instanceFollowRedirects = false
                useCaches = false
                connectTimeout = 15000; readTimeout = 15000
                setRequestProperty("Authorization", "Bearer $bearer")
                setRequestProperty("x-bob-backend", identity)
                setRequestProperty("Range", "bytes=$start-$end")
                setRequestProperty("Accept-Encoding", "identity")
            }
            if (closed.get()) throw IOException("Media source closed")
            val status = current.responseCode
            failure = when (status) {
                401, 403 -> MediaReadFailure.AUTHORIZATION
                409 -> MediaReadFailure.IDENTITY
                404, 410 -> MediaReadFailure.MISSING
                206 -> null
                else -> MediaReadFailure.RANGE
            }
            try {
                MediaRangePolicy.response(status, current.getHeaderField("Content-Range"), current.contentLengthLong, start, end, size)
                require(current.contentEncoding == null || current.contentEncoding.equals("identity", true))
            } catch (_: Exception) {
                if (failure == null) failure = MediaReadFailure.RANGE
                throw IOException("Invalid authenticated media range")
            }
            val next = ByteArray((end - start + 1).toInt())
            current.inputStream.use { input ->
                var at = 0
                var lastReport = receivedBytes
                while (at < next.size) {
                    if (closed.get()) throw IOException("Media source closed")
                    val count = input.read(next, at, next.size - at)
                    if (count < 0) { failure = MediaReadFailure.RANGE; throw IOException("Incomplete media range") }
                    if (count == 0) continue
                    at += count; receivedBytes += count
                    if (receivedBytes - lastReport >= 65536 || at == next.size) { report(true); lastReport = receivedBytes }
                }
            }
            if (closed.get()) throw IOException("Media source closed")
            return next
        } catch (error: Exception) {
            if (!closed.get() && failure == null) failure = if (error is SocketTimeoutException) MediaReadFailure.TIMEOUT else MediaReadFailure.NETWORK
            // No raw exception cause: Android/media errors can otherwise expose transport headers.
            throw IOException("Cannot read authenticated media range")
        } finally {
            current?.disconnect()
            connection = null
            report(false)
        }
    }
    fun readAt(position: Long, output: ByteArray, offset: Int, requested: Int): Int = synchronized(lock) {
        if (closed.get()) throw IOException("Media source closed")
        if (position < 0 || offset < 0 || requested < 0 || offset > output.size - requested) throw IOException("Invalid media read")
        if (requested == 0) return@synchronized 0
        if (position >= size) return@synchronized -1
        val start = position / MediaRangePolicy.CHUNK_BYTES * MediaRangePolicy.CHUNK_BYTES
        val cache = chunks ?: throw IOException("Media source closed")
        val bytes = cache[start] ?: run {
            // Evict before allocating the next chunk, including its in-flight memory in the cap.
            while (cache.size >= MediaRangePolicy.CACHE_CHUNKS) {
                val oldest = cache.entries.iterator(); oldest.next(); oldest.remove()
            }
            val end = minOf(size - 1, start + MediaRangePolicy.CHUNK_BYTES - 1)
            val next = fetch(start, end)
            if (closed.get()) throw IOException("Media source closed")
            cache[start] = next
            next
        }
        val within = (position - start).toInt()
        val count = minOf(requested, bytes.size - within)
        System.arraycopy(bytes, within, output, offset, count)
        count
    }
    override fun close() {
        closed.set(true)
        bearer = ""
        connection?.disconnect()
        connection = null
        chunks = null
    }
}
