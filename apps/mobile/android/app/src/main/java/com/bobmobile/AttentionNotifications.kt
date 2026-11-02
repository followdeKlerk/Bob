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
    fun post(context: Context, current: () -> Boolean = { true }, sourceChannel: String? = null, sources: Set<String>? = null): ConversationPostResult =
        ConversationPublicationPolicy.run(NotificationWatchStore, current, { NotificationRuntime.appVisible }) {
            if (!enabled(context)) return@run ConversationPostResult.RETRY
            if (sources != null && !sourcesEnabled(context, sources)) return@run ConversationPostResult.RETRY
            if (sourceChannel == "bob-completions-quiet" && !sourcesEnabled(context, setOf("reply"))) return@run ConversationPostResult.RETRY
            val manager = manager(context)
            if (Build.VERSION.SDK_INT >= 26) {
                // Polling retains each source category's user-disabled policy, even
                // though all enabled categories now render the same global notice.
                if (sourceChannel != null && manager.getNotificationChannel(sourceChannel)?.importance == NotificationManager.IMPORTANCE_NONE) return@run ConversationPostResult.RETRY
                // Reuse the existing attention channel so its user's disabled policy survives.
                manager.createNotificationChannel(NotificationChannel(AttentionNotificationPolicy.CHANNEL, "Bob attention", NotificationManager.IMPORTANCE_DEFAULT))
                if (manager.getNotificationChannel(AttentionNotificationPolicy.CHANNEL)?.importance == NotificationManager.IMPORTANCE_NONE) return@run ConversationPostResult.RETRY
            }
            val intent = Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            val open = PendingIntent.getActivity(context, 4101, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val builder = (if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, AttentionNotificationPolicy.CHANNEL) else Notification.Builder(context))
                .setSmallIcon(R.drawable.ic_stat_bob).setContentTitle("Bob").setContentText(AttentionNotificationPolicy.BODY)
                .setContentIntent(open).setAutoCancel(true).setOnlyAlertOnce(true).setVisibility(Notification.VISIBILITY_PRIVATE)
            if (Build.VERSION.SDK_INT >= 29) builder.setAllowSystemGeneratedContextualActions(false)
            if (!current()) return@run ConversationPostResult.RETRY
            if (NotificationRuntime.appVisible) return@run ConversationPostResult.VIEWED
            try {
                migrate(context)
                manager.notify(AttentionNotificationPolicy.TAG, AttentionNotificationPolicy.ID, builder.build())
                ConversationPostResult.POSTED
            } catch (_: SecurityException) { ConversationPostResult.RETRY }
        }
}
