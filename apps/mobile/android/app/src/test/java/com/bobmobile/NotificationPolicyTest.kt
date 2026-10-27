package com.bobmobile

import org.junit.Assert.*
import org.junit.Test
import java.security.GeneralSecurityException
import javax.crypto.spec.SecretKeySpec

class NotificationPolicyTest {
    private val key = SecretKeySpec(ByteArray(32) { (it + 1).toByte() }, "AES")
    private val plaintext = "{\"token\":\"test-pairing-secret\",\"name\":\"Łódź\"}".toByteArray(Charsets.UTF_8)
    @Test fun credentialsRoundTripWithRandomizedAuthenticatedEncryption() {
        val first = NotificationCipher.encrypt("backend-a", plaintext, key)
        val second = NotificationCipher.encrypt("backend-a", plaintext, key)
        assertArrayEquals(plaintext, NotificationCipher.decrypt("backend-a", first, key))
        assertFalse(first.iv.contentEquals(second.iv)); assertFalse(first.ciphertext.contentEquals(plaintext))
    }
    @Test fun backendIdentityAndKeyAreBoundToTheCiphertext() {
        val box = NotificationCipher.encrypt("backend-a", plaintext, key)
        try { NotificationCipher.decrypt("backend-b", box, key); fail("Accepted another backend") } catch (_: GeneralSecurityException) {}
        try { NotificationCipher.decrypt("backend-a", box, SecretKeySpec(ByteArray(32), "AES")); fail("Accepted another key") } catch (_: GeneralSecurityException) {}
    }
    @Test fun alteredCiphertextFailsClosed() {
        val box = NotificationCipher.encrypt("backend-a", plaintext, key)
        val altered = box.ciphertext.clone(); altered[altered.lastIndex] = (altered.last().toInt() xor 1).toByte()
        try { NotificationCipher.decrypt("backend-a", NotificationCipher.Box(box.iv, altered), key); fail("Accepted altered ciphertext") } catch (_: GeneralSecurityException) {}
    }
    @Test fun idleChecksDoNotCreateAnEndlessRetryChain() {
        assertFalse(NotificationSchedulePolicy.needsRetry(false, false))
        assertTrue(NotificationSchedulePolicy.needsRetry(true, false)); assertTrue(NotificationSchedulePolicy.needsRetry(false, true))
    }
    @Test fun onlyUnfinishedBuildStatesNeedPromptFollowUp() {
        for (status in listOf("queued", "running", "building")) assertTrue(NotificationSchedulePolicy.activeStatus(status))
        for (status in listOf("complete", "failed", "", "cancelled")) assertFalse(NotificationSchedulePolicy.activeStatus(status))
    }
}
