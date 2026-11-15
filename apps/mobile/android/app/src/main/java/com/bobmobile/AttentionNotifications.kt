package com.bobmobile

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build

/** Shared FCM/polling presentation. Never fetches content or creates Reply actions. */
internal object AttentionNotifications {
    private fun manager(context: Context) = context.getSystemService(NotificationManager::class.java)
    fun enabled(context: Context): Boolean = manager(context).areNotificationsEnabled() &&
        (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
        (Build.VERSION.SDK_INT < 26 || manager(context).getNotificationChannel(AttentionNotificationPolicy.CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE)
    fun clear(context: Context) {
        manager(context).cancel(AttentionNotificationPolicy.TAG, AttentionNotificationPolicy.ID)
    }
    fun clearSession(context: Context, identity: String, chat: Long) {
        if (identity.isNotBlank() && chat > 0) manager(context).cancel(AttentionNotificationPolicy.tag(identity, chat, false), 0)
    }
    fun clearBackend(context: Context, identity: String) {
        try { manager(context).activeNotifications.filter { it.tag?.startsWith("${AttentionNotificationPolicy.TAG}:$identity:") == true }.forEach { manager(context).cancel(it.tag, it.id) } } catch (_: Exception) {}
    }
    fun migrate(context: Context) {
        // Fail conservatively: RemoteInput actions/history may contain input that is
        // not yet in our outbox. Never cancel these or reply-status/feedback notices.
        try {
            val manager = manager(context)
            manager.activeNotifications.forEach { row ->
                val notice = row.notification
                if (AttentionNotificationPolicy.migrate(row.tag, if (Build.VERSION.SDK_INT >= 26) notice.channelId else null,
                        notice.actions?.any { !it.remoteInputs.isNullOrEmpty() } == true,
                        !notice.extras?.getCharSequenceArray(Notification.EXTRA_REMOTE_INPUT_HISTORY).isNullOrEmpty())) {
                    manager.cancel(row.tag, row.id)
                }
            }
        } catch (_: Exception) { /* Never risk legacy input to complete migration. */ }
    }
    fun sourcesEnabled(context: Context, sources: Set<String>): Boolean = AttentionNotificationPolicy.anyEnabled(sources,
        context.getSharedPreferences("bob-notification-preferences", Context.MODE_PRIVATE).getBoolean("replies", true)) { channel ->
        Build.VERSION.SDK_INT < 26 || manager(context).getNotificationChannel(channel)?.importance != NotificationManager.IMPORTANCE_NONE
    }
    fun post(context: Context, identity: String, chat: Long = 0, updates: Boolean = false, current: () -> Boolean = { true }, sourceChannel: String? = null, sources: Set<String>? = null): ConversationPostResult =
        ConversationPublicationPolicy.run(NotificationWatchStore, current, { if (chat > 0) NotificationRuntime.viewing(identity, chat) else NotificationRuntime.appVisible && NotificationRuntime.visibleBackend == identity }) {
            if (!enabled(context)) return@run ConversationPostResult.RETRY
            if (sources != null && !sourcesEnabled(context, sources)) return@run ConversationPostResult.RETRY
            if (sourceChannel == "bob-completions-quiet" && !sourcesEnabled(context, setOf("reply"))) return@run ConversationPostResult.RETRY
            val manager = manager(context)
            if (Build.VERSION.SDK_INT >= 26) {
                // Polling retains each source category's user-disabled policy, even
                // though enabled categories share the attention channel.
                if (sourceChannel != null && manager.getNotificationChannel(sourceChannel)?.importance == NotificationManager.IMPORTANCE_NONE) return@run ConversationPostResult.RETRY
                // Reuse the existing attention channel so its user's disabled policy survives.
                manager.createNotificationChannel(NotificationChannel(AttentionNotificationPolicy.CHANNEL, "Bob attention", NotificationManager.IMPORTANCE_DEFAULT))
                if (manager.getNotificationChannel(AttentionNotificationPolicy.CHANNEL)?.importance == NotificationManager.IMPORTANCE_NONE) return@run ConversationPostResult.RETRY
            }
            val workstation = NotificationDisplayLabels.workstation(context, identity)
            val session = if (chat > 0) NotificationDisplayLabels.session(context, identity, chat) else if (updates) "App update ready" else "Sessions need attention"
            val destination = if (chat > 0) "bob://work/$identity/$chat" else if (updates) "bob://updates/$identity" else "bob://sessions/$identity"
            val intent = Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP).setData(android.net.Uri.parse(destination))
            val open = PendingIntent.getActivity(context, 4101, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val builder = (if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, AttentionNotificationPolicy.CHANNEL) else Notification.Builder(context))
                .setSmallIcon(R.drawable.ic_stat_bob).setContentTitle("$workstation · $session").setContentText(AttentionNotificationPolicy.BODY)
                .setContentIntent(open).setAutoCancel(true).setOnlyAlertOnce(true).setVisibility(Notification.VISIBILITY_PRIVATE)
            if (chat > 0) builder.setSubText("Session #$chat")
            if (Build.VERSION.SDK_INT >= 29) builder.setAllowSystemGeneratedContextualActions(false)
            if (!current()) return@run ConversationPostResult.RETRY
            if (if (chat > 0) NotificationRuntime.viewing(identity, chat) else NotificationRuntime.appVisible && NotificationRuntime.visibleBackend == identity) return@run ConversationPostResult.VIEWED
            try {
                migrate(context)
                manager.notify(AttentionNotificationPolicy.tag(identity, chat, updates), AttentionNotificationPolicy.ID, builder.build())
                ConversationPostResult.POSTED
            } catch (_: SecurityException) { ConversationPostResult.RETRY }
        }
}
