package com.bobmobile

import android.Manifest
import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.*
import com.facebook.react.bridge.*
import com.facebook.react.common.LifecycleState
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

private fun prefs(context: Context) = context.getSharedPreferences("phone-location", Context.MODE_PRIVATE)
private fun permitted(context: Context, permission: String) = context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
private fun locationAllowed(context: Context) = permitted(context, Manifest.permission.ACCESS_FINE_LOCATION) || permitted(context, Manifest.permission.ACCESS_COARSE_LOCATION)
private data class LocationConnection(val endpoint: String, val identity: String, val token: String)

/** Tokens live only in the non-exported service's memory; no credentials or coordinates in preferences. */
class BobLocation(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "BobLocation"
    @ReactMethod fun enabled(identity: String, promise: Promise) { promise.resolve(prefs(context).getString("identity", null) == identity) }
    @ReactMethod fun start(endpoint: String, identity: String, token: String, allowEnable: Boolean, promise: Promise) {
        try {
            val origin = PhoneLocationPolicy.endpoint(endpoint, BuildConfig.DEBUG)
            java.util.UUID.fromString(identity); require(token.matches(Regex("[A-Za-z0-9_-]{32,128}")))
            require(context.lifecycleState == LifecycleState.RESUMED) { "Keep Bob open while enabling location" }
            require(locationAllowed(context)) { "Android location permission is required" }
            if (Build.VERSION.SDK_INT >= 33) require(permitted(context, Manifest.permission.POST_NOTIFICATIONS)) { "Allow notifications for the visible location service" }
            require(context.getSystemService(NotificationManager::class.java).areNotificationsEnabled()) { "Allow Bob notifications in Android settings" }
            if (Build.VERSION.SDK_INT >= 26) require(context.getSystemService(NotificationManager::class.java).getNotificationChannel("bob-location")?.importance != NotificationManager.IMPORTANCE_NONE) { "Allow the Automatic location notification channel in Android settings" }
            val previous = prefs(context).getString("identity", null)
            if (!PhoneLocationPolicy.mayStart(previous, identity, allowEnable)) { promise.resolve(false); return }
            require(previous == null || previous == identity) { "Location is enabled for another backend. Disable it there first." }
            prefs(context).edit().putString("identity", identity).apply()
            try {
                val intent = Intent(context, BobLocationService::class.java).putExtra("endpoint", origin).putExtra("identity", identity).putExtra("token", token)
                if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
            } catch (e: Exception) { prefs(context).edit().remove("identity").apply(); throw e }
            promise.resolve(true)
        } catch (e: Exception) { promise.reject("location", e.message ?: "Unable to enable automatic location") }
    }
    @ReactMethod fun stop(endpoint: String, identity: String, token: String, promise: Promise) {
        if (prefs(context).getString("identity", null) == identity) {
            prefs(context).edit().remove("identity").apply()
            BobLocationService.active?.shutdown()
            context.stopService(Intent(context, BobLocationService::class.java))
        }
        Thread {
            try { LocationHttp.call(LocationConnection(PhoneLocationPolicy.endpoint(endpoint, BuildConfig.DEBUG), identity, token), "/availability", JSONObject().put("enabled", false)) } catch (_: Exception) { /* Local stop is authoritative even offline. Server presence expires. */ }
            promise.resolve(true)
        }.start()
    }
    @ReactMethod fun openSettings(kind: String, promise: Promise) {
        try {
            val intent = if (kind == "location") Intent(android.provider.Settings.ACTION_LOCATION_SOURCE_SETTINGS) else Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:" + context.packageName))
            context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); promise.resolve(true)
        } catch (e: Exception) { promise.reject("location", "Unable to open Android settings", e) }
    }
}

private object LocationHttp {
    fun call(config: LocationConnection, suffix: String, body: JSONObject? = null, connectionRef: AtomicReference<HttpURLConnection?>? = null): JSONObject {
        val connection = URI(config.endpoint + "/v1/location" + suffix).toURL().openConnection() as HttpURLConnection
        connectionRef?.set(connection)
        try {
            connection.instanceFollowRedirects = false; connection.connectTimeout = 5000; connection.readTimeout = if (body == null) 22000 else 5000
            connection.setRequestProperty("Authorization", "Bearer " + config.token); connection.setRequestProperty("x-bob-backend", config.identity)
            if (body != null) { connection.requestMethod = "POST"; connection.doOutput = true; connection.setRequestProperty("Content-Type", "application/json"); connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) } }
            val status = connection.responseCode
            if (status == 401 || status == 409) throw SecurityException("Phone pairing no longer valid")
            if (status == 410) return JSONObject().put("expired", true)
            require(status == 200) { "Location backend unavailable" }
            val bytes = connection.inputStream.use { input ->
                val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(4096)
                while (true) { val count = input.read(buffer); if (count < 0) break; require(output.size() + count <= 32768); output.write(buffer, 0, count) }; output.toByteArray()
            }
            return JSONObject(String(bytes, Charsets.UTF_8))
        } finally { connectionRef?.compareAndSet(connection, null); connection.disconnect() }
    }
}

private object PhoneFix {
    data class Result(val fix: JSONObject?, val reason: String)
    @Suppress("DEPRECATION")
    fun capture(context: Context): Result {
        if (!locationAllowed(context)) return Result(null, "permission_denied")
        val manager = context.getSystemService(LocationManager::class.java)
        val precise = permitted(context, Manifest.permission.ACCESS_FINE_LOCATION)
        val providers = listOf(LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER).filter { provider ->
            (provider != LocationManager.GPS_PROVIDER || precise) && try { manager.isProviderEnabled(provider) } catch (_: Exception) { false }
        }
        if (providers.isEmpty()) return Result(null, "location_disabled")
        val handler = Handler(Looper.getMainLooper()); val done = CountDownLatch(1); val cancelled = AtomicBoolean(false)
        val best = AtomicReference<Location?>(null); val error = AtomicReference("timeout")
        val settle = Runnable { done.countDown() }; var settling = false
        fun consider(location: Location) {
            if (cancelled.get() || !PhoneLocationPolicy.fresh(location.elapsedRealtimeNanos, SystemClock.elapsedRealtimeNanos()) || !location.hasAccuracy() || !location.accuracy.isFinite() || location.accuracy < 0 || location.accuracy > 100000) return
            val previous = best.get(); if (previous == null || !PhoneLocationPolicy.fresh(previous.elapsedRealtimeNanos, SystemClock.elapsedRealtimeNanos()) || location.accuracy < previous.accuracy) best.set(Location(location))
            if (location.accuracy <= if (precise) 75f else 5000f) done.countDown()
            else if (!settling) { settling = true; handler.postDelayed(settle, 8000) }
        }
        val listener = object : LocationListener {
            override fun onLocationChanged(location: Location) { consider(location) }
            override fun onProviderEnabled(provider: String) {}
            override fun onProviderDisabled(provider: String) {}
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
        }
        try {
            handler.post {
                if (!cancelled.get()) try {
                    providers.forEach { provider -> manager.getLastKnownLocation(provider)?.let { consider(it) } }
                    if (done.count > 0) providers.forEach { provider -> manager.requestLocationUpdates(provider, 0L, 0f, listener, Looper.getMainLooper()) }
                } catch (_: SecurityException) { error.set("permission_denied"); done.countDown() }
                  catch (_: Exception) { done.countDown() }
            }
            done.await(25, TimeUnit.SECONDS)
        } finally {
            cancelled.set(true); handler.post { handler.removeCallbacks(settle); try { manager.removeUpdates(listener) } catch (_: Exception) {} }
        }
        val location = best.get() ?: return Result(null, error.get())
        if (!PhoneLocationPolicy.fresh(location.elapsedRealtimeNanos, SystemClock.elapsedRealtimeNanos())) return Result(null, "timeout")
        return Result(JSONObject().put("latitude", location.latitude).put("longitude", location.longitude).put("accuracyMeters", location.accuracy.toDouble())
            .put("capturedAt", location.time).put("ageMs", (SystemClock.elapsedRealtimeNanos() - location.elapsedRealtimeNanos) / 1_000_000)
            .put("permission", if (precise) "precise" else "approximate").put("mock", if (Build.VERSION.SDK_INT >= 31) location.isMock else location.isFromMockProvider), "")
    }
}

/** Only a question-triggered request activates GPS. Idle service long-polls the paired private backend.
 * Started visibly by its owner; Android permits its location FGS to continue when locked/backgrounded.
 * No boot receiver, wake lock, sticky restart, stored bearer token or route recording. */
class BobLocationService : Service() {
    companion object { @Volatile var active: BobLocationService? = null }
    @Volatile private var running = true
    private var config: LocationConnection? = null
    private var worker: Thread? = null
    private val wake = java.util.concurrent.Semaphore(0)
    private val connection = AtomicReference<HttpURLConnection?>(null)
    private val channel = "bob-location"
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onCreate() {
        super.onCreate(); active = this
        try {
            val manager = getSystemService(NotificationManager::class.java)
            if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel(channel, "Automatic location (on demand)", NotificationManager.IMPORTANCE_LOW).apply { setSound(null, null); enableVibration(false); setShowBadge(false) })
            require(manager.areNotificationsEnabled())
            if (Build.VERSION.SDK_INT >= 26) require(manager.getNotificationChannel(channel)?.importance != NotificationManager.IMPORTANCE_NONE)
            val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val stop = PendingIntent.getService(this, 1, Intent(this, BobLocationService::class.java).setAction("stop-location"), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val builder = (if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, channel) else Notification.Builder(this))
                .setSmallIcon(R.drawable.ic_stat_bob).setContentTitle("Bob location ready").setContentText("Only requested when a question needs your location")
                .setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true).setVisibility(Notification.VISIBILITY_PRIVATE)
                .addAction(Notification.Action.Builder(null, "Stop location", stop).build())
            if (Build.VERSION.SDK_INT >= 31) builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
            if (Build.VERSION.SDK_INT >= 29) startForeground(4200, builder.build(), android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION) else startForeground(4200, builder.build())
        } catch (_: Exception) { running = false; prefs(this).edit().remove("identity").apply(); stopSelf() }
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "stop-location") {
            val old = config; prefs(this).edit().remove("identity").apply(); shutdown(); stopSelf()
            if (old != null) Thread { try { LocationHttp.call(old, "/availability", JSONObject().put("enabled", false)) } catch (_: Exception) {} }.start()
            return START_NOT_STICKY
        }
        if (intent == null || !running) { stopSelf(); return START_NOT_STICKY }
        if (worker != null) { if (wake.availablePermits() == 0) wake.release(); return START_NOT_STICKY }
        try {
            val endpoint = PhoneLocationPolicy.endpoint(intent.getStringExtra("endpoint") ?: "", BuildConfig.DEBUG)
            val identity = intent.getStringExtra("identity") ?: ""; java.util.UUID.fromString(identity)
            val token = intent.getStringExtra("token") ?: ""; require(token.matches(Regex("[A-Za-z0-9_-]{32,128}")))
            require(prefs(this).getString("identity", null) == identity)
            config = LocationConnection(endpoint, identity, token)
            worker = Thread { monitor(config!!) }.apply { name = "bob-location"; start() }
        } catch (_: Exception) { shutdown(); stopSelf() }
        return START_NOT_STICKY
    }
    private fun enabled(config: LocationConnection) = running && prefs(this).getString("identity", null) == config.identity
    private fun monitor(config: LocationConnection) {
        var registered = false; var backoff = 2000L
        while (enabled(config)) try {
            if (!locationAllowed(this) || (Build.VERSION.SDK_INT >= 33 && !permitted(this, Manifest.permission.POST_NOTIFICATIONS))) throw SecurityException("Permission removed")
            val notifications = getSystemService(NotificationManager::class.java)
            if (!notifications.areNotificationsEnabled() || (Build.VERSION.SDK_INT >= 26 && notifications.getNotificationChannel(channel)?.importance == NotificationManager.IMPORTANCE_NONE)) throw SecurityException("Notification visibility removed")
            if (!registered) { LocationHttp.call(config, "/availability", JSONObject().put("enabled", true), connection); registered = true }
            val polled = LocationHttp.call(config, "/poll", connectionRef = connection)
            if (!polled.optBoolean("enabled")) { prefs(this).edit().remove("identity").apply(); break }
            val requests = polled.optJSONArray("requests") ?: continue
            if (requests.length() == 0) { backoff = 2000; continue }
            if (!enabled(config)) break
            val result = PhoneFix.capture(this); val ready = SystemClock.elapsedRealtime()
            for (index in 0 until minOf(requests.length(), 4)) {
                if (!enabled(config)) break
                val request = requests.getJSONObject(index); val id = request.getString("id")
                if (!id.matches(Regex("[a-f0-9]{64}")) || request.optLong("expiresAt") <= System.currentTimeMillis()) continue
                val body = JSONObject().put("id", id)
                if (result.fix == null) body.put("status", "unavailable").put("reason", result.reason)
                else {
                    val fix = JSONObject(result.fix.toString()); val age = fix.getLong("ageMs") + SystemClock.elapsedRealtime() - ready
                    if (age > 30000) { body.put("status", "unavailable").put("reason", "timeout") }
                    else body.put("status", "ok").put("fix", fix.put("ageMs", age))
                }
                if (enabled(config)) LocationHttp.call(config, "/response", body, connection)
            }
            backoff = 2000
        } catch (_: InterruptedException) { break }
          catch (_: SecurityException) { prefs(this).edit().remove("identity").apply(); break }
          catch (_: Exception) { if (!enabled(config)) break; try { wake.tryAcquire(backoff, TimeUnit.MILLISECONDS) } catch (_: InterruptedException) { break }; backoff = minOf(30000, backoff * 2) }
        shutdown(); stopSelf()
    }
    fun shutdown() { running = false; connection.getAndSet(null)?.disconnect(); worker?.interrupt() }
    override fun onDestroy() { shutdown(); if (active === this) active = null; super.onDestroy() }
}
