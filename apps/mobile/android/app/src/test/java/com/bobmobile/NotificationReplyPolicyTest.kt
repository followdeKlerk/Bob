package com.bobmobile

import org.junit.Assert.*
import org.junit.Test
import java.util.Base64
import javax.crypto.spec.SecretKeySpec

class NotificationReplyPolicyTest {
    private val backend = "12345678-1234-1234-1234-123456789abc"
    private val request = "abcdef01-1234-1234-1234-123456789abc"
    private val endpoint = "https://bob.example.ts.net"
    @Test fun repeatedRegistrationKeepsTheSameOutstandingRequestIdentity() {
        repeat(20) { assertEquals(request, NotificationReplyPolicy.requestId(request, false)) }
        val next = NotificationReplyPolicy.requestId(request, true)
        assertNotEquals(request, next)
        assertEquals(next, BobOutboxPolicy.identity(next))
    }
    @Test fun duplicateBroadcastsUseTheFirstTextAndCannotBecomeASecondSend() {
        assertTrue(NotificationReplyPolicy.accepts(null, "first"))
        assertTrue(NotificationReplyPolicy.accepts("first", "first"))
        assertTrue(NotificationReplyPolicy.accepts("first", null)) // Explicit retry uses encrypted draft.
        assertFalse(NotificationReplyPolicy.accepts("first", "different second reply"))
        assertEquals(request, NotificationReplyPolicy.requestId(request, false))
    }
    @Test fun pairingFingerprintIsIndependentOfWorkRevisionButBindsCredentialAndEndpoint() {
        val token = "a".repeat(48)
        val first = NotificationReplyPolicy.fingerprint(backend, endpoint, token)
        assertEquals(first, NotificationReplyPolicy.fingerprint(backend, endpoint, token))
        assertNotEquals(first, NotificationReplyPolicy.fingerprint(backend, endpoint, "b".repeat(48)))
        assertNotEquals(first, NotificationReplyPolicy.fingerprint(backend, "https://other.example.ts.net", token))
        assertNotEquals(first, NotificationReplyPolicy.fingerprint(request, endpoint, token))
        assertFalse(first.contains(token))
    }
    @Test fun staleRevokedFutureAndExpiredActionsFailClosed() {
        val start = 1000L; val age = NotificationReplyPolicy.MAX_AGE_MS
        assertTrue(NotificationReplyPolicy.current("epoch", "epoch", "fp", "fp", start, start))
        assertTrue(NotificationReplyPolicy.current("epoch", "epoch", "fp", "fp", start, start + age))
        assertFalse(NotificationReplyPolicy.current("epoch", "replacement", "fp", "fp", start, start))
        assertFalse(NotificationReplyPolicy.current("epoch", "epoch", "fp", "replacement", start, start))
        assertFalse(NotificationReplyPolicy.current("epoch", "epoch", "fp", "fp", start, start - 1))
        assertFalse(NotificationReplyPolicy.current("epoch", "epoch", "fp", "fp", start, start + age + 1))
    }
    @Test fun suggestionsAreNeverGenerated() { assertFalse(NotificationReplyPolicy.ALLOW_GENERATED_REPLIES) }
    @Test fun exactTypedUnicodeWhitespaceAndEscapesAreNotTrimmedOrRewritten() {
        val text = "  Reply Łódź 👋\n\"quoted\"\t\\ escaped \u0001  "
        assertEquals(text, NotificationReplyPolicy.text(text))
        assertEquals(text, NotificationReplyPolicy.message(request, text)["text"])
    }
    @Test fun limitsUseTheProtocolUtf16BudgetAndRejectBlankOrUnpairedSurrogates() {
        assertEquals(200000, NotificationReplyPolicy.text("x".repeat(200000)).length)
        assertEquals(200000, NotificationReplyPolicy.text("👋".repeat(100000)).length)
        for (text in listOf("", " \n\t", "x".repeat(200001), "👋".repeat(100001), "a\uD800", "a\uDC00")) {
            try { NotificationReplyPolicy.text(text); fail("Accepted invalid text") } catch (_: IllegalArgumentException) {}
        }
    }
    @Test fun maximumEscapedTextFitsDuplicatedDraftAndReadableEncryptedEnvelope() {
        val input = "x" + "\u0001".repeat(NotificationReplyPolicy.MAX_TEXT_UNITS - 1)
        assertEquals(NotificationReplyPolicy.MAX_TEXT_UNITS, NotificationReplyPolicy.text(input).length)
        val escaped = "x" + "\\u0001".repeat(NotificationReplyPolicy.MAX_TEXT_UNITS - 1)
        val plaintext = ("{\"requestId\":\"$request\",\"text\":\"$escaped\",\"item\":{\"message\":{\"text\":\"$escaped\"}}}").toByteArray(Charsets.UTF_8)
        assertTrue(plaintext.size > 2 * 1048576) // Regression: old draft write budget rejected this valid input.
        assertTrue(plaintext.size < NotificationReplyPolicy.MAX_DRAFT_PLAINTEXT_BYTES)
        val key = SecretKeySpec(ByteArray(32) { it.toByte() }, "AES")
        val box = NotificationCipher.encrypt("reply-v1:$request", plaintext, key)
        fun base64(bytes: ByteArray) = Base64.getEncoder().encodeToString(bytes).replace("/", "\\/")
        val encoded = "{\"iv\":\"${base64(box.iv)}\",\"data\":\"${base64(box.ciphertext)}\"}".toByteArray(Charsets.UTF_8)
        assertTrue(encoded.size < NotificationReplyPolicy.MAX_DRAFT_ENCODED_BYTES)
        // Even worst-case slash escaping of base64 fits for a maximum valid draft.
        assertTrue(2 * (((plaintext.size + 16 + 2) / 3) * 4) + 256 < NotificationReplyPolicy.MAX_DRAFT_ENCODED_BYTES)
        assertArrayEquals(plaintext, NotificationCipher.decrypt("reply-v1:$request", box, key))
    }
    @Test fun payloadMatchesExistingMessageAndOutgoingRecoveryShape() {
        val item = NotificationReplyPolicy.item(backend, endpoint, "My Bob", 17, request, "hello", 12345, -12345)
        assertEquals(request, item["id"]); assertEquals("$backend:17", item["scope"])
        assertEquals(17L, item["chat"]); assertEquals(12345L, item["createdAt"]); assertEquals(-12345L, item["localId"])
        assertEquals(emptyList<Any>(), item["files"]); assertEquals(true, item["notificationReply"])
        assertFalse(item.containsKey("admitted")); assertFalse(item.containsKey("entry")); assertFalse(item.containsKey("afterEntryId"))
        assertEquals(mapOf("backendId" to backend, "endpoint" to endpoint, "name" to "My Bob"), item["backend"])
        assertEquals(mapOf("requestId" to request, "text" to "hello", "mode" to "steer", "allowSubagents" to true), item["message"])
        assertFalse((item["message"] as Map<*, *>).containsKey("questionId"))
        assertFalse(item.toString().contains("credential")); assertFalse(item.toString().contains("token"))
    }
    @Test fun invalidIdentityAndChatCannotCreateRecoveryItems() {
        for (chat in listOf(0L, -1L, 9007199254740992L)) {
            try { NotificationReplyPolicy.item(backend, endpoint, "Bob", chat, request, "hello", 1, -1); fail("Accepted invalid chat") }
            catch (_: IllegalArgumentException) {}
        }
        try { NotificationReplyPolicy.item("../bad", endpoint, "Bob", 1, request, "hello", 1, -1); fail("Accepted invalid backend") }
        catch (_: IllegalArgumentException) {}
    }
    @Test fun foregroundBarrierDefaultsClosedAndDoesNotChangeOrdinaryOutboxSends() {
        assertTrue(BobOutboxPolicy.notificationBlocked(true, false, false))
        assertTrue(BobOutboxPolicy.notificationBlocked(true, false, true))
        assertTrue(BobOutboxPolicy.notificationBlocked(true, true, true))
        assertFalse(BobOutboxPolicy.notificationBlocked(true, true, false))
        for (valid in listOf(false, true)) for (blocked in listOf(false, true))
            assertFalse(BobOutboxPolicy.notificationBlocked(false, valid, blocked))
    }
    @Test fun retainedInputPreservesItsIdentityAndRecoveryAfterActionExpiryButNeverAfterPairingChange() {
        val now = 1000L + NotificationReplyPolicy.MAX_AGE_MS + 1
        assertFalse(NotificationReplyPolicy.current("epoch", "epoch", "fp", "fp", 1000, now))
        assertTrue(NotificationReplyPolicy.current("epoch", "epoch", "fp", "fp", 1000, now, retainedInput = true))
        assertEquals(request, NotificationReplyPolicy.requestId(request, false))
        assertFalse(NotificationReplyPolicy.current("epoch", "different", "fp", "fp", 1000, now, retainedInput = true))
        assertFalse(NotificationReplyPolicy.current("epoch", "epoch", "fp", "different", 1000, now, retainedInput = true))
        assertFalse(NotificationReplyPolicy.accepts("original retained reply", "different new input"))
    }
    @Test fun completedActionIgnoresDuplicateInputButReportsDifferentTextWithoutAnotherSend() {
        val hash = NotificationReplyPolicy.textFingerprint("original reply")
        assertFalse(NotificationReplyPolicy.completedInputNeedsFeedback(hash, null))
        assertFalse(NotificationReplyPolicy.completedInputNeedsFeedback(hash, "original reply"))
        assertTrue(NotificationReplyPolicy.completedInputNeedsFeedback(hash, "a different second reply"))
        assertTrue(NotificationReplyPolicy.completedInputNeedsFeedback(null, "new input on legacy tombstone"))
    }
    @Test fun asynchronousStatusCannotReviveViewedOrRevokedPairingNoticesButInputFailuresGiveFeedback() {
        for (viewed in listOf(false, true)) for (paired in listOf(false, true)) {
            assertEquals(!viewed && paired, NotificationReplyPolicy.publishStatus(viewed, paired, false))
            assertTrue(NotificationReplyPolicy.publishStatus(viewed, paired, true))
        }
    }
    @Test fun queuedAThenUnqueuedBFeedbackSurvivesLaterDeliveryStatusForA() {
        val notifications = mutableMapOf<String, Pair<String, String?>>()
        val delivery = NotificationReplyPolicy.statusTag(request, false)
        val feedback = NotificationReplyPolicy.statusTag(request, true)
        notifications[delivery] = "A queued locally" to null
        notifications[feedback] = "B was not queued; open Bob" to "distinct input B"
        notifications[delivery] = "A accepted by Bob's queue" to null
        assertNotEquals(delivery, feedback)
        assertEquals("B was not queued; open Bob" to "distinct input B", notifications[feedback])
        assertEquals("A accepted by Bob's queue" to null, notifications[delivery])
        notifications.remove(delivery) // Native receipt cleanup for A cannot discard B.
        assertEquals("distinct input B", notifications[feedback]?.second)
    }
    @Test fun viewAndPairingCleanupRecognizeBothStatusKindsButNotInstallAlerts() {
        assertTrue(NotificationReplyPolicy.isReplyStatusTag(NotificationReplyPolicy.statusTag(request, false)))
        assertTrue(NotificationReplyPolicy.isReplyStatusTag(NotificationReplyPolicy.statusTag(request, true)))
        assertFalse(NotificationReplyPolicy.isReplyStatusTag("install:$request"))
        assertFalse(NotificationReplyPolicy.isReplyStatusTag(null))
    }
}
