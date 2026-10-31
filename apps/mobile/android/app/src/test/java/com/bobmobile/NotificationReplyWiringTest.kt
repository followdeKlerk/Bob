package com.bobmobile

import org.junit.Assert.*
import org.junit.Test
import java.io.File

/** JVM contract checks supplement pure policy tests where the project has no
 * Robolectric/instrumentation dependency. They do not claim SystemUI device coverage. */
class NotificationReplyWiringTest {
    private fun source(name: String) = File("src/main/java/com/bobmobile/$name.kt").readText()
    @Test fun receiverIsExplicitNonExportedAndDoesNotLaunchUiOrTransport() {
        val manifest = File("src/main/AndroidManifest.xml").readText()
        assertTrue(manifest.contains("<receiver android:name=\".BobNotificationReplyReceiver\" android:exported=\"false\" />"))
        val reply = source("BobNotificationReply")
        assertTrue(reply.contains("Intent(context, BobNotificationReplyReceiver::class.java)"))
        assertTrue(reply.contains("val pending = goAsync()")); assertTrue(reply.contains("BobOutboxRuntime.io.execute"))
        assertTrue(reply.contains("finally { pending.finish() }")); assertTrue(reply.contains("BobOutboxRuntime.enqueue("))
        for (forbidden in listOf(".startActivity(", "HttpURLConnection", "OkHttpClient", "ReactApplicationContext", ".putExtra("))
            assertFalse(forbidden, reply.contains(forbidden))
    }
    @Test fun remoteInputIsFreeFormWithoutChoicesAndRequiresUnlockWhenSupported() {
        val reply = source("BobNotificationReply")
        assertTrue(reply.contains(".setAllowFreeFormInput(true)")); assertFalse(reply.contains(".setChoices("))
        assertTrue(reply.contains(".setAllowGeneratedReplies(NotificationReplyPolicy.ALLOW_GENERATED_REPLIES)"))
        assertTrue(reply.contains("if (Build.VERSION.SDK_INT >= 31) setAuthenticationRequired(true)"))
        assertTrue(reply.contains("if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0"))
        assertTrue(reply.contains("if (retry) PendingIntent.FLAG_IMMUTABLE"))
        assertTrue(reply.contains(".isDeviceLocked"))
    }
    @Test fun draftPrecedesEnqueueAndCompletedTombstonePreventsReplayAfterReceiptRemoval() {
        val reply = source("BobNotificationReply")
        assertTrue(reply.indexOf("NotificationReplyStore.write(context, draft)") < reply.indexOf("BobOutboxRuntime.enqueue("))
        assertTrue(reply.indexOf("BobOutboxRuntime.enqueue(") < reply.indexOf("slot.put(\"completed\", true)"))
        val consumed = reply.substringAfter("if (slot.optBoolean(\"completed\")) {").substringBefore("var draft =")
        assertTrue(consumed.contains("return // Tombstone")); assertFalse(consumed.contains("BobOutboxRuntime.enqueue("))
        assertTrue(reply.contains("NotificationReplyPolicy.accepts(draft?.getString(\"text\"), incoming)"))
        assertFalse(reply.contains("config.getString(\"revision\")"))
        assertTrue(reply.contains("builder.setRemoteInputHistory(arrayOf(history))"))
        assertTrue(reply.contains("manager.notify(NotificationReplyPolicy.statusTag(target.id, history != null), 0, builder.build())"))
        assertFalse(reply.contains("ConversationNotifications.clear("))
    }
    @Test fun sharedNativeEnqueueAndWeakMetadataOnlyLiveEventDoNotStartReact() {
        val outbox = source("BobOutbox")
        assertTrue(outbox.contains("BobOutboxRuntime.enqueue(context, endpoint, backendId, credential"))
        assertTrue(outbox.contains("WeakReference<ReactApplicationContext>(null)"))
        assertTrue(outbox.contains("override fun invalidate() { BobOutboxRuntime.unbind(context)"))
        assertTrue(outbox.contains("context.hasActiveReactInstance()"))
        assertTrue(outbox.contains(".emit(\"BobOutboxChanged\", null)"))
        assertTrue(outbox.indexOf("BobOutboxStore.write(context, value!!)") < outbox.indexOf("if (notificationPairing != null) changed()"))
    }
    @Test fun barrierAndPairingAreRecheckedBeforePostNotOnlyAtActionCreation() {
        val worker = source("BobOutboxWorker")
        assertEquals(2, Regex("notificationGate\\(value\\)\\?\\.let").findAll(worker).count())
        assertTrue(worker.contains("BobNotificationReply.pairingCurrent(applicationContext, value)"))
        assertTrue(worker.contains("NotificationReplyBarriers.blocked(applicationContext"))
        val post = worker.indexOf("admission = request(value,")
        assertTrue(worker.lastIndexOf("notificationGate(value)?.let", post) > worker.indexOf("val operation = request"))
        val barriers = source("NotificationReplyBarriers")
        assertTrue(barriers.contains("notificationBlocked(true, false, false)"))
        assertTrue(source("BobOutbox").contains("fun setNotificationReplyBarriers(backendId: String, chats: ReadableArray, promise: Promise)"))
    }
    @Test fun draftsAreEncryptedAtomicAndNeitherContentNorCredentialsAreLogged() {
        val store = source("NotificationReplyStore")
        assertTrue(store.contains("context.noBackupFilesDir")); assertTrue(store.contains("NotificationCipher.encrypt(\"reply-v1:\$id\""))
        assertTrue(store.contains("stream.fd.sync()")); assertTrue(store.contains("target.finishWrite(stream)"))
        assertTrue(store.contains("contentEquals(encoded)"))
        assertTrue(store.contains("out.size() + n <= NotificationReplyPolicy.MAX_DRAFT_ENCODED_BYTES"))
        assertTrue(store.contains("encoded.size <= NotificationReplyPolicy.MAX_DRAFT_ENCODED_BYTES"))
        assertTrue(store.contains("plaintext.size <= NotificationReplyPolicy.MAX_DRAFT_PLAINTEXT_BYTES"))
        assertTrue(store.contains("bytes.size <= NotificationReplyPolicy.MAX_DRAFT_PLAINTEXT_BYTES"))
        for (name in listOf("BobNotificationReply", "NotificationReplyStore", "NotificationReplyPolicy", "NotificationReplyBarriers", "BobOutbox", "BobOutboxWorker")) {
            val code = source(name)
            assertFalse(name, Regex("(?:Log\\.[vdiew]|println|printStackTrace|console\\.log)\\s*\\(").containsMatchIn(code))
        }
    }
    @Test fun usedReplyActionIsAcknowledgedWithoutReplacingNewerConversationContent() {
        val reply = source("BobNotificationReply")
        assertTrue(reply.contains("Notification.Builder.recoverBuilder(context, latest.notification)"))
        assertTrue(reply.contains(".setActions().setRemoteInputHistory(arrayOf(text)).setOnlyAlertOnce(true)"))
        assertTrue(reply.indexOf("slot.put(\"completed\", true)") < reply.indexOf("acknowledgeInput(context, target, text)"))
        assertTrue(reply.contains("if (NotificationRuntime.viewing(target.identity, target.chat)) return"))
        val presentation = source("ConversationNotifications")
        assertTrue(presentation.contains("bob.notification.backend"))
        assertTrue(presentation.contains("bob.notification.chat"))
    }
    @Test fun retainedDraftCannotBeOrphanedByActionReplacementAndOldSendCannotRevertPairing() {
        val reply = source("BobNotificationReply")
        assertTrue(reply.contains("if (retainedInput && !reusable) return@synchronized null"))
        assertTrue(reply.contains("if (retainedInput) retryAction(context, Target(identity, chat, epoch, id))"))
        assertTrue(reply.contains("!slot.optBoolean(\"completed\") && NotificationReplyStore.read(context, target.id) != null"))
        val worker = source("BobOutboxWorker").substringAfter("private fun watch(value: JSONObject)")
        assertTrue(worker.indexOf("ConversationNotificationPolicy.changedPairing(") < worker.indexOf("NotificationWatchStore.update(context, identity)"))
    }
    @Test fun staleActionFeedbackAndAsynchronousStatusChecksUseProductionState() {
        val reply = source("BobNotificationReply")
        assertTrue(reply.contains("NotificationReplyPolicy.completedInputNeedsFeedback(slot.optString(\"completedTextHash\"), incoming)"))
        assertTrue(reply.contains("Your new text was not queued; open Bob to send it."))
        assertTrue(reply.contains("else if (history != null && allowInput)"))
        val status = reply.substringAfter("private fun status(")
        assertTrue(status.contains("synchronized(NotificationWatchStore)"))
        assertTrue(status.contains("NotificationReplyPolicy.publishStatus(NotificationRuntime.viewing(target.identity, target.chat), paired, history != null)"))
    }
    @Test fun directFailedInputAndAsyncDeliveryUseSeparateNotificationIdentities() {
        val reply = source("BobNotificationReply")
        assertTrue(reply.contains("manager.notify(NotificationReplyPolicy.statusTag(target.id, history != null), 0, builder.build())"))
        val cleanup = source("ConversationNotifications")
        assertEquals(2, Regex("NotificationReplyPolicy\\.isReplyStatusTag\\(it.tag\\)").findAll(cleanup).count())
        val outbox = source("BobOutbox")
        assertFalse(outbox.contains("reply-feedback:")) // Receipt removal must not delete unqueued input feedback.
    }
}
