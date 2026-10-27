package com.bobmobile

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject

/** On-device, bounded lifecycle metadata. No chat text, error messages, tokens,
 * URLs, raw stack traces, location, device IDs or automatic network reporting.
 * Schema 3 adds bounded memory/workload samples and sanitized JavaScript code positions. */
internal object AppDiagnostics {
    data class Event(val time: Long, val name: String)
    private val allowed = setOf(
        "activity.create", "activity.resume", "activity.pause", "activity.stop", "activity.destroy",
        "activity.user-leave", "activity.focus-gained", "activity.focus-lost", "activity.back",
        "activity.back-no-js-ignored", "activity.default-back-ignored",
        "js.ready", "js.active", "js.background", "js.inactive", "js.unknown", "js.extension",
        "back.ui", "back.keyboard", "back.root-ignored"
    )
    fun allowedEvent(name: String) = name in allowed
    fun append(events: List<Event>, event: Event): List<Event> =
        if (allowedEvent(event.name)) (events + event).takeLast(64) else events.takeLast(64)
    fun reason(code: Int): String = when (code) {
        1 -> "self_exit"; 2 -> "signal"; 3 -> "low_memory"; 4 -> "java_crash"; 5 -> "native_crash"
        6 -> "not_responding"; 7 -> "initialization_failure"; 8 -> "permission_change"
        9 -> "excessive_resource_usage"; 10 -> "user_requested"; 11 -> "user_stopped"
        12 -> "dependency_died"; 13 -> "other_system_kill"; 14 -> "freezer"
        15 -> "package_state_change"; 16 -> "package_updated"; else -> "unknown"
    }
    private fun read(context: Context): List<Event> = try {
        val raw = JSONArray(context.getSharedPreferences("app-diagnostics", Context.MODE_PRIVATE).getString("events", "[]"))
        (maxOf(0, raw.length() - 64) until raw.length()).mapNotNull { index ->
            val value = raw.optJSONObject(index) ?: return@mapNotNull null
            val name = value.optString("event")
            if (allowedEvent(name)) Event(value.optLong("time"), name) else null
        }
    } catch (_: Exception) { emptyList() }
    private fun json(events: List<Event>) = JSONArray().apply {
        events.forEach { put(JSONObject().put("time", it.time).put("event", it.name)) }
    }
    @Synchronized fun record(context: Context, name: String) {
        if (!allowedEvent(name)) return
        try {
            val events = append(read(context), Event(System.currentTimeMillis(), name))
            context.getSharedPreferences("app-diagnostics", Context.MODE_PRIVATE).edit().putString("events", json(events).toString()).apply()
        } catch (_: Exception) { /* Recording must never crash the app. */ }
    }
    fun report(context: Context): String {
        val report = JSONObject().put("schema", 3).put("collectedAt", System.currentTimeMillis())
            .put("versionName", BuildConfig.VERSION_NAME).put("versionCode", BuildConfig.VERSION_CODE)
            .put("androidSdk", Build.VERSION.SDK_INT).put("deviceModel", Build.MODEL)
            .put("events", json(read(context)))
            .put("crashCapture", "code_only_best_effort")
            .put("crashCaptureHandlerActive", CrashDiagnostics.handlerActive())
            .put("crashes", CrashDiagnostics.report(context))
            .put("runtime", RuntimeDiagnostics.report(context))
        val exits = JSONArray()
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
                manager.getHistoricalProcessExitReasons(context.packageName, 0, 20).filter { it.processName == context.packageName }.take(5).forEach { info ->
                    exits.put(JSONObject().put("time", info.timestamp).put("reason", reason(info.reason))
                        .put("reasonCode", info.reason).put("status", info.status).put("importance", info.importance)
                        .put("pssKb", info.pss).put("rssKb", info.rss))
                }
                report.put("systemExitHistory", "available")
            } catch (_: Exception) { report.put("systemExitHistory", "unavailable") }
        } else report.put("systemExitHistory", "requires_android_11")
        return report.put("exits", exits).toString(2)
    }
}
