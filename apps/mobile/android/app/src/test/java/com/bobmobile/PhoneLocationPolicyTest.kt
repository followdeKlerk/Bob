package com.bobmobile

import org.junit.Assert.*
import org.junit.Test

class PhoneLocationPolicyTest {
    @Test fun locationOnlyUsesThePairedPrivateOriginWithoutRedirectAuthority() {
        assertEquals("https://owner.tail.ts.net", PhoneLocationPolicy.endpoint("https://owner.tail.ts.net/"))
        for (bad in listOf("https://public.example", "http://owner.ts.net", "https://owner.ts.net.evil.example", "https://user:password@owner.ts.net", "https://owner.ts.net/path", "https://owner.ts.net?token=secret", "https://owner.ts.net/#fragment", "http://127.0.0.1:8080")) {
            try { PhoneLocationPolicy.endpoint(bad); fail("Accepted an unsafe origin") } catch (_: IllegalArgumentException) {}
        }
        assertEquals("http://127.0.0.1:8080", PhoneLocationPolicy.endpoint("http://127.0.0.1:8080", true))
    }
    @Test fun fixesMustBeRecentAccordingToThePhonesMonotonicClock() {
        val now = 100_000_000_000L
        assertTrue(PhoneLocationPolicy.fresh(now, now)); assertTrue(PhoneLocationPolicy.fresh(now - 30_000_000_000L, now))
        assertFalse(PhoneLocationPolicy.fresh(now - 30_000_000_001L, now)); assertFalse(PhoneLocationPolicy.fresh(now + 1, now)); assertFalse(PhoneLocationPolicy.fresh(0, now))
    }
    @Test fun aResumeCannotUndoTheOwnersStopOrEnableAnotherBackend() {
        assertFalse(PhoneLocationPolicy.mayStart(null, "backend-a", false))
        assertFalse(PhoneLocationPolicy.mayStart("backend-b", "backend-a", false))
        assertTrue(PhoneLocationPolicy.mayStart("backend-a", "backend-a", false))
        assertTrue(PhoneLocationPolicy.mayStart(null, "backend-a", true))
    }
}
