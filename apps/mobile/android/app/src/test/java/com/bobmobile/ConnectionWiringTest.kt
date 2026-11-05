package com.bobmobile

import org.junit.Assert.*
import org.junit.Test
import java.io.File

/** Structural guardrails supplement pure JVM tests, not a claim of Android lifecycle/device coverage. */
class ConnectionWiringTest {
    private val code get() = File("src/main/java/com/bobmobile/BobConnection.kt").readText()
    @Test fun dedicatedNonExportedSpecialUseServiceAndSeparateOptIn() {
        val manifest = File("src/main/AndroidManifest.xml").readText()
        assertTrue(manifest.contains("android.permission.ACCESS_NETWORK_STATE"))
        assertTrue(manifest.contains("android.permission.FOREGROUND_SERVICE_SPECIAL_USE"))
        assertTrue(manifest.contains("<service android:name=\".BobConnectionService\" android:exported=\"false\" android:foregroundServiceType=\"specialUse\">"))
        assertTrue(manifest.contains("android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"))
        assertTrue(code.contains("getSharedPreferences(\"keep-connected\""))
        assertTrue(code.contains("if (Build.VERSION.SDK_INT >= 34) startForeground(CONNECTION_NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)"))
        assertFalse(code.contains("FOREGROUND_SERVICE_TYPE_DATA_SYNC"))
        assertFalse(code.contains("FOREGROUND_SERVICE_TYPE_LOCATION"))
        assertFalse(code.contains("ACCESS_FINE_LOCATION"))
        assertTrue(File("src/main/java/com/bobmobile/BobPlatform.kt").readText().contains("BobConnection(context)"))
    }
    @Test fun credentialsNeverEnterIntentsPreferencesLogsOrPromiseErrorsAndTransportIsGetOnly() {
        val source = code
        assertFalse(Regex("putExtra\\([^\\n]*(token|endpoint|backendId)").containsMatchIn(source))
        assertFalse(Regex("putString\\([^\\n]*(token|endpoint)").containsMatchIn(source))
        assertFalse(Regex("(?:Log\\.[vdiew]|println|printStackTrace)\\s*\\(").containsMatchIn(source))
        assertFalse(source.contains("e.message")); assertFalse(source.contains("promise.reject(\"start\", e"))
        assertTrue(source.contains("connection.requestMethod = \"GET\""))
        assertTrue(source.contains("connection.instanceFollowRedirects = false"))
        assertTrue(source.contains("connection.readTimeout = 15_000")); assertTrue(source.contains("connection.connectTimeout = 7000"))
        assertTrue(source.contains("PhoneLocationPolicy.endpoint(endpoint, BuildConfig.DEBUG)"))
        assertTrue(source.contains("/v1/chats/\${config.pair.chat}/connection"))
        assertTrue(source.contains("setRequestProperty(\"x-bob-backend\", config.pair.backendId)"))
        for (bad in listOf("requestMethod = \"POST\"", "requestMethod = \"DELETE\"", "outputStream", "readLine(", "HeadlessJs", "WakeLock", "BOOT_COMPLETED", "BobPhoneTools(", "/abort", "/messages")) assertFalse(bad, source.contains(bad))
    }
    @Test fun startNeedsForegroundActivityAndNotificationVisibilityWithoutPermissionDialog() {
        val source = code
        assertTrue(source.contains("context.lifecycleState != LifecycleState.RESUMED"))
        assertTrue(source.contains("!it.isFinishing && !it.isDestroyed"))
        assertTrue(source.contains("Manifest.permission.POST_NOTIFICATIONS"))
        assertTrue(source.contains("manager.areNotificationsEnabled()"))
        assertTrue(source.contains("NotificationManager.IMPORTANCE_NONE"))
        assertFalse(source.contains("requestPermissions("))
        assertTrue(source.contains("isIgnoringBatteryOptimizations(context.packageName)"))
        assertTrue(source.contains("Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS"))
        assertFalse(source.contains("ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS"))
        assertTrue(source.contains("if (!previous) connectionPrefs(context).edit().remove(pair.backendId).apply()"))
    }
    @Test fun terminalFailuresDoNotAutoSpinAndStaleActionsCannotRetireCurrentConfiguration() {
        val source = code
        assertTrue(source.contains("if (!allowEnable && (!previous || failures[pair.backendId]?.pair == pair)) return false"))
        assertTrue(source.contains("if (!scope.accepts(ticket, pair)) return false"))
        assertTrue(source.contains("if (config !== candidate || !scope.accepts(candidate.generation, candidate.pair)) return"))
        assertTrue(source.contains("if (!scope.acceptsAction(nonce, epoch, current.pair) || epoch != current.generation) return"))
        assertTrue(source.contains("if (service === value && config == null) value.retire()"))
        assertTrue(source.contains("old.generation == value.foregroundGeneration"))
        assertTrue(source.contains("bob-connection://stop/\${ConnectionRuntime.processNonce}/\$generation"))
        assertTrue(source.contains("bob://work/\${pair.backendId}/\${pair.chat}"))
        assertTrue(source.contains("\"Turn off connection\"")); assertTrue(source.contains("Notification.VISIBILITY_SECRET"))
    }
    @Test fun queuedUiStartUsesInvocationTicketAndStopRevokesItWithoutAnActiveConfig() {
        val source = code
        val capture = source.indexOf("val ticket = ConnectionRuntime.startTicket(pair)")
        val post = source.indexOf("UiThreadUtil.runOnUiThread")
        assertTrue(capture >= 0 && capture < post)
        assertTrue(source.contains("fun startTicket(pair: ConnectionPair): Long? = synchronized(lock) { scope.startTicket(pair) }"))
        assertTrue(source.contains("ConnectionRuntime.start(context, origin, pair, token, allowEnable, ticket)"))
        assertTrue(source.indexOf("if (!scope.accepts(ticket, pair)) return false") < source.indexOf("val previous = connectionEnabled"))
        assertTrue(source.contains("if (config?.pair?.backendId == id) retireLocked() else scope.revokeStarts(id)"))
        assertTrue(source.substringAfter("@ReactMethod fun forget(").substringBefore("@ReactMethod fun state(").contains("stop(backendId, promise)"))
    }
    @Test fun oneWorkerCancellableSocketAndNoStickyOrBootResume() {
        val source = code
        assertTrue(source.contains("if (worker == null) worker = Thread("))
        assertTrue(source.contains("socket.getAndSet(null)?.disconnect()"))
        assertTrue(source.contains("alive = false; cancelTransport(); worker?.interrupt()"))
        assertTrue(source.contains("registerDefaultNetworkCallback(callback)"))
        assertTrue(source.contains("unregisterNetworkCallback(it)"))
        assertTrue(source.contains("return START_NOT_STICKY")); assertFalse(source.contains("return START_STICKY"))
        assertTrue(source.contains("if (active != null) status else \"off\"")) // Persisted opt-in reopens without pretending to run.
        assertFalse(source.contains("override fun invalidate()")) // JS teardown cannot turn off the native service.
    }
}
