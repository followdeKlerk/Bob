package com.bobmobile

import org.junit.Assert.*
import org.junit.Test

class VoiceInputPolicyTest {
    @Test fun onDeviceIsPreferredAndPlatformRequiresFreshExplicitConsent() {
        assertEquals("onDevice", VoiceInputPolicy.mode(true, true))
        assertEquals("platform", VoiceInputPolicy.mode(false, true))
        assertEquals("unavailable", VoiceInputPolicy.mode(false, false))
        assertTrue(VoiceInputPolicy.permitted("onDevice", true, true, false))
        assertFalse(VoiceInputPolicy.permitted("onDevice", false, true, true)) // Never downgrade.
        assertFalse(VoiceInputPolicy.permitted("platform", false, true, false))
        assertTrue(VoiceInputPolicy.permitted("platform", false, true, true))
        assertTrue(VoiceInputPolicy.permitted("platform", true, true, true)) // Explicitly chosen alternative may coexist with on-device.
        assertFalse(VoiceInputPolicy.permitted("platform", false, false, true))
        assertFalse(VoiceInputPolicy.permitted("unknown", true, true, true))
    }
    @Test fun noOverlappingRecognizerOrRepeatedFinal() {
        val policy = VoiceInputPolicy()
        val token = policy.begin("first")
        try { policy.begin("overlap"); fail("allowed overlap") } catch (_: IllegalStateException) {}
        assertTrue(policy.finish(token))
        assertFalse(policy.finish(token))
        assertEquals("first", policy.end(token))
        assertNull(policy.end(token))
        assertFalse(policy.current(token))
    }
    @Test fun cancellationScopeAndBackgroundRevokeOldGeneration() {
        val policy = VoiceInputPolicy()
        val old = policy.begin("old")
        policy.end(old)
        val next = policy.begin("new")
        assertFalse(policy.current(old))
        assertFalse(policy.finish(old))
        assertNull(policy.end(old))
        assertTrue(policy.current(next))
        assertEquals("new", policy.end(next))
    }
    @Test fun emptyAndExcessiveRequestIdsAreRejectedAndCaptureIsBounded() {
        for (id in listOf("", " ", "x".repeat(101))) {
            try { VoiceInputPolicy().begin(id); fail("accepted invalid request") } catch (_: IllegalArgumentException) {}
        }
        assertEquals(3_000L, VoiceInputPolicy.SILENCE_MS)
        assertEquals(25_000L, VoiceInputPolicy.LISTEN_MS + VoiceInputPolicy.FINISH_MS)
        assertEquals(16_000, VoiceInputPolicy.MAX_TEXT)
    }
    @Test fun engineErrorsDoNotLeakProviderDetailsOrTriggerAutomaticFallback() {
        for (code in 1..15) assertTrue(VoiceInputPolicy.error(code).isNotBlank())
        assertTrue(VoiceInputPolicy.error(8).contains("busy"))
        assertTrue(VoiceInputPolicy.error(9).contains("permission"))
        assertTrue(VoiceInputPolicy.error(6).contains("No speech"))
        assertTrue(VoiceInputPolicy.error(2).contains("connect"))
        assertTrue(VoiceInputPolicy.error(13).contains("Speech options"))
    }
}
