package com.bobmobile

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Person
import android.content.Context
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.BitmapFactory
import android.graphics.drawable.Icon
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

/** Bounded, encrypted preview cache inside the existing watch. Not a new notification feed. */
internal object ConversationNotifications {
    private const val HISTORY = "conversationNotifications"
    fun tag(identity: String, chat: Long) = ConversationNotificationPolicy.tag(identity, chat)
    private fun manager(context: Context) = context.getSystemService(NotificationManager::class.java)
    private fun history(value: JSONObject) = value.optJSONArray(HISTORY) ?: JSONArray()
    private fun rows(value: JSONArray) = (0 until value.length()).mapNotNull { value.optJSONObject(it) }
    private fun notices(row: JSONObject?) = rows(row?.optJSONArray("messages") ?: JSONArray()).mapNotNull {
        val id = it.optString("id"); val text = it.optString("text")
        if (id.isBlank() || text.isBlank()) null else ConversationNotice(id, text, it.optLong("at"))
    }
    fun clear(context: Context, identity: String, chat: Long) {
        try {
        if (identity.isBlank() || chat <= 0) return
        synchronized(NotificationWatchStore) {
            manager(context).cancel(tag(identity, chat), 0)
            manager(context).activeNotifications.filter { NotificationReplyPolicy.isReplyStatusTag(it.tag) && it.notification.extras?.getString("bob.notification.backend") == identity && it.notification.extras?.getLong("bob.notification.chat") == chat }.forEach { manager(context).cancel(it.tag, it.id) }
            // Clear notices posted before conversation-style notifications were introduced.
            for (kind in listOf("reply", "question", "schedule")) manager(context).cancel(("$kind:$identity:$chat").hashCode())
            val value = NotificationWatchStore.read(context, identity) ?: return
            if (value.has(HISTORY)) NotificationWatchStore.update(context, identity) { it.put(HISTORY, JSONArray(rows(history(value)).filter { row -> row.optLong("chat") != chat })) }
        }
        } catch (_: Exception) { /* Cache/storage failures must not crash activity lifecycle callbacks. */ }
    }
    fun clearBackend(context: Context, identity: String) {
        synchronized(NotificationWatchStore) {
            manager(context).activeNotifications.filter { (it.tag?.startsWith("conversation:$identity:") == true) || (NotificationReplyPolicy.isReplyStatusTag(it.tag) && it.notification.extras?.getString("bob.notification.backend") == identity) }.forEach { manager(context).cancel(it.tag, it.id) }
            val value = NotificationWatchStore.read(context, identity)
            if (value != null) {
                rows(history(value)).forEach { row -> manager(context).cancel(tag(identity, row.optLong("chat")), 0) }
                NotificationWatchStore.update(context, identity) { it.remove(HISTORY) }
            }
        }
        if (Build.VERSION.SDK_INT >= 25) try {
            val shortcuts = context.getSystemService(ShortcutManager::class.java)
            val entries = if (Build.VERSION.SDK_INT >= 30) shortcuts.getShortcuts(ShortcutManager.FLAG_MATCH_DYNAMIC or ShortcutManager.FLAG_MATCH_CACHED or ShortcutManager.FLAG_MATCH_PINNED) else shortcuts.dynamicShortcuts
            val ids = entries.filter { it.id.startsWith("bob-chat-${digest(identity)}-") }.map { it.id }
            shortcuts.removeDynamicShortcuts(ids)
            if (Build.VERSION.SDK_INT >= 30) shortcuts.removeLongLivedShortcuts(ids)
        } catch (_: Exception) { /* OS-owned shortcut quota must not prevent clearing a notice. */ }
    }
    private fun digest(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).take(12).joinToString("") { "%02x".format(it) }
    private fun shortcut(context: Context, identity: String, chat: Long, title: String, intent: Intent): String? {
        if (Build.VERSION.SDK_INT < 30) return null
        return try {
            val id = "bob-chat-${digest(identity)}-$chat"
            val bob = Person.Builder().setName("Bob").setKey("bob:$identity:$chat").build()
            val shortcut = ShortcutInfo.Builder(context, id).setShortLabel(title.take(40)).setLongLabel(title)
                .setIcon(Icon.createWithResource(context, R.drawable.bob_notification_logo)).setIntent(intent)
                .setLongLived(true).setPersons(arrayOf(bob)).build()
            // pushDynamicShortcut obeys the launcher quota and evicts older dynamic entries.
            context.getSystemService(ShortcutManager::class.java).apply { pushDynamicShortcut(shortcut); enableShortcuts(listOf(id)) }
            id
        } catch (_: Exception) { null }
    }
    fun post(context: Context, identity: String, chat: Long, event: ConversationNotice, title: String?, channel: String, reply: Boolean, current: () -> Boolean, questionPending: Boolean? = null): ConversationPostResult {
        if (chat <= 0 || !current()) return ConversationPostResult.RETRY
        return ConversationPublicationPolicy.run(NotificationWatchStore, current, { NotificationRuntime.viewing(identity, chat) }) {
            val watch = NotificationWatchStore.read(context, identity) ?: return ConversationPostResult.RETRY
            if (NotificationRuntime.viewing(identity, chat)) return ConversationPostResult.VIEWED
            val manager = manager(context)
            if (!current() || !manager.areNotificationsEnabled()) return ConversationPostResult.RETRY
            if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(channel)?.importance == NotificationManager.IMPORTANCE_NONE) return ConversationPostResult.RETRY
            val all = rows(history(watch)).filter { it.optLong("chat") > 0 }
            val old = all.find { it.optLong("chat") == chat }
            val name = ConversationNotificationPolicy.title(title?.takeIf { it.isNotBlank() } ?: old?.optString("title").orEmpty(), chat)
            val pending = questionPending // Unknown metadata never grants a Reply action; preview history is not authority.
            val messages = ConversationNotificationPolicy.append(notices(old), event)
            val row = JSONObject().put("chat", chat).put("title", name).put("questionPending", pending ?: JSONObject.NULL).put("messages", JSONArray(messages.map { JSONObject().put("id", it.id).put("text", it.text).put("at", it.at) }))
            val retained = (all.filter { it.optLong("chat") != chat } + row).takeLast(ConversationNotificationPolicy.MAX_CONVERSATIONS).toMutableList()
            // Include JSON escaping/Unicode in the bound. Leave room for work metadata and ciphertext base64.
            while (retained.size > 1 && JSONArray(retained).toString().toByteArray(Charsets.UTF_8).size > 45000) retained.removeAt(0)
            val intent = Intent(context, MainActivity::class.java).setAction(Intent.ACTION_VIEW)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .setData(android.net.Uri.parse("bob://work/$identity/$chat"))
            val open = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val style: Notification.MessagingStyle
            if (Build.VERSION.SDK_INT >= 28) {
                style = Notification.MessagingStyle(Person.Builder().setName("You").setKey("owner:$identity").build())
                    .setConversationTitle(name).setGroupConversation(false)
                // One Bob persona per conversation prevents Android merging unrelated chats.
                val bob = Person.Builder().setName("Bob · $name").setKey("bob:$identity:$chat").build()
                messages.forEach { style.addMessage(Notification.MessagingStyle.Message(it.text, it.at, bob)) }
            } else {
                @Suppress("DEPRECATION")
                style = Notification.MessagingStyle("You").setConversationTitle(name)
                @Suppress("DEPRECATION")
                messages.forEach { style.addMessage(it.text, it.at, "Bob · $name") }
            }
            val builder = (if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, channel) else Notification.Builder(context))
                .setSmallIcon(R.drawable.ic_stat_bob).setLargeIcon(BitmapFactory.decodeResource(context.resources, R.drawable.bob_notification_logo))
                .setContentTitle(name).setContentText(event.text.take(ConversationNotificationPolicy.MAX_TEXT)).setStyle(style)
                .setContentIntent(open).setCategory(Notification.CATEGORY_MESSAGE).setAutoCancel(true)
                .setVisibility(Notification.VISIBILITY_PRIVATE).setOnlyAlertOnce(notices(old).any { it.id == event.id })
            if (Build.VERSION.SDK_INT >= 29) builder.setAllowSystemGeneratedContextualActions(false)
            shortcut(context, identity, chat, name, intent)?.let { builder.setShortcutId(it) }
            if (ConversationNotificationPolicy.allowReply(reply, pending)) BobNotificationReply.action(context, identity, chat)?.let { builder.addAction(it) }
            if (!current()) return ConversationPostResult.RETRY
            if (NotificationRuntime.viewing(identity, chat)) return ConversationPostResult.VIEWED
            return try {
                manager.notify(tag(identity, chat), 0, builder.build())
                NotificationWatchStore.update(context, identity) { it.put(HISTORY, JSONArray(retained)) }
                for (kind in listOf("reply", "question", "schedule")) manager.cancel(("$kind:$identity:$chat").hashCode())
                ConversationPostResult.POSTED // Accepted by Android, not a receipt that the person saw it.
            } catch (_: Exception) { ConversationPostResult.RETRY }
        }
    }
}
