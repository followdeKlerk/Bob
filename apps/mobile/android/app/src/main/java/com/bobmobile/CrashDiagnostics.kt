package com.bobmobile

import android.content.Context
import android.os.Looper
import android.util.AtomicFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** App-private, bounded code fingerprints. No network upload or external-storage export. */
internal object CrashDiagnostics {
    private var installed = false
    @Volatile private var captureHandler: Thread.UncaughtExceptionHandler? = null
    fun handlerActive(): Boolean = captureHandler?.let { Thread.getDefaultUncaughtExceptionHandler() === it } ?: false
    private fun file(context: Context) = AtomicFile(File(context.noBackupFilesDir, "crash-code-fingerprints-v1"))
    @Synchronized private fun read(context: Context): List<CrashFingerprint> = try {
        file(context).openRead().use { input ->
            val bytes = ByteArray(CrashFingerprints.MAX_CHARS + 1)
            var used = 0
            while (used < bytes.size) {
                val count = input.read(bytes, used, bytes.size - used)
                if (count < 0) break
                if (count == 0) break
                used += count
            }
            if (used > CrashFingerprints.MAX_CHARS) emptyList() else CrashFingerprints.decode(String(bytes, 0, used, Charsets.UTF_8))
        }
    } catch (_: Exception) { emptyList() }

    @Synchronized private fun save(context: Context, record: CrashFingerprint) {
        val bytes = CrashFingerprints.encode((read(context) + record).takeLast(CrashFingerprints.MAX_RECORDS)).toByteArray(Charsets.UTF_8)
        if (bytes.size > CrashFingerprints.MAX_CHARS) return
        val target = file(context)
        val stream = target.startWrite()
        try { stream.write(bytes); target.finishWrite(stream) }
        catch (failure: Throwable) { target.failWrite(stream); throw failure }
    }
    @Synchronized fun install(context: Context) {
        if (installed) return
        val previous = Thread.getDefaultUncaughtExceptionHandler() ?: return
        val app = context.applicationContext
        val mainThread = Looper.getMainLooper().thread
        val handler = CrashFingerprints.handler(previous) { thread, error ->
            save(app, CrashFingerprints.capture(error, System.currentTimeMillis(), BuildConfig.VERSION_CODE, thread === mainThread))
        }
        Thread.setDefaultUncaughtExceptionHandler(handler)
        captureHandler = handler
        installed = true
    }
    fun report(context: Context): JSONArray = JSONArray().apply {
        read(context).forEach { record ->
            put(JSONObject().put("time", record.time).put("versionCode", record.versionCode)
                .put("thread", if (record.mainThread) "main" else "background")
                .put("causes", JSONArray().apply {
                    record.causes.forEach { cause ->
                        put(JSONObject().put("type", cause.type).put("frames", JSONArray().apply {
                            cause.frames.forEach { code ->
                                put(JSONObject().put("class", code.owner).put("method", code.method).put("line", code.line))
                            }
                        }))
                    }
                }))
        }
    }
}
