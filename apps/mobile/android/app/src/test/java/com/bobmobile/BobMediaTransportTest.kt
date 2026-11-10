package com.bobmobile

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL

class BobMediaTransportTest {
    private val uri = URI("https://owner.ts.net/v1/chats/7/artifacts/5aaee20e-e260-4403-80da-b97ce80664a1")
    private class Connection(url: URL, private val size: Long, private val status: Int = 206, private val short: Boolean = false) : HttpURLConnection(url) {
        var disconnected = false
        var consumed = 0
        override fun connect() {}
        override fun disconnect() { disconnected = true }
        override fun usingProxy() = false
        private fun bounds() = getRequestProperty("Range").removePrefix("bytes=").split('-').map { it.toLong() }
        override fun getResponseCode() = status
        override fun getHeaderField(name: String?): String? = when (name) {
            "Content-Range" -> bounds().let { "bytes ${it[0]}-${it[1]}/$size" }
            else -> null
        }
        override fun getContentLengthLong() = bounds().let { it[1] - it[0] + 1 }
        override fun getInputStream(): ByteArrayInputStream {
            val bounds = bounds(); val length = if (short) 3 else (bounds[1] - bounds[0] + 1).toInt()
            val bytes = ByteArray(length) { ((bounds[0] + it) % 251).toByte() }
            return object : ByteArrayInputStream(bytes) {
                override fun read(output: ByteArray, offset: Int, count: Int): Int = super.read(output, offset, count).also { if (it > 0) consumed += it }
            }
        }
    }
    @Test fun readsBoundedRangesOnDemandAndNeverPrefetchesWholeFile() {
        val connections = mutableListOf<Connection>(); val size = 8L * 1024 * 1024
        val reader = BobMediaTransport(uri, "owner-secret", "paired", size) { target -> Connection(target.toURL(), size).also { connections.add(it) } }
        val output = ByteArray(4096)
        assertEquals(4096, reader.readAt(0, output, 0, output.size))
        assertEquals(1, connections.size)
        assertEquals(MediaRangePolicy.CHUNK_BYTES, connections[0].consumed)
        assertFalse(connections[0].instanceFollowRedirects); assertFalse(connections[0].useCaches)
        assertEquals("Bearer owner-secret", connections[0].getRequestProperty("Authorization"))
        assertEquals("paired", connections[0].getRequestProperty("x-bob-backend"))
        assertEquals("identity", connections[0].getRequestProperty("Accept-Encoding"))
        assertTrue(connections[0].disconnected)
        assertEquals(4096, reader.readAt(100, output, 0, output.size)); assertEquals(1, connections.size)
        assertArrayEquals(ByteArray(4096) { ((100 + it) % 251).toByte() }, output)
        assertEquals(1, reader.readAt(MediaRangePolicy.CHUNK_BYTES - 1L, output, 0, output.size))
        assertEquals(4096, reader.readAt(4L * MediaRangePolicy.CHUNK_BYTES, output, 0, output.size)); assertEquals(2, connections.size)
        assertEquals(1, reader.readAt(size - 1, output, 0, 4096))
        assertEquals(-1, reader.readAt(size, output, 0, 4096)); assertEquals(0, reader.readAt(size, output, 0, 0))
        assertTrue(connections.sumOf { it.consumed } < size)
        reader.close(); assertThrows(IOException::class.java) { reader.readAt(0, output, 0, output.size) }
    }
    @Test fun redirectsAndFullBodyFallbackFailClosedWithoutConsumingResponse() {
        for (status in listOf(200, 301, 302, 307, 308, 401, 409, 416)) {
            val connection = Connection(uri.toURL(), 1000000, status)
            val reader = BobMediaTransport(uri, "owner-secret", "paired", 1000000) { connection }
            val failure = assertThrows(IOException::class.java) { reader.readAt(0, ByteArray(10), 0, 10) }
            assertFalse(failure.message!!.contains("owner-secret")); assertNull(failure.cause)
            assertEquals(0, connection.consumed); assertTrue(connection.disconnected); reader.close()
        }
    }
    @Test fun truncatedReadsAndInvalidArgumentsAreNotReportedAsPlayableBytes() {
        val connection = Connection(uri.toURL(), 1000000, short = true)
        val reader = BobMediaTransport(uri, "secret", "paired", 1000000) { connection }
        assertThrows(IOException::class.java) { reader.readAt(0, ByteArray(10), 0, 10) }
        assertThrows(IOException::class.java) { reader.readAt(-1, ByteArray(10), 0, 10) }
        assertThrows(IOException::class.java) { reader.readAt(0, ByteArray(10), 5, 10) }; reader.close()
    }
    @Test fun closingPlaybackInterruptsInFlightReadWithoutWaitingForTheReadLock() {
        val entered = java.util.concurrent.CountDownLatch(1)
        val disconnected = java.util.concurrent.CountDownLatch(1)
        val connection = object : HttpURLConnection(uri.toURL()) {
            override fun connect() {}
            override fun disconnect() { disconnected.countDown() }
            override fun usingProxy() = false
            override fun getResponseCode() = 206
            override fun getHeaderField(name: String?): String? = if (name == "Content-Range") "bytes 0-262143/1000000" else null
            override fun getContentLengthLong() = 262144L
            override fun getInputStream() = object : java.io.InputStream() {
                override fun read(): Int = throw IOException("not used")
                override fun read(output: ByteArray, offset: Int, count: Int): Int {
                    entered.countDown()
                    if (!disconnected.await(2, java.util.concurrent.TimeUnit.SECONDS)) throw IOException("cancel timeout")
                    throw IOException("cancelled")
                }
            }
        }
        val reader = BobMediaTransport(uri, "owner-secret", "paired", 1000000) { connection }
        val failure = java.util.concurrent.atomic.AtomicReference<Exception?>()
        val worker = Thread { try { reader.readAt(0, ByteArray(10), 0, 10) } catch (error: Exception) { failure.set(error) } }
        worker.start()
        assertTrue(entered.await(1, java.util.concurrent.TimeUnit.SECONDS))
        reader.close(); worker.join(1000)
        assertFalse("close must not wait for the serialized read lock", worker.isAlive)
        assertTrue(failure.get() is IOException)
    }
    @Test fun reportsActualMonotonicReceivedBytesWithoutInventingBufferPercentages() {
        val reports = mutableListOf<Pair<Long, Boolean>>()
        val size = 3L * 1024 * 1024
        val reader = BobMediaTransport(uri, "fixture-token", "paired", size, transfer = { count, fetching -> reports.add(count to fetching) }) { target -> Connection(target.toURL(), size) }
        val output = ByteArray(512)
        reader.readAt(0, output, 0, output.size)
        assertEquals(0L to true, reports.first())
        assertEquals(MediaRangePolicy.CHUNK_BYTES.toLong() to false, reports.last())
        assertTrue(reports.zipWithNext().all { (a, b) -> b.first >= a.first })
        val count = reports.size
        reader.readAt(100, output, 0, output.size)
        assertEquals("a cache hit is not another transfer", count, reports.size)
        reader.readAt(2L * MediaRangePolicy.CHUNK_BYTES, output, 0, output.size)
        assertEquals(2L * MediaRangePolicy.CHUNK_BYTES, reports.last().first)
        assertTrue(reports.last().first < size)
        reader.close()
    }
    @Test fun interleavedHeaderAudioAndVideoReadsReuseTheirRangesInsteadOfThrashing() {
        val size = 12L * MediaRangePolicy.CHUNK_BYTES
        val connections = mutableListOf<Connection>()
        val reader = BobMediaTransport(uri, "fixture-token", "paired", size) { target -> Connection(target.toURL(), size).also { connections.add(it) } }
        val bytes = ByteArray(128)
        repeat(500) {
            reader.readAt(0, bytes, 0, bytes.size)
            reader.readAt(4L * MediaRangePolicy.CHUNK_BYTES, bytes, 0, bytes.size)
            reader.readAt(8L * MediaRangePolicy.CHUNK_BYTES, bytes, 0, bytes.size)
        }
        assertEquals("1500 alternating reads need three ranges, not 1500", 3, connections.size)
        assertEquals(3 * MediaRangePolicy.CHUNK_BYTES, connections.sumOf { it.consumed })
        reader.close()
    }
    @Test fun cacheIsBoundedAndEvictsTheLeastRecentlyUsedRange() {
        val size = 12L * MediaRangePolicy.CHUNK_BYTES
        val connections = mutableListOf<Connection>()
        val reader = BobMediaTransport(uri, "fixture-token", "paired", size) { target -> Connection(target.toURL(), size).also { connections.add(it) } }
        val bytes = ByteArray(1)
        assertEquals(4, MediaRangePolicy.CACHE_CHUNKS)
        repeat(MediaRangePolicy.CACHE_CHUNKS) { reader.readAt(it.toLong() * MediaRangePolicy.CHUNK_BYTES, bytes, 0, 1) }
        reader.readAt(0, bytes, 0, 1) // Keep the header; chunk 1 becomes least recently used.
        reader.readAt(4L * MediaRangePolicy.CHUNK_BYTES, bytes, 0, 1)
        reader.readAt(0, bytes, 0, 1)
        assertEquals(5, connections.size)
        reader.readAt(MediaRangePolicy.CHUNK_BYTES.toLong(), bytes, 0, 1)
        assertEquals("the evicted chunk must be fetched, not retained without a bound", 6, connections.size)
        reader.close()
        assertThrows(IOException::class.java) { reader.readAt(0, bytes, 0, 1) }
    }
    @Test fun observationsCannotChangeReadAuthorityOrTurnAReadIntoFailure() {
        val size = 1000000L
        val reader = BobMediaTransport(uri, "fixture-token", "paired", size, transfer = { _, _ -> error("UI observer failed") }) { target -> Connection(target.toURL(), size) }
        assertEquals(10, reader.readAt(0, ByteArray(10), 0, 10))
        reader.close()
    }
    @Test fun failuresExposeOnlyBoundedLocalReasonsAndNeverConsumeRejectedBodies() {
        for ((status, expected) in listOf(401 to MediaReadFailure.AUTHORIZATION, 403 to MediaReadFailure.AUTHORIZATION, 409 to MediaReadFailure.IDENTITY, 404 to MediaReadFailure.MISSING, 410 to MediaReadFailure.MISSING, 302 to MediaReadFailure.RANGE, 200 to MediaReadFailure.RANGE)) {
            val connection = Connection(uri.toURL(), 1000000, status)
            val reader = BobMediaTransport(uri, "fixture-secret", "paired", 1000000) { connection }
            val failure = assertThrows(IOException::class.java) { reader.readAt(0, ByteArray(10), 0, 10) }
            assertEquals(expected, reader.failure)
            assertEquals(0, connection.consumed)
            assertFalse(reader.failure!!.message.contains("fixture-secret")); assertFalse(reader.failure!!.message.contains("owner.ts.net"))
            assertNull(failure.cause); reader.close()
        }
    }
    @Test fun socketTimeoutIsNotMisreportedAsAnUnsupportedCodec() {
        val connection = object : HttpURLConnection(uri.toURL()) {
            override fun connect() {}
            override fun disconnect() {}
            override fun usingProxy() = false
            override fun getResponseCode(): Int = throw java.net.SocketTimeoutException("fixture-private-transport-context")
        }
        val reader = BobMediaTransport(uri, "fixture-token", "paired", 1000000) { connection }
        val failure = assertThrows(IOException::class.java) { reader.readAt(0, ByteArray(10), 0, 10) }
        assertEquals(MediaReadFailure.TIMEOUT, reader.failure)
        assertFalse(failure.message!!.contains("fixture-private")); assertNull(failure.cause)
        reader.close()
    }

}
