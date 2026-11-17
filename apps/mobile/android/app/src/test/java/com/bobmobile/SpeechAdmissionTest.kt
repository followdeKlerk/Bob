package com.bobmobile

import org.junit.Assert.*
import org.junit.Test

/** Same admission/atomic enqueue primitive used by BobSpeech; no Android engine. */
class SpeechAdmissionTest {
    @Test fun stopRevokesHeldInitContinuationBeforeItsMainQueueCleanupRuns() {
        val admission = SpeechAdmission(); val owner = SpeechAdmission.Owner()
        val ticket = admission.claim(owner, "reply-1")!!; var speaks = 0
        val queuedInit = { if (admission.accepts(ticket)) admission.admit(ticket) { speaks++ } }
        val caller = Thread { admission.cancel(owner, "reply-1") }; caller.start(); caller.join()
        queuedInit() // Posted cleanup intentionally has NOT run yet.
        assertEquals(0, speaks)
    }
    @Test fun invalidateFencesHeldInitAndFutureClaimsButReplacementModuleStillWorks() {
        val admission = SpeechAdmission(); val old = SpeechAdmission.Owner()
        val ticket = admission.claim(old, "old")!!; var speaks = 0
        admission.close(old)
        assertFalse(admission.admit(ticket) { speaks++ }); assertNull(admission.claim(old, "revive"))
        val fresh = admission.claim(SpeechAdmission.Owner(), "new")!!
        admission.close(old); admission.release(ticket)
        assertTrue(admission.admit(fresh) { speaks++ }); assertEquals(1, speaks)
    }
    @Test fun staleIdScopedStopAndQueuedOldReleaseCannotCancelNewPlayback() {
        val admission = SpeechAdmission(); val owner = SpeechAdmission.Owner()
        val old = admission.claim(owner, "old")!!
        admission.cancel(owner, "old")
        val fresh = admission.claim(owner, "new")!!
        assertNull(admission.cancel(owner, "old")); admission.release(old)
        assertTrue(admission.accepts(fresh)); assertFalse(admission.accepts(old))
        assertNull(admission.cancel(SpeechAdmission.Owner(), "new"))
        assertTrue(admission.accepts(fresh))
    }
    @Test fun globalStopRevokesAllEarlierAdmissionsButNotAnExplicitLaterRequest() {
        val admission = SpeechAdmission(); val owner = SpeechAdmission.Owner()
        val first = admission.claim(owner, "initializing")!!
        assertEquals(first, admission.cancelAll())
        val later = admission.claim(owner, "later")!!
        assertFalse(admission.admit(first) { fail("old callback spoke") })
        assertTrue(admission.admit(later) {})
    }
    @Test fun coldShutdownThenLaterCaptureOrPlaybackDoesNotReviveTheOldCallback() {
        val admission = SpeechAdmission(); val owner = SpeechAdmission.Owner()
        val old = admission.claim(owner, "cold")!!
        val lease = SpeechEngineLease<Any>({ false }, {})
        lease.attach(Any()); admission.cancelAll()
        assertTrue(lease.cleanup()); assertFalse(admission.admit(old) { fail("cold engine revived") })
        assertTrue(NativeVoiceCapture.claim(this)); NativeVoiceCapture.release(this)
        val later = admission.claim(owner, "later")!!
        assertTrue(admission.admit(later) {})
    }
}
