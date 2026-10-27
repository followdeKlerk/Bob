package com.bobmobile

import android.Manifest
import android.app.*
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.os.Build
import androidx.work.*
import com.facebook.react.bridge.*
import com.facebook.react.common.LifecycleState
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.util.UUID
import java.util.concurrent.TimeUnit

internal object NotificationRuntime {
    @Volatile var appVisible = false
    @Volatile var visibleBackend = ""
    @Volatile var visibleChat = 0L
    fun viewing(identity: String, chat: Long) = appVisible && visibleBackend == identity && visibleChat == chat
}
private fun notificationConstraints() = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
internal fun scheduleNotificationCheck(context: Context, identity: String) {
    val request = OneTimeWorkRequestBuilder<BobNotificationWorker>()
        .setInputData(Data.Builder().putString("identity", identity).build()).setConstraints(notificationConstraints())
        .setBackoffCriteria(BackoffPolicy.LINEAR, 10, TimeUnit.SECONDS).build()
    WorkManager.getInstance(context).enqueueUniqueWork("bob-notifications:$identity", ExistingWorkPolicy.REPLACE, request)
}
private fun schedulePeriodicNotifications(context: Context, identity: String) {
    val request = PeriodicWorkRequestBuilder<BobNotificationWorker>(15, TimeUnit.MINUTES)
        .setInitialDelay(15, TimeUnit.MINUTES)
        .setInputData(Data.Builder().putString("identity", identity).build()).setConstraints(notificationConstraints())
        .setBackoffCriteria(BackoffPolicy.LINEAR, 10, TimeUnit.SECONDS).build()
    WorkManager.getInstance(context).enqueueUniquePeriodicWork("bob-update-check:$identity", ExistingPeriodicWorkPolicy.KEEP, request)
}
class BobNotifications(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    init {
        NotificationRuntime.appVisible = context.lifecycleState == LifecycleState.RESUMED
        context.addLifecycleEventListener(object : LifecycleEventListener {
            override fun onHostResume() { NotificationRuntime.appVisible = true }
            override fun onHostPause() { NotificationRuntime.appVisible = false }
            override fun onHostDestroy() { NotificationRuntime.appVisible = false }
        })
        // Remove only the obsolete generic monitor; the separate location FGS is untouched.
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.cancel(4100)
        if (Build.VERSION.SDK_INT >= 26) try { manager.deleteNotificationChannel("bob-monitor-quiet") } catch (_: Exception) {}
    }
    override fun getName() = "BobNotifications"
    private fun register(endpoint: String, identity: String, token: String, mutate: (JSONObject) -> Unit) {
        val origin = PhoneLocationPolicy.endpoint(endpoint, BuildConfig.DEBUG)
        UUID.fromString(identity); require(token.matches(Regex("[A-Za-z0-9_-]{32,128}")))
        if (Build.VERSION.SDK_INT >= 33) require(context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) { "Notification permission required" }
        synchronized(NotificationWatchStore) {
            NotificationWatchStore.update(context, identity) { value ->
                value.put("endpoint", origin).put("token", token).put("revision", UUID.randomUUID().toString()); mutate(value)
            }
            scheduleNotificationCheck(context, identity)
            if (NotificationWatchStore.read(context, identity)?.optBoolean("updates") == true) schedulePeriodicNotifications(context, identity)
        }
    }
    @ReactMethod fun watch(endpoint: String, identity: String, token: String, chat: Double, request: String, promise: Promise) {
        try {
            require(chat > 0 && chat % 1.0 == 0.0 && chat <= 9007199254740991.0); UUID.fromString(request)
            val key = "$identity:${chat.toLong()}:$request"
            if (!context.getSharedPreferences("bob-notification-receipts", Context.MODE_PRIVATE).getStringSet("settled", emptySet())!!.contains(key)) {
                register(endpoint, identity, token) { value ->
                    val work = value.optJSONObject("work") ?: JSONObject()
                    require(work.has(key) || work.length() < 32) { "Notification queue is full" }
                    work.put(key, JSONObject().put("chat", chat.toLong()).put("request", request)); value.put("work", work)
                }
            }
            promise.resolve("Alert check scheduled; Android may defer background work")
        } catch (_: Exception) { promise.reject("notification", "Unable to schedule reply notifications") }
    }
    @ReactMethod fun watchUpdates(endpoint: String, identity: String, token: String, name: String, promise: Promise) {
        try { register(endpoint, identity, token) { it.put("updates", true).put("name", name.take(100)) }; promise.resolve(true) }
        catch (_: Exception) { promise.reject("notification", "Unable to schedule update notifications") }
    }
    @ReactMethod fun openSettings(promise: Promise) {
        try { context.startActivity(Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); promise.resolve(true) }
        catch (e: Exception) { promise.reject("notification", "Unable to open notification settings", e) }
    }
    @ReactMethod fun setReplyNotifications(enabled: Boolean) { context.getSharedPreferences("bob-notification-preferences", Context.MODE_PRIVATE).edit().putBoolean("replies", enabled).apply() }
    @ReactMethod fun setAppContext(identity: String, chat: Double) {
        NotificationRuntime.visibleBackend = identity; NotificationRuntime.visibleChat = if (chat > 0 && chat % 1.0 == 0.0) chat.toLong() else 0
        if (NotificationRuntime.appVisible && chat > 0) {
            val manager = context.getSystemService(NotificationManager::class.java)
            manager.cancel(("reply:$identity:${chat.toLong()}").hashCode()); manager.cancel(("question:$identity:${chat.toLong()}").hashCode())
        }
    }
    @ReactMethod fun stop(promise: Promise) {
        try {
            synchronized(NotificationWatchStore) {
                for (identity in NotificationWatchStore.identities(context)) {
                    val value = NotificationWatchStore.read(context, identity) ?: continue
                    if (value.optBoolean("updates")) {
                        NotificationWatchStore.update(context, identity) { it.put("work", JSONObject()).put("revision", UUID.randomUUID().toString()) }
                        scheduleNotificationCheck(context, identity)
                    } else { NotificationWatchStore.remove(context, identity); WorkManager.getInstance(context).cancelUniqueWork("bob-notifications:$identity"); WorkManager.getInstance(context).cancelUniqueWork("bob-update-check:$identity") }
                }
            }
            promise.resolve(true)
        } catch (_: Exception) { promise.reject("notification", "Unable to clear notification checks") }
    }
}

/** Short, OS-scheduled background checks: never promoted to a foreground worker/service.
 * There is no generic ongoing notification. Timing is best-effort under Android quotas/Doze. */
@androidx.annotation.Keep
class BobNotificationWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    override fun doWork(): Result {
        val identity = inputData.getString("identity") ?: return Result.failure()
        val config = NotificationWatchStore.read(applicationContext, identity) ?: return Result.success()
        val revision = config.optString("revision")
        val current = { !isStopped && NotificationWatchStore.read(applicationContext, identity)?.optString("revision") == revision }
        val notifications = applicationContext.getSystemService(NotificationManager::class.java)
        if (!notifications.areNotificationsEnabled() || (Build.VERSION.SDK_INT >= 33 && applicationContext.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)) {
            NotificationWatchStore.ifCurrent(applicationContext, identity, revision) {
                NotificationWatchStore.remove(applicationContext, identity)
                WorkManager.getInstance(applicationContext).cancelUniqueWork("bob-update-check:$identity")
            }
            return Result.success()
        }
        var activeBuild = false
        try {
            UUID.fromString(identity); PhoneLocationPolicy.endpoint(config.getString("endpoint"), BuildConfig.DEBUG)
            val checks = NotificationChecks(applicationContext, current)
            activeBuild = checks.check(identity, config)
        } catch (_: SecurityException) {
            NotificationWatchStore.ifCurrent(applicationContext, identity, revision) { NotificationWatchStore.remove(applicationContext, identity); WorkManager.getInstance(applicationContext).cancelUniqueWork("bob-update-check:$identity") }
            return Result.success()
        } catch (_: Exception) { /* Offline checks are silent; retain their encrypted, bounded metadata. */ }
        var retry = false
        if (!isStopped) NotificationWatchStore.ifCurrent(applicationContext, identity, revision) {
            val latest = NotificationWatchStore.read(applicationContext, identity) ?: return@ifCurrent
            retry = NotificationSchedulePolicy.needsRetry((latest.optJSONObject("work")?.length() ?: 0) > 0, activeBuild)
            if (!retry && !latest.optBoolean("updates")) NotificationWatchStore.remove(applicationContext, identity)
        }
        // Retry only unfinished work, not an ever-growing chain of idle checks.
        // Periodic update polling is a single OS-owned row with a 15-minute minimum interval.
        return if (retry && !isStopped) Result.retry() else Result.success()
    }
}

private class NotificationChecks(private val context: Context, private val current: () -> Boolean) {
    private fun channels() {
        if (Build.VERSION.SDK_INT < 26) return
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("bob-updates", "Updates ready to install", NotificationManager.IMPORTANCE_DEFAULT))
        manager.createNotificationChannel(NotificationChannel("bob-attention", "Questions needing your answer", NotificationManager.IMPORTANCE_DEFAULT))
        manager.createNotificationChannel(NotificationChannel("bob-completions-quiet", "Last replies (silent by default)", NotificationManager.IMPORTANCE_LOW).apply { setSound(null, null); enableVibration(false) })
    }
    private fun publish(id: Int, value: Notification): Boolean {
        if (!current()) return false
        val manager = context.getSystemService(NotificationManager::class.java)
        if (!manager.areNotificationsEnabled()) return false
        if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(value.channelId)?.importance == NotificationManager.IMPORTANCE_NONE) return false
        return try { manager.notify(id, value); true } catch (_: SecurityException) { false }
    }
    private fun noticeOnce(prefs: SharedPreferences, bucket: String, receipt: String, id: Int, value: Notification) {
        synchronized(NotificationWatchStore) {
            val seen = prefs.getStringSet(bucket, emptySet())!!.toMutableSet()
            if (!seen.contains(receipt) && publish(id, value)) {
                seen.add(receipt); prefs.edit().putStringSet(bucket, seen.toList().takeLast(256).toSet()).apply()
            }
        }
    }
    private fun notification(title: String, text: String, identity: String, chat: Long = 0, updates: Boolean = false, attention: Boolean = false): Notification {
        val intent = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        intent.data = android.net.Uri.parse(if (updates) "bob://updates/$identity" else "bob://work/$identity/$chat")
        val open = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val channel = if (attention) "bob-attention" else if (updates) "bob-updates" else "bob-completions-quiet"
        return (if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, channel) else Notification.Builder(context))
            .setSmallIcon(R.drawable.ic_stat_bob).setLargeIcon(BitmapFactory.decodeResource(context.resources, R.drawable.bob_notification_logo))
            .setContentTitle(title).setContentText(text).setStyle(Notification.BigTextStyle().bigText(text)).setContentIntent(open)
            .setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE).build()
    }
    private fun question(prefs: SharedPreferences, identity: String, chat: Long, value: JSONObject?) {
        val id = value?.optString("id") ?: return
        if (id.isBlank() || NotificationRuntime.viewing(identity, chat)) return
        val text = value.optString("text").take(1000).ifBlank { "Tap to answer Bob’s question." }
        noticeOnce(prefs, "questions", "$identity:$chat:$id", ("question:$identity:$chat").hashCode(), notification("Bob has a question", text, identity, chat, attention = true))
    }
    private fun get(config: JSONObject, suffix: String): JSONObject {
        val connection = URI(config.getString("endpoint") + suffix).toURL().openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false; connection.connectTimeout = 5000; connection.readTimeout = 5000
            connection.setRequestProperty("Authorization", "Bearer " + config.getString("token")); connection.setRequestProperty("x-bob-backend", config.getString("identity"))
            val status = connection.responseCode
            if (status == 401 || status == 409) throw SecurityException("Pairing revoked or identity changed")
            require(status == 200)
            val bytes = connection.inputStream.use { input ->
                val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(8192)
                while (true) { val n = input.read(buffer); if (n < 0) break; require(output.size() + n <= 2097152); output.write(buffer, 0, n) }; output.toByteArray()
            }
            return JSONObject(String(bytes, Charsets.UTF_8))
        } finally { connection.disconnect() }
    }
    fun check(identity: String, value: JSONObject): Boolean {
        channels(); value.put("identity", identity)
        val prefs = context.getSharedPreferences("bob-notification-receipts", Context.MODE_PRIVATE)
        val work = value.optJSONObject("work") ?: JSONObject()
        val keys = work.keys().asSequence().toList().take(32)
        for (key in keys) {
            if (!current()) return false
            try {
                val item = work.getJSONObject(key); val chat = item.getLong("chat"); val request = item.getString("request")
                val operation = get(value, "/v1/chats/$chat/operations/$request")
                val status = operation.optJSONObject("admission")?.optString("status")
                val pending = operation.optJSONObject("question")
                if (!current()) return false
                if (status == "done" || status == "unanswered") {
                    if (!pending?.optString("id").isNullOrEmpty()) question(prefs, identity, chat, pending)
                    else if (status == "done" && context.getSharedPreferences("bob-notification-preferences", Context.MODE_PRIVATE).getBoolean("replies", true) && !NotificationRuntime.viewing(identity, chat)) {
                        val reply = operation.optJSONObject("reply")
                        val text = reply?.optString("text")?.take(4000)?.takeIf { it.isNotBlank() } ?: "Tap to read my latest reply."
                        val receipt = "$identity:$chat:" + (reply?.optLong("id", 0)?.takeIf { it > 0 }?.toString() ?: request)
                        noticeOnce(prefs, "replies", receipt, ("reply:$identity:$chat").hashCode(), notification("Bob replied", text, identity, chat))
                    }
                    NotificationWatchStore.ifCurrent(context, identity, value.getString("revision")) {
                        val completed = prefs.getStringSet("settled", emptySet())!!.toMutableSet(); completed.add(key)
                        prefs.edit().putStringSet("settled", completed.toList().takeLast(256).toSet()).apply()
                        NotificationWatchStore.update(context, identity) { it.optJSONObject("work")?.remove(key) }
                    }
                } else question(prefs, identity, chat, pending)
            } catch (e: SecurityException) { throw e } catch (_: Exception) { /* Retain unfinished checks. */ }
        }
        if (!value.optBoolean("updates") || !current()) return false
        val status = get(value, "/v1/updates")
        val jobs = status.optJSONArray("jobs")
        val activeBuild = jobs != null && (0 until jobs.length()).any { NotificationSchedulePolicy.activeStatus(jobs.optJSONObject(it)?.optString("status") ?: "") }
        val apk = status.optJSONObject("apk") ?: return activeBuild
        if (apk.optLong("versionCode", 0) <= BuildConfig.VERSION_CODE || NotificationRuntime.appVisible || !current()) return activeBuild
        val release = apk.optString("releaseId"); val sha = apk.optString("sha256")
        if (!Regex("^[A-Za-z0-9_-]{1,128}$").matches(release) || !Regex("^[a-f0-9]{64}$").matches(sha)) return activeBuild
        noticeOnce(context.getSharedPreferences("bob-update-notification-receipts", Context.MODE_PRIVATE), "ready", "$identity:$sha", ("ready:$identity").hashCode(),
            notification("Bob update ready to install", "${value.optString("name", "Bob")} · App ${apk.optString("versionName")} — tap to install", identity, updates = true))
        return activeBuild
    }
}
