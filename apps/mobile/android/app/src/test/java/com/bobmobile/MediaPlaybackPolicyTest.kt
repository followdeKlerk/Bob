package com.bobmobile

import org.junit.Assert.*
import org.junit.Test

class MediaPlaybackPolicyTest {
    @Test fun sourceRequiresAnExplicitSessionAndBoundedInitialPosition() {
        assertEquals("media-1", MediaPlaybackPolicy.session("media-1"))
        for (session in listOf("", "media-0", "https://example.com", "media-1?token=secret", "media-1\n")) {
            assertThrows(IllegalArgumentException::class.java) { MediaPlaybackPolicy.session(session) }
        }
        for (position in listOf(-1.0, 0.5, Double.NaN, Double.POSITIVE_INFINITY, 2147483648.0)) {
            assertThrows(IllegalArgumentException::class.java) { MediaPlaybackPolicy.position(position) }
        }
        assertEquals(12345, MediaPlaybackPolicy.position(12345.0))
    }
    @Test fun restoredPositionCannotSeekPastEndOrIntoUnknownDuration() {
        assertEquals(12000, MediaPlaybackPolicy.seek(12000, 60000))
        assertEquals(59999, MediaPlaybackPolicy.seek(90000, 60000))
        assertEquals(0, MediaPlaybackPolicy.seek(90000, -1))
        assertEquals(0, MediaPlaybackPolicy.seek(90000, 0))
    }
}
