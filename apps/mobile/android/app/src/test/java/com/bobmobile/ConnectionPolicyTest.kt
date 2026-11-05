package com.bobmobile

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.net.SocketTimeoutException

class ConnectionPolicyTest {
    private val id = "b0b00000-0000-4000-8000-000000000001"
    private val other = "b0b00000-0000-4000-8000-000000000002"
    private val pair = ConnectionPair(id, 42)
    private fun payload(backend: String = id, chat: String = "42", state: String = "idle", observed: String = "1700000000000") =
        "{\"backendId\":\"$backend\",\"conversationId\":$chat,\"state\":\"$state\",\"observedAt\":$observed}"
    private fun reader(value: String, now: () -> Long = { 0L }) = ConnectionSseReader(ByteArrayInputStream(value.toByteArray()), now)
    private fun rejects(code: String? = null, action: () -> Unit) {
        try { action(); fail("Accepted malformed status metadata") }
        catch (e: ConnectionProtocolException) { if (code != null) assertEquals(code, e.code) }
    }
    @Test fun strictIdentityTokenAndSafePositiveChat() {
        assertEquals(id, ConnectionPolicy.identity(id.uppercase()))
        for (value in listOf("1-1-1-1-1", "$id\n", "not-a-uuid", "")) {
            try { ConnectionPolicy.identity(value); fail(value) } catch (_: IllegalArgumentException) {}
        }
        for (value in listOf(0.0, -1.0, 0.5, 1.5, Double.NaN, Double.POSITIVE_INFINITY, 9007199254740992.0)) {
            try { ConnectionPolicy.chat(value); fail(value.toString()) } catch (_: IllegalArgumentException) {}
        }
        assertEquals(9007199254740991L, ConnectionPolicy.chat(9007199254740991.0))
        ConnectionPolicy.token("a_".repeat(16))
        for (value in listOf("a".repeat(31), "a".repeat(129), "a".repeat(32) + "\r\nx-header: no", "")) {
            try { ConnectionPolicy.token(value); fail("Accepted invalid token") } catch (_: IllegalArgumentException) {}
        }
    }
    @Test fun readOnlyStatusValidatesIdentityAndFlatExactShape() {
        for (state in listOf("idle", "working", "waiting")) assertEquals(state, ConnectionPolicy.heartbeat(payload(state = state), pair))
        assertEquals("idle", ConnectionPolicy.heartbeat(" { \"state\":\"idle\",\"observedAt\":1700000000000,\"conversationId\":42,\"backendId\":\"$id\" } ", pair))
        rejects("identity") { ConnectionPolicy.heartbeat(payload(backend = other), pair) }
        rejects("identity") { ConnectionPolicy.heartbeat(payload(chat = "43"), pair) }
        rejects("identity") { ConnectionPolicy.heartbeat(payload(chat = "\"42\""), pair) }
        rejects("identity") { ConnectionPolicy.heartbeat(payload(backend = "1-1-1-1-1"), pair) }
        for (bad in listOf(payload(state = "tool"), payload(observed = "0"), payload(observed = "null"), payload(observed = "9007199254740992"),
            payload().replace("}", ",\"text\":\"private\"}"), payload().replace("}", ",\"state\":\"idle\"}"),
            payload().replace("1700000000000", "{}"), payload() + "garbage", "{}", "[]", payload().replace("\"idle\"", "\"\\x01\""))) {
            rejects { ConnectionPolicy.heartbeat(bad, pair) }
        }
    }
    @Test fun sseSupportsMultipleEventsCommentsCrLfAndMultilineDataWithoutReplay() {
        val json = payload()
        val stream = reader(": private status only\r\n\r\nevent: connection\r\ndata: $json\r\n\r\nevent: connection\ndata: ${payload(state = "working")}\n\n")
        assertEquals(json, stream.next()); stream.heartbeatReceived()
        assertEquals("working", ConnectionPolicy.heartbeat(stream.next()!!, pair)); assertNull(stream.next())
        val split = payload().replace(",\"state\"", ",\ndata: \"state\"")
        assertEquals("idle", ConnectionPolicy.heartbeat(reader("event: connection\ndata: $split\n\n").next()!!, pair))
        assertNull(reader("event: connection\ndata: $json").next()) // EOF never dispatches a partial event.
        for (bad in listOf("event: transcript\ndata: $json\n\n", "data: $json\n\n", "id: 123\nevent: connection\ndata: $json\n\n", "retry: 0\n\n", "event: connection\n\n")) {
            rejects("protocol") { reader(bad).next() }
        }
    }
    @Test fun boundedByteLinesFramesDataAndStrictUtf8() {
        val prefix = "event: connection\ndata: "
        val exact = prefix + " ".repeat(1024 - prefix.length - 2) + "\n\n"
        assertEquals(1024, exact.toByteArray().size)
        assertNotNull(reader(exact).next())
        rejects { reader(exact.replace("\n\n", " \n\n")).next() }
        rejects { reader("data: " + "x".repeat(1024) + "\n\n").next() }
        rejects { reader("event: connection\n" + "data: x\n".repeat(150) + "\n").next() }
        rejects { reader("event: connection\ndata: " + "é".repeat(600) + "\n\n").next() }
        rejects { reader((": x\n").repeat(300)).next() }
        rejects { ConnectionSseReader(ByteArrayInputStream(byteArrayOf(0xc3.toByte(), 0x28, 10)), { 0L }).next() }
    }
    @Test fun commentsOrTrickledBytesCannotReplaceConnectionHeartbeats() {
        var time = 0L
        val stream = reader(": ping\n\n".repeat(20)) { time.also { time += 1000 } }
        try { stream.next(); fail("Comment-only stream did not expire") } catch (_: SocketTimeoutException) {}
        time = 0L
        val valid = reader("event: connection\ndata: ${payload()}\n\n") { time }
        time = 19_000; assertNotNull(valid.next()); valid.heartbeatReceived()
        time = 38_000; assertNull(valid.next())
    }
    @Test fun eofRetryBackoffIsJitteredAndAlwaysBounded() {
        assertEquals(1000L, ConnectionPolicy.retryMillis(0, 0.0))
        assertEquals(1250L, ConnectionPolicy.retryMillis(0, 1.0))
        assertEquals(1500L, ConnectionPolicy.retryMillis(1, 0.0))
        for (attempt in -10..100) for (jitter in listOf(0.0, 0.25, 0.5, 0.75, 1.0)) {
            assertTrue(ConnectionPolicy.retryMillis(attempt, jitter) in 1000L..30_000L)
        }
        assertEquals(30_000L, ConnectionPolicy.retryMillis(Int.MAX_VALUE, 1.0))
        for (code in listOf(401, 403, 409)) assertEquals("authorization", ConnectionPolicy.terminalHttp(code))
        assertEquals("backend-update", ConnectionPolicy.terminalHttp(404))
        for (code in listOf(301, 302, 307, 308, 400, 410)) assertEquals("protocol", ConnectionPolicy.terminalHttp(code))
        for (code in listOf(200, 408, 429, 500, 503)) assertNull(ConnectionPolicy.terminalHttp(code))
    }
    @Test fun queuedStartCannotSurviveSelectionAwayAndBackToTheSamePair() {
        val scope = ConnectionScope(); val backendB = pair.copy(backendId = other)
        scope.select(pair)
        val queued = scope.startTicket(pair)!!
        assertTrue(scope.accepts(queued, pair)); assertNull(scope.startTicket(backendB))
        assertFalse(scope.select(pair)); assertTrue(scope.accepts(queued, pair)) // Foreground same-pair select is harmless.
        scope.select(backendB); scope.select(pair)
        assertEquals(pair, scope.selected)
        assertFalse(scope.accepts(queued, pair)) // Matching UUID/chat no longer revives the old owner intent.
        val fresh = scope.startTicket(pair)!!
        assertTrue(scope.accepts(fresh, pair)); assertNotEquals(queued, fresh)
    }
    @Test fun stopOrForgetBeforeFirstConfigRevokesQueuedEnableButFreshOwnerEnableIsValid() {
        val scope = ConnectionScope(); scope.select(pair)
        // No begin/config yet: an allowEnable=true bridge callback is still queued on main.
        val beforeStop = scope.startTicket(pair)!!
        scope.revokeStarts(id)
        assertEquals(pair, scope.selected); assertFalse(scope.accepts(beforeStop, pair))
        val afterExplicitOffOn = scope.startTicket(pair)!!
        assertTrue(scope.accepts(afterExplicitOffOn, pair))
        val running = scope.begin(pair)
        assertTrue(scope.accepts(running, pair)); assertFalse(scope.accepts(beforeStop, pair))
        scope.retire() // Retire that active config, then queue another explicit start.
        val beforeForget = scope.startTicket(pair)!!
        scope.revokeStarts(id) // forget delegates to stop, including the config-null path.
        assertFalse(scope.accepts(beforeForget, pair))
        assertTrue(scope.accepts(scope.startTicket(pair)!!, pair))
    }
    @Test fun stoppingAnotherBackendDoesNotRevokeCurrentConfigActionsOrQueuedStarts() {
        val scope = ConnectionScope(); val backendB = pair.copy(backendId = other)
        scope.select(backendB); val active = scope.begin(backendB)
        val queued = scope.startTicket(backendB)!!
        scope.revokeStarts(id)
        assertTrue(scope.accepts(active, backendB)); assertTrue(scope.accepts(queued, backendB))
        assertTrue(scope.acceptsAction(scope.nonce, active, backendB)); assertEquals(backendB, scope.selected)
    }
    @Test fun lateStartsCallbacksAndNotificationStopsAreGenerationScoped() {
        val scope = ConnectionScope(); val nextChat = pair.copy(chat = 43); val nextBackend = pair.copy(backendId = other)
        scope.select(pair); val first = scope.begin(pair)
        assertTrue(scope.accepts(first, pair)); assertFalse(scope.select(pair)); assertTrue(scope.accepts(first, pair))
        assertTrue(scope.acceptsAction(scope.nonce, first, pair)); assertFalse(scope.acceptsAction(null, first, pair))
        val reopened = ConnectionScope(); reopened.select(pair); val reopenedEpoch = reopened.begin(pair)
        assertFalse(reopened.acceptsAction(scope.nonce, reopenedEpoch, pair)) // Old process PendingIntent cannot collide with a restarted epoch.
        assertFalse(scope.acceptsAction(scope.nonce, first, nextChat))
        scope.select(nextChat)
        assertFalse(scope.accepts(first, pair)); assertFalse(scope.accepts(first, nextChat))
        try { scope.begin(pair); fail("Old bridge start changed selection") } catch (_: IllegalArgumentException) {}
        val second = scope.begin(nextChat)
        assertTrue(scope.accepts(second, nextChat)); assertFalse(scope.accepts(first, nextChat))
        scope.retire(); assertFalse(scope.accepts(second, nextChat)) // Owner's stop wins over in-flight callbacks.
        val third = scope.begin(nextChat)
        assertFalse(scope.accepts(second, nextChat)); assertTrue(scope.accepts(third, nextChat))
        scope.select(nextBackend); assertFalse(scope.accepts(third, nextChat))
        scope.select(null); assertNull(scope.selected); assertFalse(scope.accepts(third, nextChat))
    }
}
