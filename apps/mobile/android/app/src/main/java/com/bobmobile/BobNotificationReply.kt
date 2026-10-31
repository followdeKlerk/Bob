package com.bobmobile

import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import org.json.JSONObject
import java.util.UUID

/** Manual free-form reply only. Intents carry opaque action identity, never pairing
 * credentials/content. All transport remains in the existing encrypted native outbox. */
internal object BobNotificationReply {
    internal const val INPUT_KEY = "bob.notification.manual-reply"
    private const val SEND = "com.bobmobile.NOTIFICATION_REPLY"
    private const val RETRY = "com.bobmobile.NOTIFICATION_REPLY_RETRY"
    private const val SLOTS = "replyActions"
    private const val EPOCH = "replyPairingEpoch"
    private const val FINGERPRINT = "replyPairingFingerprint"
    private const val CHANNEL = "bob-reply-status"
    private data class Target(val identity: String, val chat: Long, val epoch: String, val id: String)

    fun action(context: Context, identity: String, chat: Long): Notification.Action? = try {
        BobOutboxPolicy.identity(identity); BobOutboxPolicy.chat(chat.toDouble())
        synchronized(NotificationWatchStore) {
            val config = NotificationWatchStore.read(context, identity) ?: return@synchronized null
            val fingerprint = fingerprint(identity, config)
            val samePairing = config.optString(FINGERPRINT) == fingerprint && config.optString(EPOCH).isNotEmpty()
            val epoch = if (samePairing) config.getString(EPOCH) else UUID.randomUUID().toString()
            val slots = if (samePairing) config.optJSONObject(SLOTS) ?: JSONObject() else JSONObject()
            // Reclaim only expired empty/completed actions. A failed retained input
            // must never be silently evicted to make room for another chat.
            val now = System.currentTimeMillis()
            for (key in slots.keys().asSequence().toList()) {
                val slot = slots.getJSONObject(key)
                if (now - slot.optLong("createdAt") > NotificationReplyPolicy.MAX_AGE_MS &&
                    (slot.optBoolean("completed") || NotificationReplyStore.read(context, slot.getString("requestId")) == null)) {
                    slots.remove(key)
                }
            }
            val key = chat.toString(); val old = slots.optJSONObject(key)
            if (old == null && slots.length() >= NotificationReplyPolicy.MAX_ACTIONS) return@synchronized null
            val retainedInput = old != null && !old.optBoolean("completed") && NotificationReplyStore.read(context, old.getString("requestId")) != null
            val reusable = old != null && NotificationReplyPolicy.current(epoch, old.optString("epoch"), fingerprint,
                old.optString("fingerprint"), old.optLong("createdAt"), System.currentTimeMillis(), retainedInput)
            // Never replace the only reference to retained input, even on malformed stale metadata.
            if (retainedInput && !reusable) return@synchronized null
            // Re-publication/re-registration must not rotate an outstanding action UUID.
            val id = NotificationReplyPolicy.requestId(if (reusable) old!!.getString("requestId") else null,
                old?.optBoolean("completed") == true)
            val slot = if (reusable && id == old!!.getString("requestId")) old else JSONObject()
                .put("requestId", id).put("epoch", epoch).put("fingerprint", fingerprint).put("createdAt", System.currentTimeMillis())
            slots.put(key, slot)
            NotificationWatchStore.update(context, identity) {
                it.put(EPOCH, epoch).put(FINGERPRINT, fingerprint).put(SLOTS, slots)
            }
            if (retainedInput) retryAction(context, Target(identity, chat, epoch, id)) else inputAction(context, Target(identity, chat, epoch, id))
        }
    } catch (_: Exception) { null }

    /** Parent retains this encrypted pairing record when a notification action survives
     * the last watch job. Ordinary watch revisions do not revoke the pairing epoch. */
    fun hasPendingActions(config: JSONObject): Boolean = (config.optJSONObject(SLOTS)?.length() ?: 0) > 0

    /** Invoke on explicit pairing revocation/change, not ordinary watch re-registration. */
    fun revoke(context: Context, identity: String) {
        synchronized(NotificationWatchStore) {
            val config = NotificationWatchStore.read(context, identity)
            config?.optJSONObject(SLOTS)?.let { slots ->
                for (key in slots.keys()) {
                    val id = slots.getJSONObject(key).getString("requestId")
                    NotificationReplyStore.remove(context, id)
                    context.getSystemService(NotificationManager::class.java).cancel(NotificationReplyPolicy.statusTag(id, false), 0)
                    context.getSystemService(NotificationManager::class.java).cancel(NotificationReplyPolicy.statusTag(id, true), 0)
                }
            }
            if (config != null) NotificationWatchStore.update(context, identity) {
                it.remove(SLOTS); it.remove(EPOCH); it.remove(FINGERPRINT)
            }
            NotificationReplyBarriers.invalidate(context, identity)
        }
    }

    private fun fingerprint(identity: String, config: JSONObject): String {
        val endpoint = PhoneLocationPolicy.endpoint(config.getString("endpoint"), BuildConfig.DEBUG)
        val token = config.getString("token"); require(token.matches(Regex("[A-Za-z0-9_-]{32,128}")))
        return NotificationReplyPolicy.fingerprint(identity, endpoint, token)
    }
    private fun valid(context: Context, config: JSONObject?, target: Target): Boolean = try {
        requireNotNull(config)
        val slot = config.getJSONObject(SLOTS).getJSONObject(target.chat.toString())
        slot.getString("requestId") == target.id && NotificationReplyPolicy.current(target.epoch,
            config.getString(EPOCH), slot.getString("fingerprint"), fingerprint(target.identity, config),
            slot.getLong("createdAt"), System.currentTimeMillis(),
            !slot.optBoolean("completed") && NotificationReplyStore.read(context, target.id) != null)
    } catch (_: Exception) { false }
    internal fun pairingCurrent(context: Context, value: JSONObject): Boolean = try {
        val identity = value.getString("backendId")
        val config = NotificationWatchStore.read(context, identity)
        config != null && config.optString(EPOCH) == value.getString("replyEpoch") &&
            fingerprint(identity, config) == value.getString("replyFingerprint")
    } catch (_: Exception) { false }

    private fun intent(context: Context, target: Target, retry: Boolean = false): Intent =
        Intent(context, BobNotificationReplyReceiver::class.java).setAction(if (retry) RETRY else SEND)
            .setData(Uri.Builder().scheme("bob-reply").authority("manual")
                .appendPath(target.identity).appendPath(target.chat.toString()).appendPath(target.epoch).appendPath(target.id).build())
    private fun pending(context: Context, target: Target, retry: Boolean = false): PendingIntent {
        // RemoteInput requires mutability. Pre-S has no FLAG_MUTABLE requirement;
        // retry has no fill-in data and remains immutable on every supported Android.
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or if (retry) PendingIntent.FLAG_IMMUTABLE
            else if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
        return PendingIntent.getBroadcast(context, 0, intent(context, target, retry), flags)
    }
    private fun inputAction(context: Context, target: Target): Notification.Action {
        val input = RemoteInput.Builder(INPUT_KEY).setLabel("Reply to Bob").setAllowFreeFormInput(true).build()
        return Notification.Action.Builder(android.graphics.drawable.Icon.createWithResource(context, R.drawable.ic_stat_bob),
            "Reply", pending(context, target)).addRemoteInput(input)
            .setAllowGeneratedReplies(NotificationReplyPolicy.ALLOW_GENERATED_REPLIES).apply {
                if (Build.VERSION.SDK_INT >= 28) setSemanticAction(Notification.Action.SEMANTIC_ACTION_REPLY)
                if (Build.VERSION.SDK_INT >= 31) setAuthenticationRequired(true)
            }.build()
    }
    private fun retryAction(context: Context, target: Target): Notification.Action =
        Notification.Action.Builder(android.graphics.drawable.Icon.createWithResource(context, R.drawable.ic_stat_bob),
            "Retry queueing", pending(context, target, true)).setAllowGeneratedReplies(false).apply {
                if (Build.VERSION.SDK_INT >= 31) setAuthenticationRequired(true)
            }.build()
    private fun target(intent: Intent): Target? = try {
        require(intent.action == SEND || intent.action == RETRY)
        val uri = requireNotNull(intent.data); require(uri.scheme == "bob-reply" && uri.authority == "manual")
        val parts = uri.pathSegments; require(parts.size == 4)
        Target(BobOutboxPolicy.identity(parts[0]), BobOutboxPolicy.chat(parts[1].toDouble()),
            BobOutboxPolicy.identity(parts[2]), BobOutboxPolicy.identity(parts[3]))
    } catch (_: Exception) { null }

    /** Called exclusively by the explicit non-exported receiver, on outbox IO. */
    internal fun receive(context: Context, intent: Intent) {
        val target = target(intent) ?: return
        val incoming = if (intent.action == SEND) RemoteInput.getResultsFromIntent(intent)?.getCharSequence(INPUT_KEY)?.toString() else null
        var savedText: String? = incoming
        var draftPersisted = false
        try {
            // Worker takes request lock before watch lock too: no lock inversion when
            // a duplicate action races admission/notification registration.
            synchronized(BobOutboxRuntime.lock(target.id)) {
                synchronized(NotificationWatchStore) {
                    val config = NotificationWatchStore.read(context, target.identity)
                    if (!valid(context, config, target)) {
                        status(context, target, "Reply not queued: pairing changed or action expired. Open Bob to retry.", incoming, false, allowInput = false)
                        return
                    }
                    val slot = config!!.getJSONObject(SLOTS).getJSONObject(target.chat.toString())
                    if (slot.optBoolean("completed")) {
                        // A failed SystemUI acknowledgement may leave this consumed action
                        // visible. Ignore duplicate input, but never silently eat new text.
                        if (NotificationReplyPolicy.completedInputNeedsFeedback(slot.optString("completedTextHash"), incoming))
                            status(context, target, "This action was already used. Your new text was not queued; open Bob to send it.", incoming, false, allowInput = false)
                        return // Tombstone survives native receipt cleanup; never enqueue again.
                    }
                    var draft = NotificationReplyStore.read(context, target.id)
                    draftPersisted = draft != null
                    savedText = draft?.getString("text") ?: incoming
                    if (!NotificationReplyPolicy.accepts(draft?.getString("text"), incoming)) {
                        status(context, target, "The first reply is already retained. Open Bob to send another message.", savedText, true)
                        return
                    }
                    val text = NotificationReplyPolicy.text(requireNotNull(savedText))
                    if (draft == null) {
                        draft = JSONObject().put("requestId", target.id).put("text", text).put("createdAt", System.currentTimeMillis())
                        NotificationReplyStore.write(context, draft)
                        draftPersisted = true
                    }
                    // API 31+ asks SystemUI to authenticate. Older versions still fail
                    // closed at the receiver; exact input is retained for unlocked retry.
                    if (context.getSystemService(KeyguardManager::class.java).isDeviceLocked) {
                        status(context, target, "Unlock your phone, then retry queueing this reply.", text, true)
                        return
                    }
                    var item = draft.optJSONObject("item")
                    if (item == null) {
                        val now = draft.getLong("createdAt")
                        val localId = minOf(-now, BobOutboxStore.all(context).minOfOrNull {
                            JSONObject(it.getString("itemJson")).getLong("localId") - 1
                        } ?: -now)
                        item = JSONObject(NotificationReplyPolicy.item(target.identity, config.getString("endpoint"),
                            config.optString("name", "Bob"), target.chat, target.id, text, now, localId))
                        draft.put("item", item); NotificationReplyStore.write(context, draft)
                    }
                    // No direct HTTP, activity or JS. This is only queued, not delivered.
                    BobOutboxRuntime.enqueue(context, config.getString("endpoint"), target.identity, config.getString("token"),
                        target.chat.toDouble(), target.id, item.getJSONObject("message").toString(), "[]", item.toString(), false,
                        target.epoch to fingerprint(target.identity, config))
                    slot.put("completed", true).put("completedTextHash", NotificationReplyPolicy.textFingerprint(text))
                    NotificationWatchStore.update(context, target.identity) { it.getJSONObject(SLOTS).put(target.chat.toString(), slot) }
                    NotificationReplyStore.remove(context, target.id)
                    // Only an explicit successful handoff of this same retained input resolves its feedback.
                    // Later asynchronous delivery for A must never dismiss distinct, unqueued B.
                    try { context.getSystemService(NotificationManager::class.java).cancel(NotificationReplyPolicy.statusTag(target.id, true), 0) } catch (_: Exception) {}
                    acknowledgeInput(context, target, text)
                    status(context, target, if (NotificationReplyBarriers.blocked(context, target.identity, target.chat))
                        "Reply queued on this phone, waiting for earlier foreground sends. Delivery not confirmed."
                        else "Reply queued on this phone. Delivery not confirmed.", null, false)
                }
            }
        } catch (_: IllegalArgumentException) {
            status(context, target, "Reply not queued. Enter 1–200,000 characters of valid text; your input is retained below.", savedText, false)
        } catch (_: Exception) {
            // Keystore/disk failure may prevent even draft persistence. Keep the input
            // in private OS RemoteInput history as well; never log it or claim success.
            status(context, target, if (draftPersisted)
                "Queue handoff not confirmed. Your input is retained; unlock and retry this same reply, or open Bob."
                else "Phone storage unavailable; queue handoff not confirmed. Copy your input from Android’s reply field/history before retrying.",
                savedText, draftPersisted)
        }
    }

    /** Under the watch lock, copy the current notice instead of restoring stale incoming text.
     * Clear its used action and acknowledge RemoteInput; a later incoming notice creates a fresh action. */
    private fun acknowledgeInput(context: Context, target: Target, text: String) {
        try {
            val manager = context.getSystemService(NotificationManager::class.java)
            val tag = ConversationNotifications.tag(target.identity, target.chat)
            val latest = manager.activeNotifications.firstOrNull { it.tag == tag && it.id == 0 } ?: return
            if (NotificationRuntime.viewing(target.identity, target.chat)) return
            val builder = Notification.Builder.recoverBuilder(context, latest.notification)
                .setActions().setRemoteInputHistory(arrayOf(text)).setOnlyAlertOnce(true)
            if (Build.VERSION.SDK_INT >= 29) builder.setAllowSystemGeneratedContextualActions(false)
            manager.notify(tag, 0, builder.build())
        } catch (_: Exception) { /* Separate queue status and encrypted outbox remain available. */ }
    }

    internal fun reportOutbox(context: Context, value: JSONObject) {
        if (!value.optBoolean("notificationReply")) return
        val target = Target(value.getString("backendId"), value.getLong("chat"), value.getString("replyEpoch"), value.getString("requestId"))
        val text = when {
            value.getString("state") == "rejected" -> "Reply needs attention. Open Bob to check delivery or retry this same request."
            value.has("admission") -> "Reply accepted by Bob’s queue."
            else -> "Reply queued on this phone. Delivery not confirmed; automatic retry scheduled."
        }
        status(context, target, text, null, false)
    }
    private fun status(context: Context, target: Target, text: String, history: String?, retry: Boolean, allowInput: Boolean = true) {
        try {
            synchronized(NotificationWatchStore) {
            val paired = if (history != null) false else {
                val config = NotificationWatchStore.read(context, target.identity)
                config != null && config.optString(EPOCH) == target.epoch && config.optString(FINGERPRINT) == fingerprint(target.identity, config)
            }
            if (!NotificationReplyPolicy.publishStatus(NotificationRuntime.viewing(target.identity, target.chat), paired, history != null)) return
            val manager = context.getSystemService(NotificationManager::class.java)
            if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel(CHANNEL, "Outgoing reply status", NotificationManager.IMPORTANCE_LOW))
            val openIntent = Intent(context, MainActivity::class.java).setData(Uri.parse("bob://work/${target.identity}/${target.chat}"))
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            val open = PendingIntent.getActivity(context, 0, openIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val builder = (if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, CHANNEL) else Notification.Builder(context))
                .setSmallIcon(R.drawable.ic_stat_bob).setContentTitle("Bob reply status").setContentText(text)
                .setStyle(Notification.BigTextStyle().bigText(text)).setContentIntent(open).setAutoCancel(true)
                .setOnlyAlertOnce(true).setVisibility(Notification.VISIBILITY_PRIVATE)
                .addExtras(Bundle().apply { putString("bob.notification.backend", target.identity); putLong("bob.notification.chat", target.chat) })
            if (Build.VERSION.SDK_INT >= 29) builder.setAllowSystemGeneratedContextualActions(false)
            if (history != null) builder.setRemoteInputHistory(arrayOf(history))
            if (retry) builder.addAction(retryAction(context, target))
            else if (history != null && allowInput) builder.addAction(inputAction(context, target))
            // Never replace/cancel the conversation notice: a newer reply can have
            // arrived while enqueue was running. Status has its own stable request tag.
            manager.notify(NotificationReplyPolicy.statusTag(target.id, history != null), 0, builder.build())
            }
        } catch (_: Exception) { /* Permission/channel/storage issues: never log input or credentials. */ }
    }
}

@androidx.annotation.Keep
class BobNotificationReplyReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pending = goAsync()
        val app = context.applicationContext
        try {
            BobOutboxRuntime.io.execute {
                try { BobNotificationReply.receive(app, intent) }
                finally { pending.finish() }
            }
        } catch (_: Exception) { pending.finish() }
    }
}
