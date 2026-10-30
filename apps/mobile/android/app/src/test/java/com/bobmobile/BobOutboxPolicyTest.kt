package com.bobmobile

import org.junit.Assert.*
import org.junit.Test
import java.security.GeneralSecurityException
import javax.crypto.spec.SecretKeySpec

class BobOutboxPolicyTest {
    @Test fun onlyExplicitAbsenceAllowsPosting() {
        assertTrue(BobOutboxPolicy.mayPost(false, true, true))
        assertFalse(BobOutboxPolicy.mayPost(false, false, true))
        assertFalse(BobOutboxPolicy.mayPost(false, true, false))
        assertFalse(BobOutboxPolicy.mayPost(true, true, true))
        assertFalse(BobOutboxPolicy.mayPost(true, false, true))
    }
    @Test fun admittedRequestsNeverRepostEvenIfReceiptDisappears() {
        for (hasField in listOf(false, true)) for (isNull in listOf(false, true)) {
            assertFalse(BobOutboxPolicy.mayPost(true, hasField, isNull))
        }
    }
    @Test fun onlyEarlierPendingMessagesBlockChatAdmission() {
        assertTrue(BobOutboxPolicy.blocks("pending", 1, 2))
        assertFalse(BobOutboxPolicy.blocks("pending", 2, 2))
        assertFalse(BobOutboxPolicy.blocks("pending", 3, 2))
        assertFalse(BobOutboxPolicy.blocks("admitted", 1, 2))
        assertFalse(BobOutboxPolicy.blocks("rejected", 1, 2))
    }
    @Test fun automaticNetworkAttemptsAndLifetimeAreBounded() {
        val start = 1000L
        assertFalse(BobOutboxPolicy.exhausted(11, start, start + BobOutboxPolicy.MAX_AGE_MS - 1))
        assertTrue(BobOutboxPolicy.exhausted(12, start, start))
        assertTrue(BobOutboxPolicy.exhausted(0, start, start + BobOutboxPolicy.MAX_AGE_MS))
    }
    @Test fun authIdentityRedirectAndValidationFailuresAreNotAutoRetried() {
        for (status in listOf(301, 302, 307, 308, 400, 401, 403, 404, 409, 413, 422)) assertFalse(BobOutboxPolicy.retryable(status))
        for (status in listOf(408, 425, 429, 500, 502, 503, 504)) assertTrue(BobOutboxPolicy.retryable(status))
    }
    @Test fun nativeMessageBudgetCoversProtocolEscaping() {
        assertTrue(BobOutboxPolicy.MAX_MESSAGE_BYTES >= 200000 * 6 + 4096)
        assertTrue(BobOutboxPolicy.MAX_ITEM_BYTES > BobOutboxPolicy.MAX_MESSAGE_BYTES)
    }
    @Test fun requestIdentityCannotEscapeOperationPath() {
        assertEquals("12345678-1234-1234-1234-123456789abc", BobOutboxPolicy.identity("12345678-1234-1234-1234-123456789abc"))
        for (id in listOf("", "../messages", "1-1-1-1-1", "12345678-1234-1234-1234-123456789abc?x=1")) {
            try { BobOutboxPolicy.identity(id); fail("Accepted invalid identity") } catch (_: IllegalArgumentException) {}
        }
    }
    @Test fun chatAndEntryIdsMustBePositiveSafeIntegers() {
        assertEquals(7L, BobOutboxPolicy.chat(7.0))
        assertEquals(9007199254740991L, BobOutboxPolicy.chat(9007199254740991.0))
        for (chat in listOf(0.0, -1.0, 1.5, Double.NaN, Double.POSITIVE_INFINITY, 9007199254740992.0)) {
            try { BobOutboxPolicy.chat(chat); fail("Accepted invalid chat") } catch (_: IllegalArgumentException) {}
        }
    }
    @Test fun encryptedIntentIncludesCredentialAndItemButCannotMoveToAnotherRequest() {
        val key = SecretKeySpec(ByteArray(32) { it.toByte() }, "AES")
        val body = "{\"credential\":\"private\",\"itemJson\":\"draft\",\"admission\":{\"status\":\"queued\"}}".toByteArray()
        val box = NotificationCipher.encrypt("outbox-v1:first", body, key)
        assertArrayEquals(body, NotificationCipher.decrypt("outbox-v1:first", box, key))
        assertFalse(box.ciphertext.contentEquals(body))
        try { NotificationCipher.decrypt("outbox-v1:second", box, key); fail("Accepted relocated ciphertext") }
        catch (_: GeneralSecurityException) {}
    }
    @Test fun pairedTransportUsesExistingNarrowTlsPolicy() {
        assertEquals("https://bob.example.ts.net", PhoneLocationPolicy.endpoint("https://bob.example.ts.net/"))
        for (endpoint in listOf("https://example.com", "http://bob.example.ts.net", "https://secret@bob.example.ts.net", "https://bob.example.ts.net/v1", "https://bob.example.ts.net?secret=x")) {
            try { PhoneLocationPolicy.endpoint(endpoint); fail("Accepted unpaired transport") } catch (_: IllegalArgumentException) {}
        }
        assertEquals("http://127.0.0.1:8080", PhoneLocationPolicy.endpoint("http://127.0.0.1:8080", true))
    }
}
