package com.bobmobile

import android.Manifest
import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.os.*
import android.provider.Settings
import com.facebook.react.bridge.*
import com.facebook.react.common.LifecycleState
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.random.Random

private const val CONNECTION_CHANNEL = "bob-connection"
private const val CONNECTION_NOTIFICATION = 4201
private const val CONNECTION_STOP = "com.bobmobile.CONNECTION_STOP"
private fun connectionPrefs(context: Context) = context.getSharedPreferences("keep-connected", Context.MODE_PRIVATE)
private fun connectionEnabled(context: Context, id: String) = connectionPrefs(context).getBoolean(id, false)
private fun connectionChannel(context: Context) {
    if (Build.VERSION.SDK_INT >= 26) context.getSystemService(NotificationManager::class.java).createNotificationChannel(
        NotificationChannel(CONNECTION_CHANNEL, "Keep connected", NotificationManager.IMPORTANCE_LOW).apply {
            setSound(null, null); enableVibration(false); setShowBadge(false)
        })
}
private fun connectionVisible(context: Context): Boolean {
    if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false
    val manager = context.getSystemService(NotificationManager::class.java)
    return manager.areNotificationsEnabled() && (Build.VERSION.SDK_INT < 26 || manager.getNotificationChannel(CONNECTION_CHANNEL)?.importance?.let { it != NotificationManager.IMPORTANCE_NONE } == true)
}

// Deliberately not a data class: generated toString/copy must not expose a bearer token.
private class ConnectionConfig(val endpoint: String, val pair: ConnectionPair, val token: String, val generation: Long)
private data class ConnectionFailure(val pair: ConnectionPair, val error: String)

/** One process-wide selection and credential slot. All mutations/callbacks are serialized by lock.
 * Preferences hold ONLY independent per-backend opt-ins. Tokens never enter intents, prefs or errors. */
private object ConnectionRuntime {
    val lock = Any()
    private val scope = ConnectionScope()
    val processNonce: String get() = scope.nonce
    private var config: ConnectionConfig? = null
    private var service: BobConnectionService? = null
    private var published = -1L
    private var status = "off"
    private val failures = mutableMapOf<String, ConnectionFailure>()
    private val main = Handler(Looper.getMainLooper())
    private val cache = ChatStreamCache()
    private val observer = ChatStreamObserver()
    private val stateInvalidation = ChatStateInvalidation()
    private var bridgeResumed = false
    private var bridge: ReactApplicationContext? = null
    private var notificationQueued = false

    fun bridge(context: ReactApplicationContext) = synchronized(lock) {
        if (bridge !== context) { observer.detach(); stateInvalidation.detach() }
        bridge = context; bridgeResumed = context.lifecycleState == LifecycleState.RESUMED
        observer.lifecycle(bridgeResumed); stateInvalidation.lifecycle(bridgeResumed); notifyLocked()
    }
    fun lifecycle(context: ReactApplicationContext, active: Boolean) = synchronized(lock) {
        if (bridge === context) {
            bridgeResumed = active; observer.lifecycle(active); stateInvalidation.lifecycle(active); notifyLocked()
        }
    }
    fun detachBridge(context: ReactApplicationContext) = synchronized(lock) {
        if (bridge === context) { bridge = null; bridgeResumed = false; observer.detach(); stateInvalidation.detach() }
    }
    private fun emit(context: ReactApplicationContext, event: String, pair: ConnectionPair, id: String? = null) {
        if (!context.hasActiveReactInstance()) return
        val payload = Arguments.createMap().apply {
            putString("backendId", pair.backendId); putDouble("conversationId", pair.chat.toDouble())
            if (id != null) putString("observerId", id)
        }
        try { context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(event, payload) }
        catch (_: Exception) { /* A detached React runtime must never stop the owner service. */ }
    }
    private fun notifyLocked() {
        if (notificationQueued || bridge == null || !bridgeResumed) return
        notificationQueued = true
        main.post { synchronized(lock) {
            notificationQueued = false
            val context = bridge ?: return@synchronized
            observer.take()?.let { emit(context, "BobConnectionStream", it.pair, it.id) }
            stateInvalidation.take()?.let { emit(context, "BobConnectionState", it) }
        } }
    }
    private fun changedLocked(pair: ConnectionPair, stateChange: Boolean = false) {
        observer.changed(pair)
        if (stateChange) stateInvalidation.changed(pair)
        notifyLocked()
    }
    private fun statusLocked(candidate: ConnectionConfig, next: String) {
        if (status != next) { status = next; changedLocked(candidate.pair, true) }
    }

    private fun cancelLocked() { service?.cancelTransport() }
    private fun retireLocked() {
        val previous = config?.pair ?: scope.selected
        scope.retire(); config = null; published = -1; status = "off"; cache.clear(); cancelLocked()
        previous?.let { changedLocked(it, true) }
        val old = service
        if (old != null) main.post { synchronized(lock) { if (service === old && config == null) old.retire() } }
    }
    fun select(pair: ConnectionPair?) = synchronized(lock) {
        val previous = scope.selected
        if (scope.select(pair)) {
            retireLocked()
            previous?.let { changedLocked(it, true) }
            pair?.let { changedLocked(it, true) }
        }
    }
    fun startTicket(pair: ConnectionPair): Long? = synchronized(lock) { scope.startTicket(pair) }
    fun start(context: Context, endpoint: String, pair: ConnectionPair, token: String, allowEnable: Boolean, ticket: Long): Boolean = synchronized(lock) {
        // Pair equality alone misses A → B → A and stop-before-first-config while the UI callback waits.
        if (!scope.accepts(ticket, pair)) return false
        val previous = connectionEnabled(context, pair.backendId)
        if (!allowEnable && (!previous || failures[pair.backendId]?.pair == pair)) return false
        val old = config
        if (old != null && old.pair == pair && old.endpoint == endpoint && old.token == token && published == old.generation && service != null) return true
        // No mutation occurs until validation by the bridge, including visible Activity/channel checks.
        val epoch = scope.begin(pair)
        config = ConnectionConfig(endpoint, pair, token, epoch); published = -1; status = "connecting"
        failures.remove(pair.backendId); cache.clear(); cancelLocked()
        changedLocked(pair, true)
        if (allowEnable) connectionPrefs(context).edit().putBoolean(pair.backendId, true).apply()
        try {
            // Even credentials for a private backend must not be serialized into an Android Intent.
            val intent = Intent(context, BobConnectionService::class.java)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
            true
        } catch (_: Exception) {
            if (scope.accepts(epoch, pair)) {
                if (!previous) connectionPrefs(context).edit().remove(pair.backendId).apply()
                failures[pair.backendId] = ConnectionFailure(pair, "start"); retireLocked()
            }
            throw IllegalStateException() // Bridge returns only a literal error, never the platform exception.
        }
    }
    fun stop(context: Context, id: String) = synchronized(lock) {
        connectionPrefs(context).edit().remove(id).apply(); failures.remove(id)
        if (config?.pair?.backendId == id) retireLocked() else scope.revokeStarts(id)
        changedLocked(scope.selected?.takeIf { it.backendId == id } ?: ConnectionPair(id, 0), true)
    }
    fun notificationStop(context: Context, nonce: String?, epoch: Long) = synchronized(lock) {
        val current = config ?: return
        if (!scope.acceptsAction(nonce, epoch, current.pair) || epoch != current.generation) return
        connectionPrefs(context).edit().remove(current.pair.backendId).apply(); failures.remove(current.pair.backendId)
        retireLocked()
    }
    fun attach(value: BobConnectionService) = synchronized(lock) { service = value }
    fun retireIfIdle(value: BobConnectionService) = synchronized(lock) {
        if (service === value && config == null) value.retire()
    }
    fun publish(value: BobConnectionService): Boolean = synchronized(lock) {
        val current = config ?: return false
        if (service !== value || !scope.accepts(current.generation, current.pair)) return false
        if (!connectionVisible(value)) { fail(current, "notifications"); return false }
        try {
            value.foreground(current.pair, current.generation)
            published = current.generation
            true
        } catch (_: Exception) { fail(current, "start"); false }
    }
    fun ready(value: BobConnectionService): ConnectionConfig? = synchronized(lock) {
        config?.takeIf { service === value && published == it.generation && scope.accepts(it.generation, it.pair) }
    }
    fun current(value: BobConnectionService, candidate: ConnectionConfig): Boolean = synchronized(lock) {
        service === value && config === candidate && published == candidate.generation && scope.accepts(candidate.generation, candidate.pair)
    }
    fun transport(value: BobConnectionService, candidate: ConnectionConfig, socket: HttpURLConnection): Boolean = synchronized(lock) {
        if (!current(value, candidate)) return false
        value.installTransport(socket); true
    }
    fun activity(value: BobConnectionService, candidate: ConnectionConfig): Boolean = synchronized(lock) {
        if (!current(value, candidate)) return false
        value.workerActivity(candidate.generation); true
    }
    fun attempt(value: BobConnectionService, candidate: ConnectionConfig): Boolean = synchronized(lock) {
        if (!current(value, candidate)) return false
        cache.attempt(); statusLocked(candidate, if (cache.snapshot == null) "connecting" else "reconnecting")
        changedLocked(candidate.pair); true
    }
    fun received(candidate: ConnectionConfig, snapshot: String?) = synchronized(lock) {
        if (config !== candidate || !scope.accepts(candidate.generation, candidate.pair)) return
        val now = SystemClock.elapsedRealtime()
        val recovered = if (snapshot != null) cache.snapshot(snapshot, now) else cache.heartbeat(now)
        // A stale local read can report reconnecting while the socket's status still says connected.
        if (recovered && status == "connected") changedLocked(candidate.pair, true)
        if (cache.healthy(now)) statusLocked(candidate, "connected")
        if (snapshot != null) changedLocked(candidate.pair)
    }
    fun health(candidate: ConnectionConfig, next: String) = synchronized(lock) {
        if (config === candidate && scope.accepts(candidate.generation, candidate.pair)) {
            if (next != "connected") cache.disconnected()
            statusLocked(candidate, next)
        }
    }
    fun fail(candidate: ConnectionConfig, error: String) = synchronized(lock) {
        if (config !== candidate || !scope.accepts(candidate.generation, candidate.pair)) return
        failures[candidate.pair.backendId] = ConnectionFailure(candidate.pair, error); retireLocked()
    }
    fun detached(value: BobConnectionService) = synchronized(lock) {
        if (service !== value) return
        service = null; published = -1
        // A retiring instance must not erase a newer, not-yet-published start.
        val old = config
        if (old != null && old.generation == value.foregroundGeneration) {
            failures[old.pair.backendId] = ConnectionFailure(old.pair, "start")
            config = null; scope.retire(); status = "off"; cache.clear(); changedLocked(old.pair, true)
        }
    }
    private fun currentStatus(): String = if (status == "connected" && !cache.healthy(SystemClock.elapsedRealtime())) "reconnecting" else status
    fun readStream(context: Context, pair: ConnectionPair, observerId: String, afterRevision: Double): String {
      // Capture one immutable view and acknowledge atomically; escaping a large
      // snapshot must not block worker publication, Stop or Activity callbacks.
      val result = synchronized(lock) {
        val selected = scope.selected == pair
        observer.read(pair, observerId, selected)
        val enabled = connectionEnabled(context, pair.backendId)
        val active = config?.takeIf { it.pair == pair && scope.accepts(it.generation, pair) }
        val failure = failures[pair.backendId]?.takeIf { it.pair == pair && selected }
        JSONObject().put("backendId", pair.backendId).put("conversationId", pair.chat)
            .put("enabled", enabled).put("selected", selected)
            .put("status", if (!enabled || !selected) "off" else if (failure != null) "attention" else if (active != null) currentStatus() else "off")
            .put("revision", cache.revision).put("epoch", cache.epoch).apply {
                if (enabled && failure != null) put("error", failure.error)
                if (active != null) {
                    if (cache.revision.toDouble() != afterRevision) cache.snapshot?.let { put("snapshot", it) }
                    cache.age(SystemClock.elapsedRealtime())?.let { put("heartbeatAgeMs", it) }
                }
            }
      }
      return result.toString()
    }
    fun releaseStream(id: String) = synchronized(lock) { observer.release(id) }
    fun state(context: Context, id: String): String = synchronized(lock) {
        val enabled = connectionEnabled(context, id)
        val active = config?.takeIf { it.pair.backendId == id }
        val failure = failures[id]?.takeIf { it.pair == scope.selected }
        val running = active != null && published == active.generation && service != null
        val batteryRestricted = Build.VERSION.SDK_INT >= 23 && !context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName)
        JSONObject().put("enabled", enabled).put("running", running)
            .put("status", if (!enabled) "off" else if (failure != null) "attention" else if (active != null) currentStatus() else "off")
            .put("batteryRestricted", batteryRestricted).apply { if (enabled && failure != null) put("error", failure.error) }.toString()
    }
}

class BobConnection(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context), LifecycleEventListener {
    init { context.addLifecycleEventListener(this); ConnectionRuntime.bridge(context) }
    override fun onHostResume() { ConnectionRuntime.lifecycle(context, true) }
    override fun onHostPause() { ConnectionRuntime.lifecycle(context, false) }
    override fun onHostDestroy() { ConnectionRuntime.lifecycle(context, false) }
    override fun invalidate() {
        context.removeLifecycleEventListener(this); ConnectionRuntime.detachBridge(context); super.invalidate()
    }
    override fun getName() = "BobConnection"
    @ReactMethod fun select(backendId: String, chat: Double, promise: Promise) {
        try {
            val pair = if (backendId.isEmpty() && chat == 0.0) null else ConnectionPair(ConnectionPolicy.identity(backendId), ConnectionPolicy.chat(chat))
            ConnectionRuntime.select(pair); promise.resolve(true)
        } catch (_: Exception) { promise.reject("identity", "Invalid connection selection") }
    }
    @ReactMethod fun start(endpoint: String, backendId: String, token: String, chat: Double, allowEnable: Boolean, promise: Promise) {
        val pair: ConnectionPair; val origin: String
        try {
            origin = PhoneLocationPolicy.endpoint(endpoint, BuildConfig.DEBUG)
            pair = ConnectionPair(ConnectionPolicy.identity(backendId), ConnectionPolicy.chat(chat)); ConnectionPolicy.token(token)
        } catch (_: Exception) { promise.reject("identity", "Invalid connection configuration"); return }
        // Capture before posting, not when the main-thread callback eventually executes.
        val ticket = ConnectionRuntime.startTicket(pair) ?: run { promise.resolve(false); return }
        UiThreadUtil.runOnUiThread {
            // No background prompt or service launch. currentActivity alone is not proof of RESUMED.
            if (context.lifecycleState != LifecycleState.RESUMED || context.currentActivity?.let { !it.isFinishing && !it.isDestroyed } != true) {
                promise.reject("start", "Open Bob before starting the connection"); return@runOnUiThread
            }
            try {
                connectionChannel(context)
                if (!connectionVisible(context)) { promise.reject("notifications", "Enable Keep connected notifications in Android settings"); return@runOnUiThread }
                promise.resolve(ConnectionRuntime.start(context, origin, pair, token, allowEnable, ticket))
            } catch (_: Exception) { promise.reject("start", "Unable to start connection") }
        }
    }
    @ReactMethod fun stop(backendId: String, promise: Promise) {
        try { ConnectionRuntime.stop(context, ConnectionPolicy.identity(backendId)); promise.resolve(true) }
        catch (_: Exception) { promise.reject("identity", "Invalid backend identity") }
    }
    @ReactMethod fun forget(backendId: String, promise: Promise) {
        // Local stop/unpair only: never aborts a chat or contacts the backend.
        stop(backendId, promise)
    }
    @ReactMethod fun state(backendId: String, promise: Promise) {
        try { promise.resolve(ConnectionRuntime.state(context, ConnectionPolicy.identity(backendId))) }
        catch (_: Exception) { promise.reject("identity", "Invalid backend identity") }
    }
    @ReactMethod fun addListener(eventName: String) { /* NativeEventEmitter compatibility. */ }
    @ReactMethod fun removeListeners(count: Double) { /* JS subscriptions never own the service. */ }
    @ReactMethod fun readStream(backendId: String, chat: Double, observerId: String, afterRevision: Double, promise: Promise) {
        try {
            require(observerId.matches(Regex("[A-Za-z0-9_-]{1,128}")))
            require(afterRevision.isFinite() && afterRevision >= -1 && afterRevision <= ConnectionPolicy.MAX_CHAT && afterRevision == afterRevision.toLong().toDouble())
            val pair = ConnectionPair(ConnectionPolicy.identity(backendId), ConnectionPolicy.chat(chat))
            promise.resolve(ConnectionRuntime.readStream(context, pair, observerId, afterRevision))
        } catch (_: Exception) { promise.reject("identity", "Invalid stream observer") }
    }
    @ReactMethod fun releaseStream(observerId: String, promise: Promise) {
        ConnectionRuntime.releaseStream(observerId); promise.resolve(true)
    }
    @ReactMethod fun openBatterySettings(promise: Promise) {
        UiThreadUtil.runOnUiThread {
            if (context.lifecycleState != LifecycleState.RESUMED || context.currentActivity?.let { !it.isFinishing && !it.isDestroyed } != true) {
                promise.reject("start", "Open Bob before opening settings"); return@runOnUiThread
            }
            try {
                try { context.currentActivity!!.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
                catch (_: Exception) { context.currentActivity!!.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.packageName))) }
                promise.resolve(true) // Launched, not granted. Never request a direct exemption.
            } catch (_: Exception) { promise.reject("start", "Unable to open Android settings") }
        }
    }
}

/** Owner-enabled continuous private chat transport. Timed CPU leases do not wake the screen.
 * No restart, headless JS, message replay, phone dispatch, or shared BobLocationService lifecycle.
 * Android Doze/OEM/network policies can still interrupt connectivity. */
class BobConnectionService : Service() {
    @Volatile private var alive = true
    private var worker: Thread? = null
    private val cpu by lazy {
        getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Bob:ChatStream").apply { setReferenceCounted(false) }
    }
    private val cpuLease = ConnectionWakeLease({ cpu.acquire(it) }, { if (cpu.isHeld) cpu.release() })
    internal fun workerActivity(generation: Long) { cpuLease.activity(generation, SystemClock.elapsedRealtime()) }
    private val wake = Semaphore(0)
    private val socket = AtomicReference<HttpURLConnection?>(null)
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private val defaultNetwork = AtomicReference<Network?>(null)
    private var lastStartId = 0
    internal var foregroundGeneration = -1L; private set
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onCreate() {
        super.onCreate(); ConnectionRuntime.attach(this)
        try { connectionChannel(this) } catch (_: Exception) { /* publish reports a safe literal failure */ }
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { if (defaultNetwork.getAndSet(network) != network) networkChanged() }
            override fun onLost(network: Network) { if (defaultNetwork.compareAndSet(network, null)) networkChanged() }
        }
        try {
            getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(callback)
            networkCallback = callback
        } catch (_: Exception) { /* Read timeouts/backoff still recover if Android withholds callbacks. */ }
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        lastStartId = startId
        if (intent?.action == CONNECTION_STOP) {
            ConnectionRuntime.notificationStop(this, intent.getStringExtra("nonce"), intent.getLongExtra("generation", -1))
            // An old action is a no-op, including for the new foreground notification.
            ConnectionRuntime.retireIfIdle(this)
            return START_NOT_STICKY
        }
        if (intent == null || !alive || !ConnectionRuntime.publish(this)) { retire(); return START_NOT_STICKY }
        if (worker == null) worker = Thread({ monitor() }, "bob-connection").apply { start() }
        signal()
        return START_NOT_STICKY
    }
    internal fun foreground(pair: ConnectionPair, generation: Long) {
        val open = PendingIntent.getActivity(this, 0,
            Intent(this, MainActivity::class.java).setAction(Intent.ACTION_VIEW)
                .setData(Uri.parse("bob://work/${pair.backendId}/${pair.chat}"))
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 0,
            Intent(this, BobConnectionService::class.java).setAction(CONNECTION_STOP)
                .setData(Uri.parse("bob-connection://stop/${ConnectionRuntime.processNonce}/$generation"))
                .putExtra("nonce", ConnectionRuntime.processNonce).putExtra("generation", generation),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = (if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CONNECTION_CHANNEL) else Notification.Builder(this))
            .setSmallIcon(R.drawable.ic_stat_bob).setContentTitle("Bob · Keep connected")
            .setContentText("Private chat connection is on")
            .setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true).setShowWhen(false)
            .setVisibility(Notification.VISIBILITY_SECRET)
            .addAction(Notification.Action.Builder(null, "Open", open).build())
            .addAction(Notification.Action.Builder(null, "Turn off connection", stop).build())
            .apply { if (Build.VERSION.SDK_INT >= 31) setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE) }.build()
        if (Build.VERSION.SDK_INT >= 34) startForeground(CONNECTION_NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(CONNECTION_NOTIFICATION, notification)
        foregroundGeneration = generation
    }
    private fun signal() { if (wake.availablePermits() == 0) wake.release() }
    internal fun installTransport(value: HttpURLConnection) { socket.set(value) }
    internal fun cancelTransport() { cpuLease.clear(); socket.getAndSet(null)?.disconnect(); signal() }
    private fun networkChanged() {
        // A single existing worker reconnects; network callbacks never spawn another stream.
        cancelTransport()
    }
    internal fun retire() {
        cancelTransport()
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE) else @Suppress("DEPRECATION") stopForeground(true)
        stopSelfResult(lastStartId)
    }
    private fun monitor() {
        var attempt = 0; var generation = -1L
        while (alive) {
            val config = ConnectionRuntime.ready(this)
            if (config == null) { try { wake.acquire() } catch (_: InterruptedException) { break }; continue }
            if (generation != config.generation) { generation = config.generation; attempt = 0 }
            wake.drainPermits()
            try {
                if (!connectionVisible(this)) throw ConnectionProtocolException("notifications")
                if (!ConnectionRuntime.activity(this, config)) continue
                val began = SystemClock.elapsedRealtime()
                stream(config) { if (SystemClock.elapsedRealtime() - began >= ConnectionPolicy.HEARTBEAT_TIMEOUT_MS) attempt = 0 }
            } catch (_: InterruptedException) { if (!alive) break }
              catch (e: ConnectionProtocolException) { ConnectionRuntime.fail(config, e.code) }
              catch (_: Exception) { /* No exception text, request data, URL or bearer in diagnostics. */ }
            if (!alive) break
            if (!ConnectionRuntime.current(this, config)) continue
            if (!connectionVisible(this)) { ConnectionRuntime.fail(config, "notifications"); continue }
            ConnectionRuntime.health(config, "reconnecting")
            if (!ConnectionRuntime.activity(this, config)) continue
            try { wake.tryAcquire(ConnectionPolicy.retryMillis(attempt, Random.nextDouble()), TimeUnit.MILLISECONDS) }
            catch (_: InterruptedException) { if (!alive) break }
            attempt = (attempt + 1).coerceAtMost(5)
        }
    }
    private fun stream(config: ConnectionConfig, heartbeat: () -> Unit) {
        if (!ConnectionRuntime.attempt(this, config)) return
        val connection = URI(config.endpoint + "/v1/chats/${config.pair.chat}/events?heartbeats=1&patches=1").toURL().openConnection() as HttpURLConnection
        if (!ConnectionRuntime.transport(this, config, connection)) { connection.disconnect(); return }
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 7000; connection.readTimeout = 15_000
            connection.requestMethod = "GET"; connection.useCaches = false
            connection.setRequestProperty("Authorization", "Bearer " + config.token)
            connection.setRequestProperty("x-bob-backend", config.pair.backendId)
            connection.setRequestProperty("Accept", "text/event-stream")
            connection.setRequestProperty("Accept-Encoding", "identity")
            if (!ConnectionRuntime.current(this, config) || socket.get() !== connection) return
            val status = connection.responseCode
            ConnectionPolicy.terminalHttp(status)?.let { throw ConnectionProtocolException(it) }
            if (status != 200) return
            if (connection.contentType?.substringBefore(';')?.trim()?.lowercase() != "text/event-stream") throw ConnectionProtocolException()
            try {
                connection.inputStream.use { input ->
                    val reader = ChatSseReader(input, { SystemClock.elapsedRealtime() })
                    var previous: String? = null; var sequence = 0L
                    while (alive && ConnectionRuntime.current(this, config)) {
                        val frame = reader.next() ?: break
                        var snapshot: String? = null
                        when (frame.event) {
                            "snapshot" -> { ChatWire.snapshot(frame.data, config.pair); snapshot = frame.data; sequence = 0 }
                            "snapshot-patch" -> {
                                val patched = ChatWire.patch(previous, sequence, frame.data)
                                ChatWire.snapshot(patched.first, config.pair); snapshot = patched.first; sequence = patched.second
                            }
                            "heartbeat" -> ChatWire.heartbeat(frame.data, config.pair)
                        }
                        if (!connectionVisible(this)) throw ConnectionProtocolException("notifications")
                        if (!ConnectionRuntime.activity(this, config)) break
                        if (snapshot != null) previous = snapshot
                        // A heartbeat without a validated initial snapshot cannot make this attempt healthy.
                        if (previous != null) { reader.received(); heartbeat(); ConnectionRuntime.received(config, snapshot) }
                    }
                }
            } catch (e: ConnectionProtocolException) {
                // A malformed frame/patch gap requires a fresh authoritative GET, not replay.
                if (e.code == "protocol") throw ConnectionRetryException() else throw e
            }
        } finally { socket.compareAndSet(connection, null); connection.disconnect() }
    }
    override fun onDestroy() {
        synchronized(ConnectionRuntime.lock) {
            alive = false; cancelTransport(); worker?.interrupt(); ConnectionRuntime.detached(this)
        }
        networkCallback?.let { try { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it) } catch (_: Exception) {} }
        networkCallback = null
        super.onDestroy()
    }
}
