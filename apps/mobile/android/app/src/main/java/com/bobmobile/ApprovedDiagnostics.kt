package com.bobmobile

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject

/** Metadata-only local ring. No HTML, surface data, IDs, text, URLs or tokens.
 * A report is assembled only by the explicit in-chat approval action. */
internal object ApprovedDiagnostics {
    private val names = setOf("mount", "resize", "fallback-overflow", "fallback-timeout", "dispose")
    @Synchronized fun record(context: Context, event: String, width: Int, height: Int, requested: Int = 0) {
        if (event !in names) return
        try {
            val preferences = context.getSharedPreferences("inline-diagnostics", Context.MODE_PRIVATE)
            val old = JSONArray(preferences.getString("events", "[]")); val next = JSONArray()
            for (index in maxOf(0, old.length() - 63) until old.length()) next.put(old.getJSONObject(index))
            next.put(JSONObject().put("time", System.currentTimeMillis()).put("event", event)
                .put("width", width.coerceIn(0, 100000)).put("height", height.coerceIn(0, 100000)).put("requestedHeight", requested.coerceIn(0, 420)))
            preferences.edit().putString("events", next.toString()).apply()
        } catch (_: Exception) { /* Diagnostics must never break a widget. */ }
    }
    @Synchronized fun report(context: Context): String {
        val events = JSONArray()
        val allowed = setOf("activity.create", "activity.resume", "activity.pause", "activity.stop", "activity.destroy", "activity.user-leave", "activity.focus-gained", "activity.focus-lost", "activity.back", "activity.back-no-js-ignored", "activity.default-back-ignored", "js.ready", "js.active", "js.background", "js.inactive", "js.unknown", "js.extension", "back.ui", "back.keyboard", "back.root-ignored")
        val localEvents = JSONArray(context.getSharedPreferences("app-diagnostics", Context.MODE_PRIVATE).getString("events", "[]"))
        for (index in maxOf(0, localEvents.length() - 64) until localEvents.length()) {
            val event = localEvents.optJSONObject(index) ?: continue
            if (event.optString("event") in allowed && event.optLong("time") > 0) events.put(JSONObject().put("time", event.getLong("time")).put("event", event.getString("event")))
        }
        val exits = JSONArray()
        if (Build.VERSION.SDK_INT >= 30) try {
            val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            manager.getHistoricalProcessExitReasons(context.packageName, 0, 20).filter { it.processName == context.packageName }.take(5).forEach { info ->
                exits.put(JSONObject().put("time", info.timestamp).put("reasonCode", info.reason).put("status", info.status)
                    .put("importance", info.importance).put("pssKb", info.pss).put("rssKb", info.rss))
            }
        } catch (_: Exception) { /* Missing exit history does not prevent sharing local events. */ }
        val webVersion = if (Build.VERSION.SDK_INT >= 26) WebView.getCurrentWebViewPackage()?.versionName else null
        return JSONObject().put("schema", 1).put("collectedAt", System.currentTimeMillis())
            .put("versionName", BuildConfig.VERSION_NAME).put("versionCode", BuildConfig.VERSION_CODE).put("androidSdk", Build.VERSION.SDK_INT)
            .put("webViewVersion", webVersion?.takeIf { it.matches(Regex("[0-9A-Za-z._+-]{1,80}")) } ?: "unavailable")
            .put("events", events).put("exits", exits)
            .put("inline", JSONArray(context.getSharedPreferences("inline-diagnostics", Context.MODE_PRIVATE).getString("events", "[]"))).toString()
    }
}
