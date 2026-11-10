package com.bobmobile

import org.junit.Assert.*
import org.junit.Test
import java.net.URI

class MediaRangePolicyTest {
    private val artifact = "5aaee20e-e260-4403-80da-b97ce80664a1"
    private fun denied(block: () -> Unit) { try { block(); fail("Untrusted transport accepted") } catch (_: IllegalArgumentException) {} }
    @Test fun onlyExactPairedConversationArtifactCanReceiveCredentials() {
        val expected = "https://owner.ts.net/v1/chats/7/artifacts/$artifact"
        assertEquals(expected, MediaRangePolicy.url("https://owner.ts.net/", "7", artifact, false).toString())
        for (endpoint in listOf("https://evil.example", "https://owner.ts.net.evil.example", "http://owner.ts.net", "https://user@owner.ts.net", "https://owner.ts.net?token=secret", "https://owner.ts.net#secret", "https://owner.ts.net/v1", "https://owner.ts.net/%2e%2e", "http://127.0.0.1:1234")) {
            denied { MediaRangePolicy.url(endpoint, "7", artifact, false) }
        }
        for (chat in listOf("0", "-1", "01", "7/../8", "7?token=secret", "9007199254740992")) denied { MediaRangePolicy.url("https://owner.ts.net", chat, artifact, false) }
        for (id in listOf("../private", "$artifact?token=secret", "not-a-uuid", "$artifact/other")) denied { MediaRangePolicy.url("https://owner.ts.net", "7", id, false) }
        assertEquals("http://127.0.0.1:1234/v1/chats/7/artifacts/$artifact", MediaRangePolicy.url("http://127.0.0.1:1234", "7", artifact, true).toString())
    }
    @Test fun onlyAnExact206ForTheExpectedImmutableSizeIsAccepted() {
        MediaRangePolicy.response(206, "bytes 0-262143/1000000", 262144, 0, 262143, 1000000)
        for (status in listOf(200, 301, 302, 307, 308, 401, 409, 416)) denied { MediaRangePolicy.response(status, "bytes 0-262143/1000000", 262144, 0, 262143, 1000000) }
        for (header in listOf(null, "bytes 0-262143/*", "bytes 0-262143/999999", "bytes 1-262144/1000000")) denied { MediaRangePolicy.response(206, header, 262144, 0, 262143, 1000000) }
        denied { MediaRangePolicy.response(206, "bytes 0-262143/1000000", -1, 0, 262143, 1000000) }
    }
    @Test fun credentialsAndMemoryLimitsAreValidatedWithoutPuttingSecretsIntoFailures() {
        MediaRangePolicy.credentials("secret", "paired-backend")
        for (token in listOf("", "secret\r\nInjected: yes", "x".repeat(8193))) denied { MediaRangePolicy.credentials(token, "backend") }
        denied { MediaRangePolicy.credentials("secret", "backend\nInjected") }
        for (size in listOf(-1.0, 0.0, 0.5, Double.NaN, Double.POSITIVE_INFINITY, 1073741825.0)) denied { MediaRangePolicy.size(size) }
        assertEquals(1073741824L, MediaRangePolicy.size(1073741824.0))
    }
}
