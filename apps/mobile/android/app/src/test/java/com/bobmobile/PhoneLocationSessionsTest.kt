package com.bobmobile

import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class PhoneLocationSessionsTest {
    private val a = LocationConnection("https://a.ts.net", "same-backend", "a".repeat(32))

    @Test fun identicalRefreshRetainsTheSessionAndGeneration() {
        val owner = PhoneLocationSessions(); val first = owner.refresh(a)
        repeat(20) { assertSame(first, owner.refresh(a.copy())) }
        assertTrue(owner.accepts(first.generation))
    }
    @Test fun endpointAndCredentialRefreshReplaceTheActualSelectedConnection() {
        for (b in listOf(a.copy(endpoint = "https://b.ts.net"), a.copy(token = "b".repeat(32)))) {
            val owner = PhoneLocationSessions(); val old = owner.refresh(a); val next = owner.refresh(b)
            assertNotSame(old, next); assertTrue(next.generation > old.generation)
            assertEquals(b, owner.current()!!.config)
            assertEquals(b.endpoint, owner.current()!!.config.endpoint)
            assertEquals(b.token, owner.current()!!.config.token)
            assertFalse(owner.isCurrent(old)); assertFalse(owner.accepts(old.generation))
            // Even an ABA refresh must not make an old in-flight result current again.
            val back = owner.refresh(a)
            assertNotSame(old, back); assertFalse(owner.isCurrent(old))
        }
    }
    @Test fun stalePollDisabledResponseAndOld401CannotPublishOrRemoveTheNewOptIn() {
        val owner = PhoneLocationSessions(); val old = owner.refresh(a)
        val next = owner.refresh(a.copy(token = "b".repeat(32)))
        var enabled = true; var publications = 0
        assertFalse(owner.ifCurrent(old) { publications++ })
        assertFalse(owner.ifCurrent(old) { enabled = false; owner.stop() })
        assertEquals(0, publications); assertTrue(enabled); assertSame(next, owner.current())
        assertTrue(owner.ifCurrent(next) { publications++ })
        assertTrue(owner.ifCurrent(next) { enabled = false; owner.stop() })
        assertEquals(1, publications); assertFalse(enabled); assertNull(owner.current())
    }
    @Test fun refreshedGenerationWinsAnAlreadyInflightOldFailure() {
        val owner = PhoneLocationSessions(); val old = owner.refresh(a)
        val inFlight = CountDownLatch(1); val release = CountDownLatch(1)
        var revoked = false
        val oldWorker = Thread {
            inFlight.countDown()
            if (release.await(2, TimeUnit.SECONDS)) owner.ifCurrent(old) { revoked = true; owner.stop() }
        }
        oldWorker.start(); assertTrue(inFlight.await(2, TimeUnit.SECONDS))
        val next = owner.refresh(a.copy(endpoint = "https://b.ts.net"))
        release.countDown(); oldWorker.join(2000)
        assertFalse(oldWorker.isAlive); assertFalse(revoked); assertSame(next, owner.current())
    }
    @Test fun stopBeatsQueuedRefreshAndOldIntentsStayInvalidAfterExplicitReenable() {
        val owner = PhoneLocationSessions(); val first = owner.refresh(a)
        val queued = owner.refresh(a.copy(token = "b".repeat(32)))
        owner.stop()
        assertFalse(owner.accepts(first.generation)); assertFalse(owner.accepts(queued.generation))
        assertFalse(PhoneLocationPolicy.mayStart(null, a.identity, false))
        assertNull(owner.current())
        assertTrue(PhoneLocationPolicy.mayStart(null, a.identity, true))
        val explicit = owner.refresh(queued.config)
        assertTrue(owner.accepts(explicit.generation)); assertFalse(owner.accepts(queued.generation))
        assertFalse(owner.ifCurrent(queued) { owner.stop() }); assertSame(explicit, owner.current())
    }
    @Test fun nativeWiringUsesOneWorkerAndGuardsRevocationResultsAndQueuedStarts() {
        // Source contracts, not Android Service/HTTP/provider execution.
        val source = File("src/main/java/com/bobmobile/BobLocation.kt").readText()
        assertEquals(1, Regex("worker = Thread").findAll(source).count())
        assertTrue(source.contains("if (worker == null) worker = Thread { monitor() }"))
        assertTrue(source.contains("locationSessions.refresh(LocationConnection(origin, identity, token))"))
        assertTrue(source.contains("locationSessions.accepts(intent.getLongExtra(\"generation\", -1))"))
        assertTrue(source.contains("locationSessions.ifCurrent(session) { prefs(this).edit().remove(\"identity\").apply(); locationSessions.stop() }"))
        assertTrue(source.contains("catch (_: SecurityException) { revoke(session); break }"))
        assertTrue(source.contains("val polled = LocationHttp.call(config, \"/poll\", connectionRef = connection, session = session)\n            if (!enabled(session)) break"))
        assertTrue(source.contains("if (enabled(session)) LocationHttp.call(config, \"/response\", body, connection, session)"))
        assertTrue(source.contains("locationSessions.ifCurrent(session) { connectionRef?.set(connection) }"))
        assertTrue(source.contains("connection.getAndSet(null)?.disconnect(); worker?.interrupt()"))
        assertTrue(source.contains("LifecycleState.RESUMED")); assertTrue(source.contains("locationAllowed(context)"))
        assertTrue(source.contains("PhoneLocationPolicy.mayStart(previous, identity, allowEnable)"))
        assertFalse(source.contains("START_STICKY")); assertFalse(source.contains("putExtra(\"token\""))
        assertFalse(source.contains("putString(\"token\""))
    }
}
