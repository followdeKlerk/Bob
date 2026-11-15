package com.bobmobile

import org.junit.Assert.*
import org.junit.Test
import java.io.File

class AttentionNotificationPolicyTest {
    private val backend = "c0bb0c00-0000-4000-8000-000000000001"
    private val data = mapOf("type" to "bob_attention", "backendId" to backend, "sources" to "reply")
    private fun accepts(value: Map<String, String> = data, from: String? = "123", notification: Boolean = false, paired: Set<String> = setOf(backend)) =
        AttentionNotificationPolicy.accepts(value, from, "123", notification, paired)
    private fun source(name: String) = File("src/main/java/com/bobmobile/$name.kt").readText()

    @Test fun onlyExactDataHintsFromOurProjectForAnEnabledPairingAreAccepted() {
        assertTrue(accepts())
        assertFalse(accepts(from = null)); assertFalse(accepts(from = "foreign"))
        assertFalse(accepts(notification = true)); assertFalse(accepts(paired = emptySet()))
        assertFalse(accepts(value = emptyMap())); assertFalse(accepts(value = mapOf("type" to "bob_attention")))
        assertFalse(accepts(value = data + ("type" to "unknown")))
        assertFalse(accepts(value = data + ("backendId" to "removed")))
        assertFalse(accepts(value = data + ("text" to "private preview")))
        assertFalse(accepts(value = data + ("chatId" to "42")))
    }
    @Test fun scopedHintsAreStrictBoundedAndNeverContainTitlesOrMessageText() {
        assertTrue(accepts(value = data + ("context" to "reply:19")))
        assertTrue(accepts(value = data + mapOf("sources" to "reply,question,update", "context" to "reply:19,question:20,update:0")))
        assertEquals(listOf(AttentionNotificationPolicy.Target("reply", 19L)), AttentionNotificationPolicy.targets("reply:19"))
        for (invalid in listOf("", "reply:-1", "reply:1.5", "reply:01", "reply:1,reply:1", "reply:9007199254740992", "reply:999999999999999999999999", "update:19", "unknown:7", "reply:7:private", "reply: 7")) {
            assertNull(invalid, AttentionNotificationPolicy.targets(invalid))
            assertFalse(invalid, accepts(value = data + ("context" to invalid)))
        }
        assertFalse(accepts(value = data + ("context" to "question:19")))
        assertFalse(accepts(value = data + ("context" to "reply:19,question:20")))
        assertNull(AttentionNotificationPolicy.targets((1..33).joinToString(",") { "reply:$it" }))
    }
    @Test fun noticeIdentityIsWorkstationAndSessionScopedAndMigrationPreservesNewNotices() {
        val other = "c0bb0c00-0000-4000-8000-000000000002"
        val first = AttentionNotificationPolicy.tag(backend, 7, false)
        assertNotEquals(first, AttentionNotificationPolicy.tag(other, 7, false))
        assertNotEquals(first, AttentionNotificationPolicy.tag(backend, 8, false))
        assertNotEquals(AttentionNotificationPolicy.tag(backend, 0, true), AttentionNotificationPolicy.tag(backend, 0, false))
        assertFalse(AttentionNotificationPolicy.migrate(first, "bob-attention", false, false))
        assertEquals("Home PC", AttentionNotificationPolicy.label(" Home\nPC\u202e ", 40))
        assertTrue(source("AttentionNotifications").contains("setData(android.net.Uri.parse(destination))"))
        assertTrue(source("AttentionNotifications").contains("bob://work/$" + "identity/$" + "chat"))
        assertTrue(source("AttentionNotifications").contains("NotificationDisplayLabels.workstation"))
        assertTrue(source("AttentionNotifications").contains("NotificationDisplayLabels.session"))
        assertTrue(source("AttentionNotifications").contains("clearSession"))
    }
    @Test fun sourceUnionIsStrictAndRespectsReplyAndCategoryDisablePolicies() {
        assertEquals(setOf("question", "reply"), AttentionNotificationPolicy.sources("question,reply"))
        assertEquals(setOf("reply", "question", "schedule", "update"), AttentionNotificationPolicy.sources("reply,question,schedule,update"))
        for (invalid in listOf("", ",", "reply,", ",reply", "reply,reply", "reply,unknown", "Reply", " question", "reply, question", "question,,reply")) {
            assertNull(invalid, AttentionNotificationPolicy.sources(invalid))
            assertFalse(invalid, accepts(value = data + ("sources" to invalid)))
        }
        assertFalse(accepts(value = data - "sources"))
        assertFalse(AttentionNotificationPolicy.anyEnabled(setOf("reply"), false) { true })
        assertFalse(AttentionNotificationPolicy.anyEnabled(setOf("reply"), true) { it != "bob-completions-quiet" })
        assertFalse(AttentionNotificationPolicy.anyEnabled(setOf("schedule", "update"), true) { false })
        assertTrue(AttentionNotificationPolicy.anyEnabled(setOf("reply", "question"), false) { it == "bob-attention" })
        assertTrue(AttentionNotificationPolicy.anyEnabled(setOf("update", "schedule"), false) { it == "bob-schedules" })
        assertFalse(AttentionNotificationPolicy.anyEnabled(setOf("unknown"), true) { true })
    }
    @Test fun migrationNeverDeletesPotentialRemoteInputOrOutboxFeedback() {
        for (tag in listOf("conversation:$backend:1", null)) {
            assertTrue(AttentionNotificationPolicy.migrate(tag, "bob-updates", false, false))
            assertFalse(AttentionNotificationPolicy.migrate(tag, "bob-updates", true, false))
            assertFalse(AttentionNotificationPolicy.migrate(tag, "bob-updates", false, true))
        }
        for (tag in listOf("reply-status:request", "reply-feedback:request", AttentionNotificationPolicy.TAG))
            assertFalse(AttentionNotificationPolicy.migrate(tag, "bob-attention", false, false))
        assertFalse(AttentionNotificationPolicy.migrate(null, "bob-location", false, false))
        assertFalse(AttentionNotificationPolicy.migrate(null, "bob-reply-status", false, false))
    }
    @Test fun scopedPresentationContainsWorkstationAndSessionButNoMessagePreviewOrReply() {
        val attention = source("AttentionNotifications")
        assertTrue(attention.contains("setContentText(AttentionNotificationPolicy.BODY)"))
        assertEquals("Bob needs your attention", AttentionNotificationPolicy.BODY)
        assertTrue(attention.contains(".setOnlyAlertOnce(true)"))
        assertTrue(attention.contains("manager.notify(AttentionNotificationPolicy.tag(identity, chat, updates), AttentionNotificationPolicy.ID"))
        for (forbidden in listOf("MessagingStyle", "BigTextStyle", "addAction(", "RemoteInput.Builder", "HttpURLConnection", "OkHttpClient")) assertFalse(forbidden, attention.contains(forbidden))
        val checks = source("BobNotifications").substringAfter("private class NotificationChecks")
        assertTrue(checks.contains("AttentionNotifications.post(context, identity, chat, current = current, sourceChannel = channel)"))
        assertFalse(checks.contains("ConversationNotifications.post(")); assertFalse(checks.contains("optString(\"text\")"))
        assertTrue(checks.contains("if (!delivered) return"))
        assertTrue(checks.indexOf("if (!delivered) return") < checks.indexOf("putLong(\"cursor:"))
        assertTrue(checks.contains("ConversationPostResult.RETRY -> return false"))
        assertTrue(checks.contains("ConversationPostResult.VIEWED -> return true"))
    }
    @Test fun displayIsGatedByVisibilityPermissionChannelAndCurrentPairing() {
        val attention = source("AttentionNotifications")
        assertTrue(attention.contains("ConversationPublicationPolicy.run(NotificationWatchStore, current, { if (chat > 0) NotificationRuntime.viewing(identity, chat)"))
        assertTrue(attention.contains("Manifest.permission.POST_NOTIFICATIONS"))
        assertTrue(attention.contains("if (sources != null && !sourcesEnabled(context, sources))"))
        assertTrue(source("BobNotifications").contains("setReplyNotifications(enabled: Boolean) { synchronized(NotificationWatchStore)"))
        assertTrue(attention.contains("getNotificationChannel(AttentionNotificationPolicy.CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE"))
        assertTrue(attention.contains("getNotificationChannel(sourceChannel)?.importance == NotificationManager.IMPORTANCE_NONE"))
        val service = source("BobPush").substringAfter("class BobMessagingService").substringBefore("class BobPushRegistrationWorker")
        assertTrue(service.contains("BobPush.registered(applicationContext)"))
        assertTrue(service.contains("identity in BobPush.registered(applicationContext)"))
        assertFalse(service.contains("Tasks.await")); assertFalse(service.contains(".execute()"))
        val push = source("BobPush")
        assertTrue(push.contains("it.put(\"paired\", false).put(\"registered\", false)"))
        assertTrue(push.contains("it.optBoolean(\"registered\") && it.optBoolean(\"paired\")"))
    }
    @Test fun registrationUsesEncryptedMetadataNoReplayAndDoesNotDisablePolling() {
        val push = source("BobPush")
        assertTrue(push.contains("BobPushStore : EncryptedNotificationStore"))
        assertTrue(push.contains("putString(\"identity\", identity)"))
        assertFalse(push.contains("putString(\"token\"")); assertFalse(push.contains("putString(\"credential\""))
        assertTrue(push.contains("followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)"))
        assertTrue(push.contains("ExistingWorkPolicy.APPEND_OR_REPLACE"))
        assertFalse(push.contains("ExistingWorkPolicy.REPLACE,"))
        assertTrue(push.contains("runAttemptCount >= 4"))
        assertTrue(push.contains("response.code >= 500) return retry()"))
        assertTrue(push.contains(".header(\"x-bob-backend\", identity)"))
        assertTrue(push.contains(".header(\"Authorization\", \"Bearer \$credential\")"))
        assertTrue(push.contains("else request.delete()"))
        assertTrue(push.contains("response.code == 429 || response.code >= 500"))
        assertTrue(push.contains("if (!BuildConfig.BOB_PUSH_CONFIGURED) return Result.success()"))
        assertFalse(push.contains("cancelUniquePeriodicWork")); assertFalse(push.contains("NotificationWatchStore.remove"))
        assertFalse(Regex("(?:Log\\.[vdiew]|println|printStackTrace)\\s*\\(").containsMatchIn(push))
        val revoke = source("BobNotificationReply").substringAfter("fun revoke(").substringBefore("private fun fingerprint")
        assertFalse(revoke.contains("NotificationReplyStore.remove")); assertFalse(revoke.contains(".cancel("))
    }
}
