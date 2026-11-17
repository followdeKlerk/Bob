package com.bobmobile

import org.junit.Assert.*
import org.junit.Test

class VoiceLanguageTest {
    @Test fun requestedAdapterParametersPreserveEveryRegionScriptAndExtension() {
        for (tag in listOf("ja-JP", "ko-KR", "hi-IN", "sv-SE", "en-GB", "zh-Hant-TW", "sr-Latn-RS", "en-GB-u-nu-latn")) {
            // This is the exact value adapter passed into EXTRA_LANGUAGE by the shared
            // activity/service intent builder, including pre-support-lookup API paths.
            assertEquals(tag, VoiceLanguage.requested(tag))
            assertEquals(tag, VoiceLanguage.supportedRequest(tag, listOf(tag)))
            assertEquals(tag, VoiceLanguage.mainRegion(tag))
        }
    }
    @Test fun explicitTagValidationKeepsScriptRegionAndExtensionsWithoutGuessing() {
        for (tag in listOf("en-PL", "en-US", "en-GB", "zh-Hant-TW", "en-GB-u-nu-latn")) assertTrue(tag, VoiceLanguage.valid(tag))
        for (tag in listOf("", "en_US", "und", "en-", "de-DE|provider", "en-PL;network")) assertFalse(tag, VoiceLanguage.valid(tag))
    }
    @Test fun onlyAdvertisedExactRequestIsAdmittedAndAlternativesAreSuggestionsNotGuesses() {
        assertNull(VoiceLanguage.supportedRequest("en-GB", listOf("en-US")))
        assertEquals("en-US", VoiceLanguage.closest("en-GB", listOf("de-DE", "en-US")))
        assertNull(VoiceLanguage.closest("ja-JP", listOf("ko-KR")))
        assertNull(VoiceLanguage.closest("zh-Hant-TW", listOf("zh-Hans-CN")))
        assertEquals("zh-Hant-HK", VoiceLanguage.closest("zh-Hant-TW", listOf("zh-Hans-CN", "zh-Hant-HK")))
        assertNull(VoiceLanguage.supportedRequest("ja-JP", emptyList()))
        assertNull(VoiceLanguage.closest("hi-IN", emptyList()))
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
