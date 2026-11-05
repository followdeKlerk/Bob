package com.bobmobile

import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.BatteryManager
import android.os.PersistableBundle
import android.provider.AlarmClock
import android.provider.CalendarContract
import android.provider.ContactsContract
import android.provider.Settings
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import com.facebook.react.bridge.*
import com.facebook.react.common.LifecycleState
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.GregorianCalendar
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Executors
import java.util.concurrent.FutureTask

/** Pure rules also exercised on the JVM. No java.time dependency: the app supports API 24. */
internal object PhoneToolsPolicy {
    const val MAX_RESULT_BYTES = 65536
    const val MAX_REQUEST_BYTES = 131072
    fun requestSize(raw: String) { require(raw.toByteArray(Charsets.UTF_8).size <= MAX_REQUEST_BYTES) { "Request exceeds 128 KiB" } }
    val actions = setOf("capabilities", "calendar_list", "calendar_events", "calendar_create", "calendar_update", "calendar_delete", "contacts_search", "apps_list", "app_launch", "alarm_set", "timer_set", "device_info", "volume_set", "torch_set", "clipboard_write", "dial", "sms_compose", "share_text", "open_settings")
    val mutating = actions - setOf("capabilities", "calendar_list", "calendar_events", "contacts_search", "apps_list", "device_info")
    fun backend(value: String) { require(value.length in 1..200 && value.all { it.code in 33..126 }) { "Invalid backendId" } }
    fun id(value: String): String { require(value.matches(Regex("[0-9a-fA-F]{64}"))) { "id must be 64 hexadecimal characters" }; return value.lowercase(Locale.ROOT) }
    fun fingerprint(value: String): String = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    fun fresh(expires: Long, now: Long) { require(expires > now) { "Request expired. Check its stored receipt or operation_status; do not repeat an uncertain action." } }
    val recurrenceColumns = listOf("rrule", "rdate", "exrule", "exdate", "original_id", "original_sync_id", "originalInstanceTime")
    fun recurring(values: List<String?>) = values.any { !it.isNullOrEmpty() }
    /** null input means omitted, not empty. Existing allDay null identifies a create. */
    data class EventOptionalFields(val allDay: Boolean, val writeAllDay: Boolean, val description: String?, val location: String?) {
        fun write(putText: (String, String) -> Unit, putAllDay: (Int) -> Unit) {
            if (writeAllDay) putAllDay(if (allDay) 1 else 0)
            description?.let { putText("description", it) }
            location?.let { putText("eventLocation", it) }
        }
    }
    fun eventOptionalFields(existingAllDay: Boolean?, allDay: Boolean?, description: String?, location: String?): EventOptionalFields {
        val creating = existingAllDay == null
        return EventOptionalFields(allDay ?: existingAllDay ?: false, creating || allDay != null,
            if (creating) description ?: "" else description, if (creating) location ?: "" else location)
    }
    data class DateValue(val millis: Long, val offset: Int)
    fun date(value: String): DateValue {
        val match = Regex("(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})(?:\\.(\\d{1,9}))?(Z|[+-]\\d{2}:\\d{2})").matchEntire(value)
            ?: throw IllegalArgumentException("Dates must be ISO8601 timestamps with an explicit offset")
        val g = match.groupValues
        require(g[1].toInt() in 1..9999) { "Invalid year" }
        require(g[7].drop(3).all { it == '0' }) { "Dates support millisecond precision only" }
        val suffix = g[8]
        val hours = if (suffix == "Z") 0 else suffix.substring(1, 3).toInt()
        val minutes = if (suffix == "Z") 0 else suffix.substring(4, 6).toInt()
        require(hours <= 18 && minutes <= 59 && (hours < 18 || minutes == 0)) { "Invalid UTC offset" }
        val offset = (hours * 60 + minutes) * 60000 * if (suffix.startsWith("-")) -1 else 1
        val calendar = GregorianCalendar(TimeZone.getTimeZone("UTC"), Locale.ROOT).apply {
            gregorianChange = java.util.Date(Long.MIN_VALUE)
            isLenient = false; clear()
            set(g[1].toInt(), g[2].toInt() - 1, g[3].toInt(), g[4].toInt(), g[5].toInt(), g[6].toInt())
            set(Calendar.MILLISECOND, g[7].padEnd(3, '0').take(3).toInt())
        }
        return DateValue(calendar.timeInMillis - offset, offset)
    }
    fun range(start: DateValue, end: DateValue, listing: Boolean = false) {
        require(end.millis > start.millis) { "end must be after start" }
        if (listing) require(end.millis - start.millis <= 366L * 86400000L) { "Calendar range must be positive and at most 366 days" }
    }
    /** Return the exact instants with their event-zone offsets, so list results
     * round-trip through eventDates unchanged, including across a DST boundary. */
    fun timestamp(millis: Long, zone: String): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.ROOT).apply {
        calendar = GregorianCalendar(TimeZone.getTimeZone(zone), Locale.ROOT).apply { gregorianChange = java.util.Date(Long.MIN_VALUE) }
    }.format(java.util.Date(millis))
    fun eventDates(start: DateValue, end: DateValue, zone: String, allDay: Boolean) {
        range(start, end)
        require(zone in TimeZone.getAvailableIDs() || zone == "UTC") { "timeZone must be a recognized timezone ID" }
        if (allDay) {
            require(zone == "UTC" && start.offset == 0 && end.offset == 0 && start.millis % 86400000L == 0L && end.millis % 86400000L == 0L) {
                "All-day events require timeZone UTC and UTC midnight start/end; end is exclusive"
            }
        } else {
            val tz = TimeZone.getTimeZone(zone)
            require(tz.getOffset(start.millis) == start.offset && tz.getOffset(end.millis) == end.offset) { "Timestamp offsets must match timeZone at start and end" }
        }
    }
}

private class PhoneUnavailable(message: String) : Exception(message)

internal interface PhoneReceiptStore {
    fun find(backend: String, id: String): Pair<String, String>?
    fun begin(backend: String, id: String, fingerprint: String, expires: Long, unknown: String)
    fun finish(backend: String, id: String, result: String)
}

/** Shared by the real SQLite store and crash/replay regression tests. Called on the single queue. */
internal object PhoneToolsLedger {
    fun run(store: PhoneReceiptStore, backend: String, id: String, fingerprint: String, expires: Long, now: Long,
            unknown: String, mismatch: String, operation: () -> String): String {
        PhoneToolsPolicy.fresh(expires, now)
        store.find(backend, id)?.let { return if (it.first == fingerprint) it.second else mismatch }
        store.begin(backend, id, fingerprint, expires, unknown)
        val result = operation()
        store.finish(backend, id, result)
        return result
    }
}

/** Local-only ledger. A committed unknown receipt is the crash boundary, never a retry instruction. */
private class PhoneToolReceipts(context: Context) : SQLiteOpenHelper(context, "phone-tools-v1.db", null, 1), PhoneReceiptStore {
    override fun onConfigure(db: SQLiteDatabase) {
        super.onConfigure(db)
        db.execSQL("PRAGMA synchronous=FULL")
    }
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE receipts (backend TEXT NOT NULL, id TEXT NOT NULL, fingerprint TEXT NOT NULL, expires INTEGER NOT NULL, result TEXT NOT NULL, PRIMARY KEY(backend,id))")
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) { throw IllegalStateException("Receipt migration required") }
    override fun find(backend: String, id: String): Pair<String, String>? = readableDatabase.query("receipts", arrayOf("fingerprint", "result"), "backend=? AND id=?", arrayOf(backend, id), null, null, null).use {
        if (it.moveToFirst()) Pair(it.getString(0), it.getString(1)) else null
    }
    override fun begin(backend: String, id: String, fingerprint: String, expires: Long, unknown: String) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.delete("receipts", "expires<=?", arrayOf(System.currentTimeMillis().toString()))
            db.rawQuery("SELECT COUNT(*) FROM receipts", null).use { it.moveToFirst(); check(it.getInt(0) < 4096) { "Receipt storage full; wait for outstanding requests to expire" } }
            db.insertOrThrow("receipts", null, ContentValues().apply {
                put("backend", backend); put("id", id); put("fingerprint", fingerprint); put("expires", expires); put("result", unknown)
            })
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }
    override fun finish(backend: String, id: String, result: String) {
        check(writableDatabase.update("receipts", ContentValues().apply { put("result", result) }, "backend=? AND id=?", arrayOf(backend, id)) == 1) { "Unable to persist operation result" }
    }
}

/** Fixed native API, not an intent/shell/JS interpreter. All requests share one process-wide queue. */
class BobPhoneTools(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    companion object { private val executor = Executors.newSingleThreadExecutor { task -> Thread(task, "bob-phone-tools") } }
    private val preferences by lazy { context.getSharedPreferences("phone-tools", Context.MODE_PRIVATE) }
    private val receipts by lazy { PhoneToolReceipts(context) }
    override fun getName() = "BobPhoneTools"
    private fun isEnabled(backend: String) = preferences.getBoolean("enabled:$backend", false)
    @ReactMethod fun enabled(backendId: String, promise: Promise) { executor.execute {
        try { PhoneToolsPolicy.backend(backendId); promise.resolve(isEnabled(backendId)) }
        catch (e: Exception) { promise.reject("phone_tools", safeMessage(e)) }
    } }
    /** Receipt lookup only: no dispatch, pruning, permission prompt, or effect. */
    @ReactMethod fun getResult(backendId: String, requestId: String, promise: Promise) { executor.execute {
        try {
            PhoneToolsPolicy.backend(backendId); val id = PhoneToolsPolicy.id(requestId)
            require(isEnabled(backendId)) { "Phone tools are disabled for this backend" }; foreground()
            promise.resolve(receipts.find(backendId, id)?.second)
        } catch (e: Exception) { promise.reject("phone_tools", safeMessage(e)) }
    } }
    @ReactMethod fun setEnabled(backendId: String, enabled: Boolean, promise: Promise) { executor.execute {
        try {
            PhoneToolsPolicy.backend(backendId)
            if (enabled) foreground()
            check(preferences.edit().putBoolean("enabled:$backendId", enabled).commit()) { "Unable to save phone-tools enablement" }
            promise.resolve(enabled)
        } catch (e: Exception) { promise.reject("phone_tools", safeMessage(e)) }
    } }
    @ReactMethod fun execute(backendId: String, requestJson: String, promise: Promise) { executor.execute {
        try { promise.resolve(executeRequest(backendId, requestJson)) }
        catch (_: Exception) { promise.reject("phone_tools_storage", "Unable to persist phone operation receipt; do not retry with a new id. Check the original id after reopening Bob.") }
    } }
    private fun result(status: String, data: JSONObject? = null, message: String? = null) = JSONObject().put("status", status).apply {
        if (data != null) put("data", data)
        if (message != null) put("message", message.take(500))
    }
    private fun safeMessage(e: Exception) = when (e) {
        is SecurityException -> "Android permission denied. Grant the required permission in Bob's app settings."
        is IllegalArgumentException, is PhoneUnavailable, is IllegalStateException -> (e.message ?: "Operation unavailable").take(500)
        else -> "Android could not complete this operation (${e.javaClass.simpleName.take(80)})"
    }
    private fun bounded(value: JSONObject): String {
        val text = value.toString()
        return if (text.toByteArray(Charsets.UTF_8).size <= PhoneToolsPolicy.MAX_RESULT_BYTES) text
        else result("error", message = "Result exceeded 64 KiB; request a smaller page").toString()
    }
    private fun executeRequest(backend: String, raw: String): String {
        val request: JSONObject
        val id: String
        val action: String
        val parameters: JSONObject
        val expires: Long
        try {
            PhoneToolsPolicy.backend(backend)
            PhoneToolsPolicy.requestSize(raw)
            request = JSONObject(raw)
            keys(request, setOf("id", "action", "parameters", "expiresAt"))
            id = PhoneToolsPolicy.id(string(request, "id", 64))
            action = string(request, "action", 64)
            require(action in PhoneToolsPolicy.actions) { "Unknown phone action" }
            parameters = request.opt("parameters") as? JSONObject ?: throw IllegalArgumentException("parameters must be an object")
            require(parameters.keys().asSequence().all { parameters.get(it) is String || parameters.get(it) is Number || parameters.get(it) is Boolean }) { "parameters must contain flat non-null values" }
            expires = integer(request, "expiresAt", 1, Long.MAX_VALUE)
            PhoneToolsPolicy.fresh(expires, System.currentTimeMillis())
            require(isEnabled(backend)) { "Phone tools are disabled for this backend" }
            foreground()
        } catch (e: Exception) { return bounded(result(if (e is PhoneUnavailable) "unavailable" else "error", message = safeMessage(e))) }
        // Hash the COMPLETE wire request (including expiry and all parameters), not just its action.
        val fingerprint = PhoneToolsPolicy.fingerprint(raw)
        val unknown = bounded(result("unknown", message = "Operation recorded; completion is unknown or in progress. Do not repeat with a new id."))
        val mismatch = bounded(result("error", message = "Request id already belongs to a different payload; do not reuse ids"))
        return PhoneToolsLedger.run(receipts, backend, id, fingerprint, expires, System.currentTimeMillis(), unknown, mismatch) {
            val outcome = try {
                guard(backend, expires)
                dispatch(backend, expires, action, parameters)
            } catch (e: Exception) {
                val status = when {
                    e is PhoneUnavailable || e is SecurityException -> "unavailable"
                    e is IllegalArgumentException -> "error"
                    action in PhoneToolsPolicy.mutating -> "unknown"
                    else -> "error"
                }
                result(status, message = safeMessage(e))
            }
            bounded(outcome)
        }
    }
    private fun foreground(): Activity {
        val activity = context.currentActivity
        if (context.lifecycleState != LifecycleState.RESUMED || activity == null || activity.isFinishing || activity.isDestroyed ||
            (activity as? LifecycleOwner)?.lifecycle?.currentState != Lifecycle.State.RESUMED) throw PhoneUnavailable("Keep Bob open and resumed to use phone tools")
        return activity
    }
    private fun guard(backend: String, expires: Long): Activity {
        if (!isEnabled(backend)) throw PhoneUnavailable("Phone tools are disabled for this backend")
        PhoneToolsPolicy.fresh(expires, System.currentTimeMillis())
        return foreground()
    }
    private fun onActivity(backend: String, expires: Long, block: (Activity) -> JSONObject): JSONObject {
        val activity = guard(backend, expires)
        val task = FutureTask { block(guard(backend, expires)) }
        activity.runOnUiThread(task)
        return try { task.get() } catch (e: java.util.concurrent.ExecutionException) { throw (e.cause as? Exception ?: e) }
    }
    private fun launch(backend: String, expires: Long, intent: Intent, data: JSONObject = JSONObject()): JSONObject = onActivity(backend, expires) { activity ->
        try { activity.startActivity(intent) }
        catch (_: android.content.ActivityNotFoundException) { throw PhoneUnavailable("No installed app can handle this action") }
        result("launched", data, "Handed action to Android; completion, sending, or saving is not verified")
    }
    private fun allowed(permission: String) = context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
    private fun permission(permission: String) { if (!allowed(permission)) throw PhoneUnavailable("Android ${permission.substringAfterLast('.')} permission required; grant it in Bob's app settings") }
    private fun keys(p: JSONObject, allowed: Set<String>) { require(p.keys().asSequence().all { it in allowed }) { "Unexpected parameter; only ${allowed.sorted().joinToString()} are accepted" } }
    private fun string(p: JSONObject, key: String, max: Int, optional: Boolean = false): String {
        if (!p.has(key) && optional) return ""
        val value = p.opt(key)
        require(value is String && value.length <= max) { "$key must be a string of at most $max characters" }
        if (!optional) require(value.isNotEmpty()) { "$key is required" }
        return value
    }
    private fun integer(p: JSONObject, key: String, min: Long, max: Long, default: Long? = null): Long {
        if (!p.has(key) && default != null) return default
        val value = p.opt(key)
        require(value is Number && value.toDouble().isFinite() && value.toDouble() == value.toLong().toDouble() && value.toLong() in min..max) { "$key must be an integer in $min..$max" }
        return value.toLong()
    }
    private fun bool(p: JSONObject, key: String, default: Boolean? = null): Boolean {
        if (!p.has(key) && default != null) return default
        val value = p.opt(key); require(value is Boolean) { "$key must be boolean" }; return value
    }
    private fun numericId(p: JSONObject, key: String): String {
        val value = string(p, key, 19)
        require(value.matches(Regex("[0-9]+")) && value.toLongOrNull()?.let { it > 0 } == true) { "$key must be a positive numeric string" }
        return value.toLong().toString()
    }
    private fun limit(p: JSONObject, max: Int) = integer(p, "limit", 1, max.toLong(), minOf(50, max).toLong()).toInt()
    private fun offset(p: JSONObject) = integer(p, "offset", 0, Int.MAX_VALUE.toLong(), 0).toInt()
    private fun iso(millis: Long, zone: String) = PhoneToolsPolicy.timestamp(millis, zone)
    private fun dispatch(backend: String, expires: Long, action: String, p: JSONObject): JSONObject = when (action) {
        "capabilities" -> { keys(p, emptySet()); result("ok", capabilities()) }
        "device_info" -> {
            keys(p, emptySet())
            result("ok", deviceInfo())
        }
        "calendar_list" -> { keys(p, emptySet()); calendarList() }
        "calendar_events" -> calendarEvents(p)
        "calendar_create", "calendar_update", "calendar_delete" -> calendarWrite(backend, expires, action, p)
        "contacts_search" -> contacts(p)
        "apps_list" -> apps(p)
        "app_launch" -> {
            keys(p, setOf("packageName")); val name = string(p, "packageName", 255)
            require(name.matches(Regex("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+"))) { "Invalid packageName" }
            if (launcherApps().none { it.activityInfo.packageName == name }) throw PhoneUnavailable("Package has no visible launcher activity")
            val intent = context.packageManager.getLaunchIntentForPackage(name) ?: throw PhoneUnavailable("Launcher unavailable")
            launch(backend, expires, intent, JSONObject().put("packageName", name))
        }
        "alarm_set" -> {
            keys(p, setOf("hour", "minute", "title"))
            val hour = integer(p, "hour", 0, 23); val minute = integer(p, "minute", 0, 59)
            launch(backend, expires, Intent(AlarmClock.ACTION_SET_ALARM).putExtra(AlarmClock.EXTRA_HOUR, hour.toInt()).putExtra(AlarmClock.EXTRA_MINUTES, minute.toInt()).putExtra(AlarmClock.EXTRA_MESSAGE, string(p, "title", 500, true)).putExtra(AlarmClock.EXTRA_SKIP_UI, true))
        }
        "timer_set" -> {
            keys(p, setOf("durationSeconds", "title"))
            val seconds = integer(p, "durationSeconds", 1, 86400)
            launch(backend, expires, Intent(AlarmClock.ACTION_SET_TIMER).putExtra(AlarmClock.EXTRA_LENGTH, seconds.toInt()).putExtra(AlarmClock.EXTRA_MESSAGE, string(p, "title", 500, true)).putExtra(AlarmClock.EXTRA_SKIP_UI, true))
        }
        "volume_set" -> {
            keys(p, setOf("percent")); val percent = integer(p, "percent", 0, 100).toInt()
            val audio = context.getSystemService(AudioManager::class.java)
            if (audio.isVolumeFixed) throw PhoneUnavailable("This device has fixed volume")
            val maximum = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
            guard(backend, expires); audio.setStreamVolume(AudioManager.STREAM_MUSIC, (maximum * percent + 50) / 100, 0)
            result("ok", JSONObject().put("stream", "music").put("requestedPercent", percent).put("volume", audio.getStreamVolume(AudioManager.STREAM_MUSIC)).put("maxVolume", maximum))
        }
        "torch_set" -> {
            keys(p, setOf("enabled")); val enabled = bool(p, "enabled"); permission(Manifest.permission.CAMERA)
            val manager = context.getSystemService(CameraManager::class.java)
            val camera = torchCamera() ?: throw PhoneUnavailable("No camera flash is available")
            guard(backend, expires); manager.setTorchMode(camera, enabled)
            result("ok", JSONObject().put("requestedEnabled", enabled), "Torch mode requested; hardware availability may change")
        }
        "clipboard_write" -> {
            keys(p, setOf("text")); require(p.has("text")) { "text is required" }; val text = string(p, "text", 20000, true)
            onActivity(backend, expires) {
                val clip = ClipData.newPlainText("Bob", text)
                clip.description.extras = PersistableBundle().apply { putBoolean("android.content.extra.IS_SENSITIVE", true) }
                context.getSystemService(ClipboardManager::class.java).setPrimaryClip(clip)
                result("ok", JSONObject().put("characters", text.length))
            }
        }
        "dial", "sms_compose" -> {
            keys(p, if (action == "dial") setOf("number") else setOf("number", "text"))
            val number = string(p, "number", 100)
            require(number.matches(Regex("[+0-9 ()*#.,-]+")) && number.any { it.isDigit() }) { "Invalid phone number" }
            val intent = if (action == "dial") Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", number, null))
                else {
                    require(p.has("text")) { "text is required" }
                    Intent(Intent.ACTION_SENDTO, Uri.fromParts("smsto", number, null)).putExtra("sms_body", string(p, "text", 5000, true))
                }
            launch(backend, expires, intent)
        }
        "share_text" -> {
            keys(p, setOf("text", "title")); require(p.has("text")) { "text is required" }; val text = string(p, "text", 20000, true); val title = string(p, "title", 500, true)
            launch(backend, expires, Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text).putExtra(Intent.EXTRA_SUBJECT, title), title.ifEmpty { "Share text" }))
        }
        "open_settings" -> {
            keys(p, setOf("panel")); val panel = string(p, "panel", 40)
            launch(backend, expires, settingsIntent(panel), JSONObject().put("panel", panel))
        }
        else -> throw IllegalArgumentException("Unknown action")
    }
    private fun deviceInfo(): JSONObject {
        val manager = context.getSystemService(BatteryManager::class.java)
        val capacity = try { manager?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)?.takeIf { it in 0..100 } } catch (_: Exception) { null }
        val charging = try { manager?.isCharging } catch (_: Exception) { null }
        val battery = JSONObject().put("capacityPercent", capacity ?: JSONObject.NULL).put("isCharging", charging ?: JSONObject.NULL).put("capturedAt", System.currentTimeMillis())
        return JSONObject().put("manufacturer", Build.MANUFACTURER.take(200)).put("model", Build.MODEL.take(200)).put("androidVersion", Build.VERSION.RELEASE.take(80))
            .put("sdkInt", Build.VERSION.SDK_INT).put("appPackage", context.packageName).put("battery", battery)
    }
    private fun settingsIntent(panel: String): Intent = when (panel) {
        "app" -> Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
        "notifications" -> if (Build.VERSION.SDK_INT >= 26) Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName) else settingsIntent("app")
        "wifi" -> Intent(Settings.ACTION_WIFI_SETTINGS)
        "bluetooth" -> Intent(Settings.ACTION_BLUETOOTH_SETTINGS)
        "location" -> Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)
        "accessibility" -> Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
        "notification_access" -> Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        "battery" -> Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
        else -> throw IllegalArgumentException("Unknown settings panel")
    }
    private fun torchCamera(): String? {
        if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_FLASH)) return null
        val manager = context.getSystemService(CameraManager::class.java)
        return manager.cameraIdList.firstOrNull { manager.getCameraCharacteristics(it).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true }
    }
    private fun launcherApps() = context.packageManager.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)
        .filter { it.activityInfo.exported && it.activityInfo.enabled && it.activityInfo.applicationInfo.enabled }
        .distinctBy { it.activityInfo.packageName }.sortedBy { it.activityInfo.packageName }

    private fun capabilities(): JSONObject {
        val permissions = JSONObject()
        listOf(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR, Manifest.permission.READ_CONTACTS, Manifest.permission.CAMERA, Manifest.permission.MODIFY_AUDIO_SETTINGS, "com.android.alarm.permission.SET_ALARM").forEach { permissions.put(it, allowed(it)) }
        val pm = context.packageManager
        fun resolves(intent: Intent) = intent.resolveActivity(pm) != null
        val calendarSupport = pm.resolveContentProvider(CalendarContract.AUTHORITY, 0) != null
        val contactsSupport = pm.resolveContentProvider(ContactsContract.AUTHORITY, 0) != null
        val flash = try { torchCamera() != null } catch (_: Exception) { false }
        val details = JSONObject()
        PhoneToolsPolicy.actions.forEach { action ->
            val required = when (action) {
                "calendar_list", "calendar_events" -> listOf(Manifest.permission.READ_CALENDAR)
                "calendar_create", "calendar_update", "calendar_delete" -> listOf(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR)
                "contacts_search" -> listOf(Manifest.permission.READ_CONTACTS)
                "torch_set" -> listOf(Manifest.permission.CAMERA)
                "volume_set" -> listOf(Manifest.permission.MODIFY_AUDIO_SETTINGS)
                "alarm_set", "timer_set" -> listOf("com.android.alarm.permission.SET_ALARM")
                else -> emptyList()
            }
            val supported = when (action) {
                "calendar_list", "calendar_events", "calendar_create", "calendar_update", "calendar_delete" -> calendarSupport
                "contacts_search" -> contactsSupport
                "torch_set" -> flash
                "volume_set" -> !context.getSystemService(AudioManager::class.java).isVolumeFixed
                "alarm_set" -> resolves(Intent(AlarmClock.ACTION_SET_ALARM))
                "timer_set" -> resolves(Intent(AlarmClock.ACTION_SET_TIMER))
                "dial" -> resolves(Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", "0", null)))
                "sms_compose" -> resolves(Intent(Intent.ACTION_SENDTO, Uri.fromParts("smsto", "0", null)))
                "share_text" -> resolves(Intent(Intent.ACTION_SEND).setType("text/plain"))
                "app_launch" -> launcherApps().isNotEmpty()
                else -> true
            }
            details.put(action, JSONObject().put("implemented", true).put("supported", supported).put("permissionGranted", required.all { allowed(it) }).put("available", supported && required.all { allowed(it) }).put("requiredPermissions", JSONArray(required)))
        }
        val panels = JSONObject()
        listOf("app", "notifications", "wifi", "bluetooth", "location", "accessibility", "notification_access", "battery").forEach { panels.put(it, resolves(settingsIntent(it))) }
        return JSONObject().put("actions", details).put("permissions", permissions).put("settingsPanels", panels).put("foregroundRequired", true).put("calendarMutationScope", "non_recurring_events_only").put("maxResultBytes", PhoneToolsPolicy.MAX_RESULT_BYTES)
    }

    /** Keep pages below the wire bound; byte-limited pages resume at the first unreturned row. */
    private fun page(cursor: Cursor, offset: Int, limit: Int, row: (Cursor) -> JSONObject): JSONObject {
        val items = JSONArray(); var bytes = 0; var count = 0
        var more = cursor.moveToPosition(offset)
        while (more && count < limit) {
            val item = row(cursor); val size = item.toString().toByteArray(Charsets.UTF_8).size
            require(size <= 56000) { "A provider row exceeds the safe page size" }
            if (bytes + size > 56000) break
            items.put(item); bytes += size + 1; count++; more = cursor.moveToNext()
        }
        return JSONObject().put("items", items).put("offset", offset).put("complete", !more).apply { if (more) put("nextOffset", offset.toLong() + count) }
    }
    private fun Cursor.text(column: String, max: Int = 1000): String = getColumnIndex(column).let { if (it < 0 || isNull(it)) "" else getString(it).take(max) }
    private fun calendarList(): JSONObject {
        permission(Manifest.permission.READ_CALENDAR)
        val columns = arrayOf("_id", "calendar_displayName", "account_name", "calendar_access_level", "visible", "sync_events")
        val items = JSONArray(); var bytes = 0
        context.contentResolver.query(CalendarContract.Calendars.CONTENT_URI, columns, null, null, "_id ASC")?.use { c ->
            while (c.moveToNext()) {
                val access = c.getInt(3)
                val item = JSONObject().put("calendarId", c.getString(0)).put("name", c.text("calendar_displayName", 200)).put("account", c.text("account_name", 200)).put("accessLevel", access).put("writable", access >= CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR).put("visible", c.getInt(4) != 0)
                bytes += item.toString().toByteArray(Charsets.UTF_8).size
                if (bytes > 56000) throw PhoneUnavailable("Calendar list exceeds safe result size")
                items.put(item)
            }
        } ?: throw PhoneUnavailable("Calendar provider unavailable")
        return result("ok", JSONObject().put("items", items).put("complete", true))
    }
    private fun calendarEvents(p: JSONObject): JSONObject {
        keys(p, setOf("start", "end", "calendarId", "limit", "offset")); permission(Manifest.permission.READ_CALENDAR)
        val start = PhoneToolsPolicy.date(string(p, "start", 64)); val end = PhoneToolsPolicy.date(string(p, "end", 64)); PhoneToolsPolicy.range(start, end, true)
        val calendar = if (p.has("calendarId")) numericId(p, "calendarId") else null
        val limit = limit(p, 200); val offset = offset(p)
        val uri = CalendarContract.Instances.CONTENT_URI.buildUpon().apply { ContentUris.appendId(this, start.millis); ContentUris.appendId(this, end.millis) }.build()
        val columns = arrayOf("event_id", "calendar_id", "title", "begin", "end", "allDay", "eventTimezone", "eventLocation", "description") + PhoneToolsPolicy.recurrenceColumns
        val selection = "begin < ? AND end > ?" + if (calendar != null) " AND calendar_id=?" else ""
        val args = mutableListOf(end.millis.toString(), start.millis.toString()).apply { if (calendar != null) add(calendar) }.toTypedArray()
        val data = context.contentResolver.query(uri, columns, selection, args, "begin ASC, event_id ASC, end ASC")?.use { c ->
            page(c, offset, limit) { row ->
                val allDay = row.getInt(5) != 0
                val zone = if (allDay) "UTC" else row.text("eventTimezone", 200).ifEmpty { "UTC" }
                JSONObject().put("eventId", row.getString(0)).put("calendarId", row.getString(1)).put("title", row.text("title"))
                    .put("start", iso(row.getLong(3), zone)).put("end", iso(row.getLong(4), zone)).put("allDay", allDay)
                    .put("timeZone", zone).put("location", row.text("eventLocation")).put("description", row.text("description"))
                    .put("recurring", PhoneToolsPolicy.recurring(PhoneToolsPolicy.recurrenceColumns.map { row.text(it) })).put("scope", "instance")
            }
        } ?: throw PhoneUnavailable("Calendar provider unavailable")
        return result("ok", data.put("textFieldsMayBeTruncated", true).put("rangeEndExclusive", true))
    }
    private fun writableCalendar(id: String) {
        permission(Manifest.permission.READ_CALENDAR); permission(Manifest.permission.WRITE_CALENDAR)
        context.contentResolver.query(CalendarContract.Calendars.CONTENT_URI, arrayOf("calendar_access_level"), "_id=?", arrayOf(id), null)?.use { c ->
            require(c.moveToFirst()) { "Calendar not found" }
            if (c.getInt(0) < CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR) throw PhoneUnavailable("Calendar is read-only")
        } ?: throw PhoneUnavailable("Calendar provider unavailable")
    }
    private fun calendarWrite(backend: String, expires: Long, action: String, p: JSONObject): JSONObject {
        val fields = setOf("calendarId", "title", "start", "end", "timeZone", "allDay", "description", "location")
        keys(p, when (action) { "calendar_create" -> fields; "calendar_update" -> fields + "eventId"; else -> setOf("calendarId", "eventId") })
        val calendar = numericId(p, "calendarId"); writableCalendar(calendar)
        val event = if (action != "calendar_create") numericId(p, "eventId") else null
        val resolver = context.contentResolver
        val recurrence = PhoneToolsPolicy.recurrenceColumns
        val selection = "_id=? AND calendar_id=? AND deleted=0"
        var args = if (event != null) arrayOf(event, calendar) else emptyArray<String>()
        // Read the scoped event BEFORE validation: omitted allDay must retain its real semantics.
        val existingAllDay = if (event != null) {
            resolver.query(CalendarContract.Events.CONTENT_URI, (recurrence + "allDay").toTypedArray(), selection, args, null)?.use { c ->
                require(c.moveToFirst()) { "Event not found in the specified calendar" }
                require(!PhoneToolsPolicy.recurring(recurrence.indices.map { if (c.isNull(it)) null else c.getString(it) })) {
                    "Recurring series and their exceptions cannot be changed by this API; only non-recurring events are supported"
                }
                c.getInt(recurrence.size) != 0
            } ?: throw PhoneUnavailable("Calendar provider unavailable")
        } else null
        val values = ContentValues()
        if (action != "calendar_delete") {
            val title = string(p, "title", 500); val start = PhoneToolsPolicy.date(string(p, "start", 64)); val end = PhoneToolsPolicy.date(string(p, "end", 64))
            val zone = string(p, "timeZone", 200)
            val optional = PhoneToolsPolicy.eventOptionalFields(existingAllDay,
                if (p.has("allDay")) bool(p, "allDay") else null,
                if (p.has("description")) string(p, "description", 10000, true) else null,
                if (p.has("location")) string(p, "location", 2000, true) else null)
            PhoneToolsPolicy.eventDates(start, end, zone, optional.allDay)
            values.put("calendar_id", calendar.toLong()); values.put("title", title); values.put("dtstart", start.millis); values.put("dtend", end.millis)
            values.put("eventTimezone", zone); values.put("eventEndTimezone", zone); values.putNull("duration")
            // Omitted update fields never enter ContentValues; explicit empty strings clear text.
            optional.write({ column, value -> values.put(column, value) }, { value -> values.put("allDay", value) })
        }
        if (event == null) {
            guard(backend, expires)
            val inserted = resolver.insert(CalendarContract.Events.CONTENT_URI, values) ?: throw IllegalStateException("Calendar provider did not confirm insertion")
            return result("ok", JSONObject().put("eventId", ContentUris.parseId(inserted).toString()).put("calendarId", calendar).put("matchedRows", 1).put("scope", "single_non_recurring_event"))
        }
        // Repeat recurrence predicates in the write to avoid changing a concurrently converted series.
        var safeSelection = selection + recurrence.joinToString("") { " AND ($it IS NULL OR $it='')" }
        if (action == "calendar_update" && !p.has("allDay")) {
            // If another app changed allDay after the read, do not apply dates validated for stale semantics.
            safeSelection += " AND allDay=?"
            args += if (existingAllDay == true) "1" else "0"
        }
        guard(backend, expires)
        val rows = if (action == "calendar_delete") resolver.delete(CalendarContract.Events.CONTENT_URI, safeSelection, args)
            else resolver.update(CalendarContract.Events.CONTENT_URI, values, safeSelection, args)
        return result("ok", JSONObject().put("eventId", event).put("calendarId", calendar).put("matchedRows", rows).put("scope", "single_non_recurring_event"), if (rows == 0) "The event changed or no matching non-recurring event remained; nothing changed" else null)
    }
    private fun contacts(p: JSONObject): JSONObject {
        keys(p, setOf("query", "limit", "offset")); permission(Manifest.permission.READ_CONTACTS)
        val query = string(p, "query", 500, true); val limit = limit(p, 100); val offset = offset(p)
        val uri = if (query.isEmpty()) ContactsContract.Contacts.CONTENT_URI else Uri.withAppendedPath(ContactsContract.Contacts.CONTENT_FILTER_URI, Uri.encode(query))
        val data = context.contentResolver.query(uri, arrayOf("_id", "display_name"), null, null, "sort_key ASC, _id ASC")?.use { c ->
            page(c, offset, limit) { row ->
                val id = row.getString(0); val phones = JSONArray(); val emails = JSONArray(); var truncated = false
                context.contentResolver.query(ContactsContract.Data.CONTENT_URI, arrayOf("mimetype", "data1"), "contact_id=? AND (mimetype=? OR mimetype=?)", arrayOf(id, ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE, ContactsContract.CommonDataKinds.Email.CONTENT_ITEM_TYPE), "_id ASC")?.use { details ->
                    while (details.moveToNext()) {
                        val target = if (details.getString(0) == ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE) phones else emails
                        if (target.length() < 20) { val text = details.text("data1", 200); target.put(text); if ((details.getString(1)?.length ?: 0) > 200) truncated = true }
                        else truncated = true
                        if (phones.length() >= 20 && emails.length() >= 20) { if (details.moveToNext()) truncated = true; break }
                    }
                }
                JSONObject().put("contactId", id).put("name", row.text("display_name", 500)).put("phones", phones).put("emails", emails).put("detailsTruncated", truncated)
            }
        } ?: throw PhoneUnavailable("Contacts provider unavailable")
        return result("ok", data.put("textFieldsMayBeTruncated", true))
    }
    private fun apps(p: JSONObject): JSONObject {
        keys(p, setOf("limit", "offset")); val limit = limit(p, 100); val offset = offset(p)
        val all = launcherApps(); val items = JSONArray(); var index = offset.coerceAtMost(all.size); var bytes = 0
        while (index < all.size && items.length() < limit) {
            val app = all[index]
            val item = JSONObject().put("packageName", app.activityInfo.packageName).put("label", app.loadLabel(context.packageManager).toString().take(500))
            val size = item.toString().toByteArray(Charsets.UTF_8).size
            if (bytes + size > 56000) break
            items.put(item); bytes += size + 1; index++
        }
        return result("ok", JSONObject().put("items", items).put("offset", offset).put("complete", index >= all.size).apply { if (index < all.size) put("nextOffset", index) })
    }
}
