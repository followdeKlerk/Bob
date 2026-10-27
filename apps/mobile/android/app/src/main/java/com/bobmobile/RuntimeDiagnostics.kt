package com.bobmobile

import android.app.ActivityManager
import android.content.Context
import android.os.Debug
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject

/** Bounded owner-exported metadata; no network, raw exception text or snapshot payloads. */
internal object RuntimeDiagnostics {
    private var lastSample = Long.MIN_VALUE
    private var lastPressure = Long.MIN_VALUE
    private val diagnosticSessionStarted = System.currentTimeMillis()
    private fun prefs(context: Context) = context.getSharedPreferences("runtime-diagnostics-v1", Context.MODE_PRIVATE)
    private fun read(context: Context, key: String, limit: Int): JSONArray {
        val raw = prefs(context).getString(key, "[]") ?: "[]"
        if (raw.length > 65536) return JSONArray()
        val all = JSONArray(raw)
        return JSONArray().apply { for (i in maxOf(0, all.length() - limit) until all.length()) all.optJSONObject(i)?.let { put(it) } }
    }
    private fun append(context: Context, key: String, value: JSONObject, limit: Int, sync: Boolean = false) {
        val previous = read(context, key, limit - 1)
        previous.put(value)
        val edit = prefs(context).edit().putString(key, previous.toString())
        if (sync) edit.commit() else edit.apply()
    }
    private fun memory(context: Context, kind: String): JSONObject {
        val runtime = Runtime.getRuntime()
        val info = ActivityManager.MemoryInfo()
        (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(info)
        return JSONObject().put("time", System.currentTimeMillis()).put("versionCode", BuildConfig.VERSION_CODE)
            .put("diagnosticSessionStarted", diagnosticSessionStarted).put("kind", kind)
            .put("javaUsedKb", (runtime.totalMemory() - runtime.freeMemory()) / 1024)
            .put("javaMaxKb", runtime.maxMemory() / 1024)
            .put("nativeAllocatedKb", Debug.getNativeHeapAllocatedSize() / 1024)
            .put("systemAvailableKb", info.availMem / 1024).put("systemLowMemory", info.lowMemory)
    }
    @Synchronized fun sample(context: Context, raw: JSONObject) {
        try {
            val now = SystemClock.elapsedRealtime()
            if (lastSample != Long.MIN_VALUE && now - lastSample < 9000) return
            val values = JSONObject()
            for ((key, bound) in mapOf("updates" to 1_000_000L, "lastChars" to 100_000_000L, "maxChars" to 100_000_000L, "maxCallbackMs" to 600_000L, "loadedEntries" to 1_000_000L)) {
                val value = DiagnosticPolicy.number(raw.optDouble(key, Double.NaN), bound) ?: return
                values.put(key, value)
            }
            val sample = memory(context, "sample").put("stream", values)
            lastSample = now
            append(context, "samples", sample, DiagnosticPolicy.SAMPLE_LIMIT)
        } catch (_: Throwable) { /* Diagnostic allocation failure is never fatal. */ }
    }
    @Synchronized fun pressure(context: Context, level: Int) {
        try {
            val now = SystemClock.elapsedRealtime()
            if (lastPressure != Long.MIN_VALUE && now - lastPressure < 1000) return
            lastPressure = now
            append(context, "pressure", memory(context, if (level == 100) "low-memory" else "trim").put("trimLevel", level.coerceIn(0, 100)), DiagnosticPolicy.CRITICAL_LIMIT)
        } catch (_: Throwable) {}
    }
    @Synchronized fun fault(context: Context, input: String): Boolean {
        try {
            if (input.length > 4096) return false
            val raw = JSONObject(input)
            val source = raw.optString("source"); val type = raw.optString("type")
            if (source !in DiagnosticPolicy.sources || type !in DiagnosticPolicy.types || raw.opt("fatal") !is Boolean) return false
            val frames = JSONArray(); val inputFrames = raw.optJSONArray("frames") ?: return false
            for (i in 0 until minOf(inputFrames.length(), 16)) {
                val frame = inputFrames.optJSONObject(i) ?: continue
                val line = DiagnosticPolicy.number(frame.optDouble("line", Double.NaN), 10_000_000) ?: continue
                val column = DiagnosticPolicy.number(frame.optDouble("column", Double.NaN), 100_000_000) ?: continue
                if (DiagnosticPolicy.coordinate(line, column)) frames.put(JSONObject().put("line", line).put("column", column))
            }
            // Reconstruct the allowlist; never retain unknown keys from JS.
            val record = JSONObject().put("time", System.currentTimeMillis()).put("versionCode", BuildConfig.VERSION_CODE)
                .put("diagnosticSessionStarted", diagnosticSessionStarted).put("source", source).put("type", type)
                .put("fatal", raw.getBoolean("fatal")).put("frames", frames)
            try { record.put("memory", memory(context, "js-fault")) } catch (_: Throwable) {}
            append(context, "jsFaults", record, DiagnosticPolicy.FAULT_LIMIT, true)
            return true
        } catch (_: Throwable) { return false }
    }
    @Synchronized fun report(context: Context): JSONObject = try {
        JSONObject().put("samples", read(context, "samples", DiagnosticPolicy.SAMPLE_LIMIT))
            .put("pressure", read(context, "pressure", DiagnosticPolicy.CRITICAL_LIMIT))
            .put("jsFaults", read(context, "jsFaults", DiagnosticPolicy.FAULT_LIMIT))
            .put("memoryCoverage", "Java heap and native allocator; not total RSS or a dedicated JavaScript heap measurement")
            .put("streamCoverage", "UTF-16 snapshot lengths; callback time excludes later React rendering; loaded entries include parent and child views")
    } catch (_: Throwable) { JSONObject().put("unavailable", true) }
}
