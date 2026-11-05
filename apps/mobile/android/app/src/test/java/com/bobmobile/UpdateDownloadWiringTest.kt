package com.bobmobile

import org.junit.Assert.*
import org.junit.Test
import java.io.File

/** Wiring assertions supplement pure stream tests; they are not Android lifecycle/device tests. */
class UpdateDownloadWiringTest {
    private val service get() = File("src/main/java/com/bobmobile/BobUpdateDownloadService.kt").readText()
    private val activity get() = File("src/main/java/com/bobmobile/BobUpdateInstallActivity.kt").readText()
    private val bridge get() = File("src/main/java/com/bobmobile/BobFiles.kt").readText().substringAfter("@ReactMethod fun installUpdate(").substringBefore("@ReactMethod fun importMarkdown")
    @Test fun dedicatedNonexportedDataSyncServiceAndDirectInstallActivity() {
        val manifest = File("src/main/AndroidManifest.xml").readText()
        assertTrue(manifest.contains("android.permission.FOREGROUND_SERVICE_DATA_SYNC"))
        assertTrue(manifest.contains("<service android:name=\".BobUpdateDownloadService\" android:exported=\"false\" android:foregroundServiceType=\"dataSync\" />"))
        assertTrue(manifest.contains("<activity android:name=\".BobUpdateInstallActivity\" android:exported=\"false\" />"))
        assertTrue(service.contains("FOREGROUND_SERVICE_TYPE_DATA_SYNC"))
        assertTrue(service.contains("PendingIntent.getActivity(")); assertTrue(service.contains("PendingIntent.FLAG_IMMUTABLE"))
        assertFalse(service.contains("PendingIntent.getBroadcast(")); assertFalse(service.contains("startActivity("))
        assertTrue(service.contains("if (complete) Intent(context, BobUpdateInstallActivity::class.java)"))
        assertTrue(service.contains("addAction(0, \"Install\", pending)"))
    }
    @Test fun credentialsNeverPersistAndOnlyExplicitResumedHostMayStart() {
        assertTrue(bridge.contains("context.lifecycleState != com.facebook.react.common.LifecycleState.RESUMED"))
        assertTrue(bridge.contains("activity.isFinishing || activity.isDestroyed"))
        assertTrue(bridge.indexOf("LifecycleState.RESUMED") < bridge.indexOf("UpdateDownloads.start("))
        val code = service + activity
        for (bad in listOf("DownloadManager", "getSharedPreferences", "WorkManager", "Log.", "println(", "e.message", "printStackTrace", "getStringExtra(\"token", "putExtra(\"token", "putExtra(\"url", "putExtra(\"identity")) assertFalse(bad, code.contains(bad))
        assertFalse(Regex("put\\([^\\n]*(token|identity|url)").containsMatchIn(service))
        assertTrue(service.contains("val intent = Intent(context, BobUpdateDownloadService::class.java)\n"))
        assertTrue(service.contains("setRequestProperty(\"Authorization\", \"Bearer ${'$'}{current.token}\")"))
        assertTrue(service.contains("setRequestProperty(\"x-bob-backend\", current.identity)"))
        assertTrue(service.contains("connection.instanceFollowRedirects = false"))
        assertTrue(service.contains("connection.responseCode == 200"))
        assertTrue(service.contains("connection.contentLengthLong == -1L || connection.contentLengthLong == current.size"))
    }
    @Test fun oneWorkerBoundedLifecycleNoAutomaticReplayAndCancellationDisconnects() {
        assertTrue(service.contains("if (worker != null) return START_NOT_STICKY"))
        assertTrue(service.contains("if (request == null || owner != null) false"))
        assertTrue(service.contains("if (owner === service && service.lifetime.mayRetire) { request = null; owner = null }"))
        assertTrue(service.contains("if (worker == null) lifetime.workerFinished()"))
        assertTrue(service.contains("lifetime.onDestroy(); cancel(); handler.removeCallbacks(timeout)"))
        assertTrue(service.contains("if (lifetime.destroyed) UpdateDownloads.retire(this) else stopSelf()"))
        assertTrue(service.contains("handler.postDelayed(timeout, UpdateDownloadPolicy.TIMEOUT_MS)"))
        assertTrue(service.contains("override fun onTimeout(startId: Int, fgsType: Int) { timeout.run() }"))
        assertTrue(service.contains("socket.getAndSet(null)?.let { connection -> Thread({ connection.disconnect() }, \"bob-update-cancel\").start() }"))
        val timeout = service.substringAfter("private val timeout = Runnable {").substringBefore("override fun onBind")
        assertTrue(timeout.indexOf("stopSelf()") < timeout.indexOf("cancel()"))
        assertTrue(service.contains("connection.connectTimeout = 15000; connection.readTimeout = 60000"))
        assertFalse(service.contains("START_STICKY")); assertFalse(service.contains("BOOT_COMPLETED")); assertFalse(service.contains("while (true)"))
        assertTrue(service.contains("partial(service).delete(); readyFile(service, current.sha).delete(); record(service).delete()"))
        assertTrue(service.contains("Update download was interrupted"))
    }
    @Test fun installerRechecksPrivateVerifiedArtifactOffMainAndCannotLaunchWhileBackgrounded() {
        assertTrue(activity.contains("Thread({")); assertTrue(activity.contains("UpdateDownloads.installFile(this, sha)"))
        assertTrue(activity.contains("if (!resumed || isFinishing || isDestroyed || launched) return"))
        assertTrue(activity.contains("override fun onPause() { resumed = false"))
        assertTrue(activity.contains("FileProvider.getUriForFile(this,"))
        assertTrue(activity.contains("Intent.FLAG_GRANT_READ_URI_PERMISSION"))
        assertFalse(activity.contains("FLAG_ACTIVITY_NEW_TASK"))
        assertTrue(service.substringAfter("fun installFile(").contains("UpdateDownloadPolicy.recheckReady("))
        assertTrue(service.substringAfter("fun installFile(").contains("verifyPackage(context, it)"))
        assertTrue(service.substringAfter("fun installFile(").contains("UpdateDownloadPolicy.invalidateReady(sha, size, current?.optString(\"sha\"), current?.optLong(\"size\")"))
        assertTrue(service.substringAfter("fun installFile(").contains("resultSha = sha; resultSize = size"))
        assertTrue(service.contains("manager.areNotificationsEnabled()"))
        assertTrue(service.contains("NotificationManager.IMPORTANCE_NONE"))
        assertTrue(service.contains("Notifications are disabled; tap Install here"))
    }
}
