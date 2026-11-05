package com.bobmobile

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.util.concurrent.atomic.AtomicReference

internal data class UpdateStatus(val state: String, val message: String)
private data class UpdateRequest(val url: String, val token: String, val identity: String, val sha: String, val size: Long)

/** Only this process owns a request. No credentials in intents, disk, notifications, or retry queues. */
internal object UpdateDownloads {
    private const val CHANNEL = "bob-update-downloads"
    private const val NOTICE = 7312
    private val lock = Any()
    private var request: UpdateRequest? = null
    private var owner: BobUpdateDownloadService? = null
    private var result = UpdateStatus("idle", "")
    private var resultSha = ""
    private var resultSize = 0L
    private fun directory(context: Context) = File(context.cacheDir, "bob-previews").apply { mkdirs() }
    private fun readyFile(context: Context, sha: String) = File(directory(context), "update-ready-$sha.apk")
    private fun partial(context: Context) = File(directory(context), "update-download.part")
    private fun record(context: Context) = File(directory(context), "update-state.json")
    private fun metadata(context: Context): JSONObject? = try { JSONObject(record(context).readText()) } catch (_: Exception) { null }
    private fun persist(context: Context, state: String, sha: String, size: Long) {
        val temp = File(directory(context), "update-state.tmp")
        temp.writeText(JSONObject().put("state", state).put("sha", sha).put("size", size).put("time", System.currentTimeMillis()).toString())
        check(temp.renameTo(record(context)))
    }
    private fun ready(context: Context, sha: String, size: Long): Boolean {
        val meta = metadata(context) ?: return false
        return meta.optString("state") == "ready" && meta.optString("sha") == sha && meta.optLong("size") == size &&
            System.currentTimeMillis() - meta.optLong("time") in 0..UpdateDownloadPolicy.RETENTION_MS && readyFile(context, sha).isFile && readyFile(context, sha).length() == size
    }
    fun status(context: Context, sha: String, size: Long): UpdateStatus = synchronized(lock) {
        val active = request
        if (active != null) return@synchronized if (active.sha == sha && active.size == size) UpdateStatus("downloading", progressMessage(context)) else UpdateStatus("busy", "Another update is downloading. Wait for it to finish.")
        if (ready(context, sha, size)) return@synchronized UpdateStatus("ready", readyMessage(context))
        val meta = metadata(context)
        if (meta?.optString("state") == "downloading") {
            partial(context).delete(); record(context).delete()
            resultSha = meta.optString("sha"); resultSize = meta.optLong("size")
            result = UpdateStatus("failed", "Update download was interrupted. Tap Install to try again; it was not retried automatically.")
        } else if (meta != null && !ready(context, meta.optString("sha"), meta.optLong("size"))) {
            directory(context).listFiles()?.filter { it.name.startsWith("update-ready-") }?.forEach { it.delete() }; record(context).delete()
        }
        if (resultSha == sha && resultSize == size && result.state == "failed") result else UpdateStatus("idle", "")
    }
    fun start(context: Context, url: String, token: String, identity: String, sha: String, size: Long): UpdateStatus = synchronized(lock) {
        val existing = status(context, sha, size)
        if (existing.state in listOf("downloading", "busy", "ready")) return@synchronized existing
        directory(context).listFiles()?.filter { it.name.startsWith("update-ready-") }?.forEach { it.delete() }
        partial(context).delete(); record(context).delete()
        val next = UpdateRequest(url, token, identity, sha, size)
        request = next; owner = null; resultSha = sha; resultSize = size
        try {
            persist(context, "downloading", sha, size)
            // Deliberately empty: Android cannot replay a credential-bearing command.
            val intent = Intent(context, BobUpdateDownloadService::class.java)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
            UpdateStatus("downloading", progressMessage(context))
        } catch (_: Exception) {
            request = null; record(context).delete(); partial(context).delete()
            result = UpdateStatus("failed", "Android could not start the update download. Keep Bob open and tap Install to try again.")
            result
        }
    }
    fun claim(service: BobUpdateDownloadService): Boolean = synchronized(lock) {
        if (request == null || owner != null) false else { owner = service; true }
    }
    fun retire(service: BobUpdateDownloadService) = synchronized(lock) {
        if (owner === service && service.lifetime.mayRetire) { request = null; owner = null }
    }
    fun run(service: BobUpdateDownloadService) {
        val current = synchronized(lock) { request } ?: return
        var success = false
        try {
            service.checkActive()
            val connection = java.net.URI(current.url).toURL().openConnection() as HttpURLConnection
            service.socket.set(connection)
            try {
                connection.instanceFollowRedirects = false
                connection.connectTimeout = 15000; connection.readTimeout = 60000
                connection.requestMethod = "GET"
                connection.setRequestProperty("Authorization", "Bearer ${current.token}")
                connection.setRequestProperty("x-bob-backend", current.identity)
                service.checkActive()
                require(connection.responseCode == 200)
                require(connection.contentLengthLong == -1L || connection.contentLengthLong == current.size)
                partial(service).outputStream().use { output ->
                    connection.inputStream.use { input -> UpdateDownloadPolicy.copyVerified(input, output, current.size, current.sha) { service.checkActive() } }
                    output.fd.sync()
                }
            } finally { service.socket.compareAndSet(connection, null); connection.disconnect() }
            service.checkActive()
            verifyPackage(service, partial(service))
            synchronized(lock) {
                service.checkActive()
                check(partial(service).renameTo(readyFile(service, current.sha)))
                persist(service, "ready", current.sha, current.size)
                success = true
                result = UpdateStatus("ready", readyMessage(service))
            }
        } catch (_: Exception) {
            // Never surface HTTP exception text: it may contain URLs or request metadata.
            synchronized(lock) {
                partial(service).delete(); readyFile(service, current.sha).delete(); record(service).delete()
                result = UpdateStatus("failed", "Update download or verification failed or timed out. Nothing was installed. Tap Install to try again; no automatic retry.")
            }
        } finally {
            service.finished(success, current.sha)
        }
    }
    fun failedToStart(context: Context) = synchronized(lock) {
        partial(context).delete(); record(context).delete()
        result = UpdateStatus("failed", "Android stopped the update download. Reopen Bob and tap Install to try again.")
    }
    fun notification(context: Context, complete: Boolean = false, sha: String = "", failed: Boolean = false): Notification {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel(CHANNEL, "App update downloads", NotificationManager.IMPORTANCE_DEFAULT))
        val intent = if (complete) Intent(context, BobUpdateInstallActivity::class.java).putExtra("sha", sha) else Intent(context, MainActivity::class.java)
        val pending = PendingIntent.getActivity(context, if (complete) 7313 else 7312, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(context, CHANNEL).setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(if (complete) "Bob update ready" else if (failed) "Bob update download stopped" else "Downloading Bob update")
            .setContentText(if (complete) "Tap Install to approve the verified update." else if (failed) "Reopen Bob to retry. Nothing was installed." else "Downloading and verifying. You can minimise Bob.")
            .setContentIntent(pending).setOngoing(!complete && !failed).setAutoCancel(complete || failed)
            .setOnlyAlertOnce(true).setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .apply { if (complete) addAction(0, "Install", pending) else if (!failed) setProgress(0, 0, true) }.build()
    }
    fun notifyCompletion(context: Context, success: Boolean, sha: String) {
        try { NotificationManagerCompat.from(context).notify(NOTICE, notification(context, success, sha, !success)) } catch (_: Exception) { /* In-app status remains available. */ }
    }
    fun foregroundId() = NOTICE
    private fun notificationsVisible(context: Context): Boolean {
        val manager = NotificationManagerCompat.from(context)
        return manager.areNotificationsEnabled() && (Build.VERSION.SDK_INT < 26 || context.getSystemService(NotificationManager::class.java).getNotificationChannel(CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE)
    }
    private fun progressMessage(context: Context) = if (notificationsVisible(context)) "Downloading and verifying in the background. When ready, tap Install in the notification or return here." else "Downloading in the background. Update notifications are disabled; return to this card and tap Install when ready."
    private fun readyMessage(context: Context) = if (notificationsVisible(context)) "Update verified and ready. Tap Install here or in the notification. Android will ask you to confirm." else "Update verified and ready. Notifications are disabled; tap Install here. Android will ask you to confirm."
    fun installFile(context: Context, sha: String): File = synchronized(lock) {
        val meta = metadata(context) ?: error("Update unavailable")
        // Reject stale notification taps before entering failure cleanup for the current artifact.
        check(meta.optString("state") == "ready" && meta.optString("sha") == sha)
        val size = meta.getLong("size")
        fun invalidateMatching() {
            val current = metadata(context)
            if (UpdateDownloadPolicy.invalidateReady(sha, size, current?.optString("sha"), current?.optLong("size"), readyFile(context, sha), record(context))) {
                resultSha = sha; resultSize = size
                result = UpdateStatus("failed", "Downloaded update failed verification or expired. Tap Install to download a fresh copy; no automatic retry.")
            }
        }
        if (!ready(context, sha, size)) { invalidateMatching(); error("Update unavailable") }
        UpdateDownloadPolicy.recheckReady(readyFile(context, sha), sha, size, { verifyPackage(context, it) }, ::invalidateMatching)
    }
    @Suppress("DEPRECATION")
    private fun verifyPackage(context: Context, file: File) {
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val candidate = context.packageManager.getPackageArchiveInfo(file.absolutePath, flags) ?: error("Invalid APK")
        val installed = context.packageManager.getPackageInfo(context.packageName, flags)
        fun version(info: PackageInfo) = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
        fun signers(info: PackageInfo) = (if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures)?.map { UpdateDownloadPolicy.hex(java.security.MessageDigest.getInstance("SHA-256").digest(it.toByteArray())) } ?: emptyList()
        UpdateDownloadPolicy.verifyIdentity(candidate.packageName, context.packageName, version(candidate), version(installed), signers(candidate), signers(installed))
    }
}

/** Bounded, one-shot dataSync service, never started by boot, alarms, or background JS. */
class BobUpdateDownloadService : Service() {
    internal val socket = AtomicReference<HttpURLConnection?>(null)
    @Volatile private var cancelled = false
    private val handler = Handler(Looper.getMainLooper())
    private var worker: Thread? = null
    internal val lifetime = UpdateDownloadLifetime()
    private val timeout = Runnable {
        cancelled = true
        stopForeground(STOP_FOREGROUND_REMOVE); stopSelf()
        cancel()
    }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (worker != null) return START_NOT_STICKY
        if (!UpdateDownloads.claim(this)) { stopSelf(); return START_NOT_STICKY }
        try {
            val notice = UpdateDownloads.notification(this)
            if (Build.VERSION.SDK_INT >= 29) startForeground(UpdateDownloads.foregroundId(), notice, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else startForeground(UpdateDownloads.foregroundId(), notice)
            handler.postDelayed(timeout, UpdateDownloadPolicy.TIMEOUT_MS)
            worker = Thread({ UpdateDownloads.run(this) }, "bob-update-download").also { it.start() }
        } catch (_: Exception) { UpdateDownloads.failedToStart(this); stopSelf() }
        return START_NOT_STICKY
    }
    internal fun checkActive() { check(!cancelled && !Thread.currentThread().isInterrupted) }
    private fun cancel() {
        cancelled = true; worker?.interrupt()
        // Some HTTP stacks block in disconnect. Never hold Android's timeout callback hostage.
        socket.getAndSet(null)?.let { connection -> Thread({ connection.disconnect() }, "bob-update-cancel").start() }
    }
    internal fun finished(success: Boolean, sha: String) {
        handler.post {
            handler.removeCallbacks(timeout)
            stopForeground(STOP_FOREGROUND_REMOVE)
            UpdateDownloads.notifyCompletion(this, success, sha)
            lifetime.workerFinished()
            if (lifetime.destroyed) UpdateDownloads.retire(this) else stopSelf()
        }
    }
    // Android 15 dataSync budget exhaustion must promptly release foreground ownership.
    override fun onTimeout(startId: Int, fgsType: Int) { timeout.run() }
    override fun onDestroy() {
        lifetime.onDestroy(); cancel(); handler.removeCallbacks(timeout)
        if (worker == null) lifetime.workerFinished()
        UpdateDownloads.retire(this)
        super.onDestroy()
    }
}
