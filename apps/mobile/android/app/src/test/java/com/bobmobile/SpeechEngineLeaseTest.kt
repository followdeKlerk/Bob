package com.bobmobile

import org.junit.Assert.*
import org.junit.Test

/** Injects engine failures into the same cleanup boundary used by BobSpeech; no Android runtime. */
class SpeechEngineLeaseTest {
    private class Engine {
        var stopCode = 0
        var stopThrows = false
        var shutdownThrows = false
        var stops = 0
        var shutdowns = 0
        fun stop(): Boolean { stops++; if (stopThrows) error("stop"); return stopCode == 0 }
        fun shutdown() { shutdowns++; if (shutdownThrows) error("shutdown") }
    }
    private fun lease(engine: Engine) = SpeechEngineLease<Engine>({ it.stop() }, { it.shutdown() }).also { it.attach(engine) }
    @Test fun successfulStopAndShutdownReleaseExactlyOnce() {
        val engine = Engine(); val lease = lease(engine)
        assertTrue(lease.cleanup()); assertNull(lease.engine)
        assertTrue(lease.cleanup()); assertEquals(1, engine.stops); assertEquals(1, engine.shutdowns)
        lease.attach(Engine()); assertTrue(lease.cleanup())
    }
    @Test fun stopErrorIsReportedAndCannotBeHiddenBySuccessfulShutdownOnThatCall() {
        val engine = Engine().apply { stopCode = -1 }; val lease = lease(engine)
        assertFalse(lease.cleanup()); assertSame(engine, lease.engine); assertEquals(1, engine.shutdowns)
        try { lease.attach(Engine()); fail("replaced unresolved engine") } catch (_: IllegalStateException) {}
        // Even void shutdown returning normally cannot erase the known stop failure.
        assertFalse(lease.cleanup()); assertSame(engine, lease.engine)
        engine.stopCode = 0
        assertTrue(lease.cleanup()); assertNull(lease.engine)
        assertEquals(3, engine.stops); assertEquals(3, engine.shutdowns)
    }
    @Test fun stopThrowStillAttemptsShutdownIndependentlyAndReportsFailure() {
        val engine = Engine().apply { stopThrows = true }; val lease = lease(engine)
        assertFalse(lease.cleanup()); assertEquals(1, engine.stops); assertEquals(1, engine.shutdowns)
        assertSame(engine, lease.engine); assertFalse(lease.cleanup())
        engine.stopThrows = false
        assertTrue(lease.cleanup()); assertNull(lease.engine)
    }
    @Test fun failedShutdownRetainsAndRetriesTheOnlyEngineReferenceUntilActuallyCleaned() {
        val engine = Engine().apply { shutdownThrows = true }; val lease = lease(engine)
        repeat(3) { assertFalse(lease.cleanup()); assertSame(engine, lease.engine) }
        assertEquals(3, engine.stops); assertEquals(3, engine.shutdowns)
        engine.shutdownThrows = false
        assertTrue(lease.cleanup()); assertNull(lease.engine); assertEquals(4, engine.shutdowns)
    }
    @Test fun stopErrorOrThrowCombinedWithShutdownFailureNeverBecomesAnEmptySuccessfulStop() {
        for (throwStop in listOf(false, true)) {
            val engine = Engine().apply { stopCode = -1; stopThrows = throwStop; shutdownThrows = true }
            val lease = lease(engine)
            repeat(3) { assertFalse(lease.cleanup()); assertSame(engine, lease.engine) }
            assertEquals(3, engine.shutdowns)
            engine.stopCode = 0; engine.stopThrows = false; engine.shutdownThrows = false
            assertTrue(lease.cleanup()); assertNull(lease.engine)
        }
    }
    @Test fun replacementModuleCannotForgetAPreviousModulesFailedEngine() {
        val registry = SpeechEngineCleanup<Engine>()
        val engine = Engine().apply { shutdownThrows = true }; val retired = lease(engine)
        assertFalse(registry.cleanup(retired))
        val replacement = SpeechEngineLease<Engine>({ it.stop() }, { it.shutdown() })
        assertFalse(registry.cleanup(replacement)); assertSame(engine, retired.engine)
        engine.shutdownThrows = false
        assertTrue(registry.cleanup(replacement)); assertNull(retired.engine)
        replacement.attach(Engine()); assertTrue(registry.cleanup(replacement))
    }

}
