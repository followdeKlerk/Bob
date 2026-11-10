package com.bobmobile

import org.junit.Assert.*
import org.junit.Test

class TerminalAdmissionTest {
    @Test fun closedOrFailedHandleCannotResumeWithoutFreshAdmission() {
        for (failed in listOf(false, true)) {
            val state = TerminalAdmission()
            assertTrue(state.admit("first"))
            assertEquals("starting", state.phase)
            assertTrue(state.running())
            assertTrue(state.finish(failed))
            assertFalse(state.admitted)
            assertEquals(if (failed) "failed" else "closed", state.phase)
            assertFalse(state.admit("first"))
            assertFalse(state.running())
            assertFalse(state.finish())
            assertTrue(state.admit("explicit-fresh-handle"))
            assertTrue(state.running())
        }
    }
    @Test fun propReapplicationDoesNotRestartOrResetRunningSession() {
        val state = TerminalAdmission()
        state.admit("one")
        state.running()
        repeat(5) { assertFalse(state.admit("one")); assertEquals("running", state.phase) }
        assertFalse(state.running())
    }
    @Test fun pauseBeforeRendererReadyConsumesAdmission() {
        val state = TerminalAdmission()
        state.admit("pending")
        assertTrue(state.finish())
        assertFalse(state.running())
        assertFalse(state.admit("pending"))
    }
    private fun config() = BobTerminalConfig("192.0.2.1", 60001, "abcdefghijklmnopqrstuv", "backend", "42", "session", "Terminal", "/tmp")
    @Test fun preparedHandlesAreOpaqueOneShotExpiringAndReleaseIsIdempotent() {
        var now = 100L
        val registry = PreparedTerminalSessions { now }
        val value = config()
        val first = registry.put(value)
        assertFalse(first.contains(value.key))
        assertEquals(value, registry.take(first))
        assertNull(registry.take(first))
        registry.remove(first); registry.remove(first)
        val expired = registry.put(value)
        now += 15_000
        assertNull(registry.take(expired))
        val released = registry.put(value)
        registry.remove(released); registry.remove(released)
        assertNull(registry.take(released))
    }
    @Test fun registryBoundsUnconsumedCredentialsAndRecoversAtExpiry() {
        var now = 1L
        val registry = PreparedTerminalSessions { now }
        repeat(4) { registry.put(config()) }
        assertThrows(IllegalStateException::class.java) { registry.put(config()) }
        now += 15_000
        assertNotNull(registry.take(registry.put(config())))
    }
    @Test fun stateSnapshotsNeverAcknowledgeLaterCommandsOrSessions() {
        val state = TerminalAdmission()
        state.admit("first"); state.running()
        var sequence = -1.0
        val initial = TerminalStateSnapshot(state.session!!, state.phase, null, false, sequence)
        assertNull(initial.acknowledged)
        sequence = 7.0
        val old = TerminalStateSnapshot(state.session!!, state.phase, null, true, sequence)
        sequence = 8.0
        val next = TerminalStateSnapshot(state.session!!, state.phase, null, false, sequence)
        state.finish(); state.admit("second")
        assertEquals("first", old.session)
        assertEquals("running", old.phase)
        assertEquals(7.0, old.acknowledged!!, 0.0)
        assertTrue(old.ctrl)
        assertEquals(8.0, next.acknowledged!!, 0.0)
        assertFalse(next.ctrl)
        assertNull(initial.acknowledged)
        val fresh = TerminalStateSnapshot(state.session!!, state.phase, null, false, -1.0)
        assertEquals("second", fresh.session)
        assertNull(fresh.acknowledged)
    }

}
