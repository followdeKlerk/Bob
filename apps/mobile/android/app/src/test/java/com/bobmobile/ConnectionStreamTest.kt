package com.bobmobile

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.net.SocketTimeoutException

class ConnectionStreamTest {
    private val pair = ConnectionPair("b0b00000-0000-4000-8000-000000000001", 42)
    private fun snapshot(content: String = "hello 😀 café 東京") =
        "{\"backendId\":\"${pair.backendId}\",\"conversationId\":42,\"view\":{\"entries\":[{\"text\":\"$content\"}],\"docs\":{}}}"
    private fun patch(old: String, prefix: Int, remove: Int, insert: String, base: Long = 0) =
        "{\"base\":$base,\"sequence\":${base + 1},\"prefix\":$prefix,\"remove\":$remove,\"insert\":\"$insert\",\"length\":${old.length}}"
    private fun reject(code: String = "protocol", block: () -> Unit) {
        try { block(); fail("Accepted invalid stream") } catch (e: ConnectionProtocolException) { assertEquals(code, e.code) }
    }
    private fun reader(text: String, limit: Int = CONNECTION_MAX_CHARS, now: () -> Long = { 0 }) =
        ChatSseReader(ByteArrayInputStream(text.toByteArray()), now, limit)

    @Test fun incrementalUnicodeSseSupportsCrLfCommentsMultilineAndEof() {
        val json = snapshot()
        // Force UTF-8 characters and CRLF boundaries to cross underlying reads.
        val bytes = (": comment\r\n\r\nevent: snapshot\r\ndata: $json\r\n\r\nevent: heartbeat\ndata: {}\n\n").toByteArray()
        val input = object : InputStream() {
            var pos = 0
            override fun read() = if (pos == bytes.size) -1 else bytes[pos++].toInt() and 255
            override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                if (pos == bytes.size) return -1
                val n = minOf(3, length, bytes.size - pos); bytes.copyInto(buffer, offset, pos, pos + n); pos += n; return n
            }
        }
        val r = ChatSseReader(input, { 0 })
        assertEquals(ConnectionFrame("snapshot", json), r.next()); r.received()
        assertEquals(ConnectionFrame("heartbeat", "{}"), r.next()); assertNull(r.next())
        assertEquals(ConnectionFrame("snapshot", "{\n}"), reader("event: snapshot\ndata: {\ndata: }\n\n").next())
        assertNull(reader("event: snapshot\ndata: $json").next())
        for (bad in listOf("data: {}\n\n", "event: phone-tool\ndata: {}\n\n", "id: 1\nevent: snapshot\ndata: {}\n\n", "event: snapshot\n\n", "retry: 0\n\n")) reject { reader(bad).next() }
    }
    @Test fun readerBoundsWholeFramesLinesAndStrictUtf8WithoutCumulativeHistory() {
        reject("overflow") { reader("event: snapshot\ndata: " + "x".repeat(65) + "\n\n", 64).next() }
        reject("overflow") { reader("event: snapshot\n" + "data: x\n".repeat(600) + "\n", 64).next() }
        reject("overflow") { reader(": " + "x".repeat(1100), 64).next() }
        reject("overflow") { reader((": x\n").repeat(600), 64).next() }
        try {
            ChatSseReader(ByteArrayInputStream(byteArrayOf(0xc3.toByte(), 0x28, 10)), { 0 }).next()
            fail("Accepted malformed UTF-8")
        } catch (_: java.nio.charset.CharacterCodingException) {}
        val r = reader(("event: snapshot\ndata: {}\n\n").repeat(20_000), 64)
        repeat(20_000) { assertEquals("{}", r.next()!!.data); r.received() }
        assertNull(r.next()) // Limits are per frame, not time/bytes accumulated over a healthy socket.
    }
    @Test fun heartbeatsMustBeAuthenticatedAndCannotHideMissingInitialSnapshotOrExpiredData() {
        val heartbeat = "{\"backendId\":\"${pair.backendId}\",\"conversationId\":42,\"observedAt\":1700000000000}"
        ChatWire.heartbeat(heartbeat, pair)
        reject("identity") { ChatWire.heartbeat(heartbeat.replace("42", "43"), pair) }
        reject { ChatWire.heartbeat(heartbeat.replace("1700000000000", "null"), pair) }
        val cache = ChatStreamCache(); cache.attempt(); cache.heartbeat(1000)
        assertFalse(cache.healthy(1000)); assertNull(cache.age(1000))
        cache.snapshot(snapshot(), 1000); assertTrue(cache.healthy(1000)); assertTrue(cache.healthy(21_000))
        assertFalse(cache.healthy(21_001)); assertEquals(20_001L, cache.age(21_001))
        cache.heartbeat(22_000); assertTrue(cache.healthy(22_000))
        var now = 0L
        val r = reader(": ping\n\n".repeat(30), now = { now.also { now += 1000 } })
        try { r.next(); fail("Comments kept connection healthy") } catch (_: SocketTimeoutException) {}
    }
    @Test fun aTrickledPartialLineCannotEvadeTheHeartbeatDeadline() {
        var now = 0L
        val input = object : InputStream() {
            override fun read(): Int { now += 1000; return 'x'.code }
            override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                buffer[offset] = read().toByte(); return 1
            }
            override fun available() = 0
        }
        val r = ChatSseReader(input, { now })
        try { r.next(); fail("Partial frame kept a dead stream alive") } catch (_: SocketTimeoutException) {}
        assertTrue(now <= 22_000)
    }
    @Test fun validatesExactIdentityAndRequiredViewOnEveryReconstructedSnapshot() {
        ChatWire.snapshot(snapshot(), pair)
        reject("identity") { ChatWire.snapshot(snapshot().replace(pair.backendId, pair.backendId.uppercase()), pair) }
        reject("identity") { ChatWire.snapshot(snapshot().replace("\"conversationId\":42", "\"conversationId\":43"), pair) }
        reject("identity") { ChatWire.snapshot(snapshot().replace("\"conversationId\":42", "\"conversationId\":\"42\""), pair) }
        reject("identity") { ChatWire.snapshot(snapshot().replace("\"${pair.backendId}\"", "42"), pair) }
        for (bad in listOf(snapshot().replace("\"entries\":[{\"text\":\"hello 😀 café 東京\"}]", "\"entries\":{}"), snapshot().replace("\"docs\":{}", "\"docs\":[]"), snapshot() + "junk", snapshot().replace("\"view\":", "\"view\":null,\"other\":"))) reject { ChatWire.snapshot(bad, pair) }
        reject("overflow") { ChatWire.snapshot(snapshot(), pair, 8) }
        reject { ChatWire.snapshot(snapshot("\\x"), pair) }
        reject { ChatWire.snapshot(snapshot().replace("42,", "42,\"conversationId\":42,"), pair) }
        reject { ChatWire.snapshot(snapshot().replace("\"docs\":{}", "\"docs\":{\"deep\":" + "[".repeat(130) + "0" + "]".repeat(130) + "}"), pair) }
    }
    @Test fun patchesMatchJsUtf16OffsetsIncludingSplitSurrogateAndFullSnapshotSequenceReset() {
        val old = snapshot(); val at = old.indexOf("😀") + 1 // Retain the high surrogate; replace the low surrogate only.
        val p = patch(old, at, 1, "\\ude01")
        val (next, seq) = ChatWire.patch(old, 0, p)
        assertEquals(snapshot().replace("😀", "😁"), next); assertEquals(1L, seq); ChatWire.snapshot(next, pair)
        val (third, thirdSeq) = ChatWire.patch(next, seq, patch(next, next.indexOf("café"), 4, "tea", seq))
        assertTrue(third.contains("tea")); assertEquals(2L, thirdSeq); ChatWire.snapshot(third, pair)
        val full = snapshot("replacement")
        assertEquals(full + " ", ChatWire.patch(full, 0, patch(full, full.length, 0, " ")).first)
        reject { ChatWire.patch(old, 1, p) }
        reject { ChatWire.patch(null, 0, p) }
        reject { ChatWire.patch(old, 0, patch(old, old.length + 1, 0, "")) }
        reject { ChatWire.patch(old, 0, patch(old, old.length, 1, "")) }
        reject { ChatWire.patch(old, 0, p.replace("\"remove\":1", "\"remove\":-1")) }
        reject { ChatWire.patch(old, 0, p.replace("\"base\":0", "\"base\":0.5")) }
        reject { ChatWire.patch(old, 0, p.replace("\"sequence\":1", "\"sequence\":9007199254740992")) }
        val malformed = ChatWire.patch(old, 0, patch(old, 0, 1, "x")).first
        reject { ChatWire.snapshot(malformed, pair) }
        val wrongChat = ChatWire.patch(old, 0, patch(old, old.indexOf(":42") + 1, 2, "43")).first
        reject("identity") { ChatWire.snapshot(wrongChat, pair) }
        reject("overflow") { ChatWire.patch("x".repeat(100), 0, patch("x".repeat(100), 100, 0, "y".repeat(200)), 256) }
    }
    @Test fun staleLocalReadThenHeartbeatPublishesRecoveryWithoutSnapshotRevisionOrSocketRotation() {
        val cache = ChatStreamCache(); cache.attempt(); cache.snapshot(snapshot(), 1000)
        val revision = cache.revision; val epoch = cache.epoch
        assertFalse(cache.healthy(21_001)) // readStream must return reconnecting, without touching transport.
        assertTrue(cache.heartbeat(22_000)) // Invalidate even if internal transport status stayed connected.
        assertTrue(cache.healthy(22_000)); assertEquals(revision, cache.revision); assertEquals(epoch, cache.epoch)
        assertFalse(cache.heartbeat(25_000)) // Ordinary healthy heartbeats must not churn React/Settings.
        assertFalse(cache.healthy(45_001)); assertTrue(cache.snapshot(snapshot(), 46_000))
    }
    @Test fun settingsStateInvalidationsCoalesceWhilePausedAndFlushOnlyLatestOnResume() {
        val state = ChatStateInvalidation(); val other = pair.copy(chat = 43)
        state.lifecycle(true); state.changed(pair); assertEquals(pair, state.take()); assertNull(state.take())
        state.lifecycle(false)
        repeat(100_000) { state.changed(if (it % 2 == 0) pair else other); assertNull(state.take()) }
        state.lifecycle(true); assertEquals(other, state.take()); assertNull(state.take())
        state.changed(pair); state.changed(other); assertEquals(other, state.take())
        state.lifecycle(false); state.changed(pair); state.detach(); state.lifecycle(true); assertNull(state.take())
    }
    @Test fun latestOnlyCacheSurvivesRetryButNotRetirementAndCountersNeverReset() {
        val cache = ChatStreamCache(); cache.attempt(); assertEquals(1L, cache.epoch)
        repeat(10_000) { cache.snapshot("snapshot-$it", it.toLong()) }
        assertEquals("snapshot-9999", cache.snapshot); assertEquals(10_000L, cache.revision)
        cache.disconnected(); assertEquals("snapshot-9999", cache.snapshot); assertFalse(cache.healthy(10_000))
        cache.attempt(); cache.heartbeat(10_000); assertEquals(2L, cache.epoch); assertFalse(cache.healthy(10_000))
        cache.snapshot("fresh", 10_001); assertTrue(cache.healthy(10_001)); assertEquals(10_001L, cache.revision)
        cache.clear(); assertNull(cache.snapshot); assertEquals(10_001L, cache.revision); assertEquals(2L, cache.epoch)
        cache.attempt(); assertEquals(3L, cache.epoch)
    }
    @Test fun observerCoalescesUntilAckSuppressesPauseAndInvalidatesOnceOnResume() {
        val observer = ChatStreamObserver(); observer.lifecycle(true); observer.read(pair, "one", true)
        repeat(1000) { observer.changed(pair) }
        assertEquals(StreamObserver(pair, "one"), observer.take()); assertNull(observer.take())
        repeat(1000) { observer.changed(pair) }; assertNull(observer.take())
        observer.read(pair, "one", true); assertNull(observer.take())
        observer.changed(pair); assertEquals("one", observer.take()!!.id)
        observer.lifecycle(false); repeat(1000) { observer.changed(pair) }; assertNull(observer.take())
        observer.lifecycle(true); assertEquals("one", observer.take()!!.id); assertNull(observer.take())
        observer.read(pair, "two", true); observer.release("one"); observer.changed(pair)
        assertEquals("two", observer.take()!!.id)
        observer.release("two"); observer.changed(pair); assertNull(observer.take())
    }
    @Test fun observerSelectionReplacementAndOldReleaseCannotStealNewObserver() {
        val observer = ChatStreamObserver(); val other = pair.copy(chat = 43)
        observer.lifecycle(true); observer.read(pair, "old", true)
        observer.read(other, "wrong-selection", false); observer.changed(pair)
        assertEquals("old", observer.take()!!.id)
        observer.read(other, "new", true); observer.release("old"); observer.changed(pair); assertNull(observer.take())
        observer.changed(other); assertEquals("new", observer.take()!!.id)
        observer.read(other, "new", false); assertNull(observer.take()) // ACK still works after deselection.
        observer.detach(); observer.lifecycle(true); observer.changed(other); assertNull(observer.take())
    }
    @Test fun wakeLeaseIsTimedWorkerRenewedGenerationOwnedAndAlwaysCleanable() {
        val acquisitions = mutableListOf<Long>(); var releases = 0
        val lease = ConnectionWakeLease({ acquisitions.add(it) }, { releases++ })
        lease.activity(1, 0); assertEquals(listOf(120_000L), acquisitions)
        lease.activity(1, 29_999); assertEquals(1, acquisitions.size)
        lease.activity(1, 30_000); assertEquals(2, acquisitions.size)
        lease.activity(2, 30_001); assertEquals(1, releases); assertEquals(3, acquisitions.size)
        lease.clear(1); assertEquals(1, releases) // Late old-generation cleanup cannot release the new lease.
        lease.clear(2); lease.clear(); assertEquals(2, releases)
        for (reason in listOf("stop", "revoke", "fail", "retire", "destroy")) {
            lease.activity(3, 60_000); lease.clear(); assertTrue(reason, acquisitions.all { it == 120_000L })
        }
        assertEquals(7, releases)
    }
}
