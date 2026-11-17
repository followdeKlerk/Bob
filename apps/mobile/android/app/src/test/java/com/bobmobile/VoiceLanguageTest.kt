package com.bobmobile

import org.junit.Assert.*
import org.junit.Test

class VoiceLanguageTest {
    @Test fun installedSameLanguageModelsPreferExactThenHomeRegion() {
        assertEquals("en-US", VoiceLanguage.closest("en-DE", listOf("de-DE", "en-GB", "en-US")))
        assertEquals("en-GB", VoiceLanguage.closest("en-GB", listOf("en-US", "en-GB")))
        assertEquals("de-DE", VoiceLanguage.closest("de-AT", listOf("de-CH", "de-DE")))
        assertNull(VoiceLanguage.closest("fr-FR", listOf("en-US", "de-DE")))
        assertNull(VoiceLanguage.closest("en-US", emptyList()))
    }
    @Test fun regionDefaultsAreUsableAndNotInventedEnEnOrZhZh() {
        assertEquals("en-US", VoiceLanguage.mainRegion("en-DE"))
        assertEquals("de-DE", VoiceLanguage.mainRegion("de-AT"))
        assertEquals("pt-BR", VoiceLanguage.mainRegion("pt"))
        assertEquals("zh-CN", VoiceLanguage.mainRegion("zh"))
        assertEquals("id-ID", VoiceLanguage.mainRegion("id"))
    }
    @Test fun nativeCaptureLeaseCannotBeReplacedOrReleasedByAnotherModule() {
        val first = Any(); val second = Any()
        assertTrue(NativeVoiceCapture.claim(first)); assertFalse(NativeVoiceCapture.claim(second))
        NativeVoiceCapture.release(second); assertTrue(NativeVoiceCapture.active)
        NativeVoiceCapture.release(first); assertFalse(NativeVoiceCapture.active)
        assertTrue(NativeVoiceCapture.claim(second)); NativeVoiceCapture.release(second)
    }
    @Test fun failedCaptureDestroyBlocksNewModulesAndRemainsRetryableUntilConfirmed() {
        val old = Any(); val replacement = Any(); var succeeds = false; var attempts = 0
        assertTrue(NativeVoiceCapture.claim(old))
        assertFalse(NativeVoiceCapture.retire(old) { attempts++; succeeds })
        assertTrue(NativeVoiceCapture.active)
        assertFalse(NativeVoiceCapture.claim(replacement))
        assertTrue(attempts >= 2)
        succeeds = true
        assertTrue(NativeVoiceCapture.cleanupRetired()); assertFalse(NativeVoiceCapture.active)
        assertTrue(NativeVoiceCapture.claim(replacement)); NativeVoiceCapture.release(replacement)
    }
    @Test fun throwingCaptureCleanupRetainsTheLeaseAndDoesNotStopAnAdmittedCapture() {
        val owner = Any(); assertTrue(NativeVoiceCapture.claim(owner))
        assertTrue(NativeVoiceCapture.cleanupRetired()); assertTrue(NativeVoiceCapture.active)
        assertFalse(NativeVoiceCapture.retire(owner) { throw IllegalStateException("binder died") })
        assertTrue(NativeVoiceCapture.active)
        assertTrue(NativeVoiceCapture.retire(owner) { true }); assertFalse(NativeVoiceCapture.active)
    }
}
