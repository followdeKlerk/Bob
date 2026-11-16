package com.bobmobile

import org.junit.Assert.*
import org.junit.Test

/** Exercises queued admission and callback policy; does not instantiate Android SpeechRecognizer. */
class VoiceInputAdmissionTest {
    @Test fun unfocusedBackgroundOrClosedWindowsCannotClaimAndFocusAloneNeverStartsAnything() {
        val gate = VoiceInputAdmission(false, false)
        assertNull(gate.claim("a")); gate.foreground(true); assertNull(gate.claim("a"))
        gate.focus(true); val first = gate.claim("a")!!; assertTrue(gate.accepts(first))
        assertNull(gate.claim("overlap")); gate.close(); assertFalse(gate.accepts(first)); assertNull(gate.claim("new"))
    }
    @Test fun cancelPauseAndBlurBeforeQueuedAdmissionRemainRevokedAfterRapidReturn() {
        for (cause in listOf("cancel", "pause", "blur", "destroy")) {
            val gate = VoiceInputAdmission(true, true)
            val queued = gate.claim("old")!!
            var microphoneStarts = 0
            val admit = { gate.admit(queued) { microphoneStarts++ } }
            when (cause) {
                "cancel" -> gate.cancel("old")
                "pause" -> gate.foreground(false)
                "blur" -> gate.focus(false)
                else -> gate.close()
            }
            gate.foreground(true); gate.focus(true)
            assertFalse(cause, admit()); assertEquals(0, microphoneStarts)
            if (cause != "destroy") {
                val next = gate.claim("new")!!
                assertFalse(gate.accepts(queued)); assertTrue(gate.accepts(next))
                gate.release(queued); gate.cancel("old"); assertTrue(gate.accepts(next))
                assertTrue(gate.admit(next) { microphoneStarts++ }); assertEquals(1, microphoneStarts)
            }
        }
    }
    @Test fun focusLossFencesPreReadyListeningAndFinishingCallbacksWithoutRestarting() {
        for (phase in listOf("pre-ready", "listening", "finishing")) {
            val gate = VoiceInputAdmission(true, true); val policy = VoiceInputPolicy()
            val ticket = gate.claim("utterance")!!; val token = policy.begin(ticket.id)
            if (phase == "finishing") assertTrue(policy.finish(token))
            fun callbackIsLive() = policy.current(token) && gate.accepts(ticket)
            assertTrue(callbackIsLive()); assertEquals(ticket, gate.focus(false)); assertFalse(callbackIsLive())
            gate.focus(true); assertFalse(callbackIsLive()) // Never resume an old recognizer on focus regain.
            assertEquals("utterance", policy.end(token)); assertNull(policy.end(token)); assertFalse(callbackIsLive())
            assertNotEquals(ticket, gate.claim("utterance")) // New deliberate tap has a fresh generation, even same ID.
        }
    }
    @Test fun ownConsentAndPermissionFocusLossBeforeAClaimDoesNotPoisonLaterDeliberateAdmission() {
        val gate = VoiceInputAdmission(true, true)
        assertNull(gate.focus(false)); assertNull(gate.claim("too-early")) // Consent dialog: no recognizer exists.
        gate.focus(true); gate.focus(false); assertNull(gate.claim("permission-dialog"))
        gate.focus(true); val ready = gate.claim("after-dialogs")!!; assertTrue(gate.accepts(ready))
        gate.cancel(ready.id); assertFalse(gate.accepts(ready))
    }
}
