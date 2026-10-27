package com.bobmobile

import java.util.Collections
import java.util.IdentityHashMap
import java.util.concurrent.atomic.AtomicBoolean

internal data class CrashCodeFrame(val owner: String, val method: String, val line: Int)
internal data class CrashCause(val type: String, val frames: List<CrashCodeFrame>)
internal data class CrashFingerprint(val time: Long, val versionCode: Int, val mainThread: Boolean, val causes: List<CrashCause>)

/** Code identifiers only. Never access Throwable.message, toString(), printStackTrace(),
 * thread names, StackTraceElement.fileName, class-loader names, or module names. */
internal object CrashFingerprints {
    const val MAX_RECORDS = 3
    const val MAX_CAUSES = 4
    const val MAX_FRAMES = 24 // total across all causes of one crash
    const val MAX_CHARS = 49152
    private val prefixes = listOf(
        "com.bobmobile.", "com.facebook.", "com.swmansion.", "com.horcrux.",
        "com.reactnativecommunity.", "com.oblador.", "com.th3rdwave.", "com.google.",
        "java.", "javax.", "android.", "androidx.", "kotlin.", "kotlinx.",
        "okhttp3.", "okio.", "org.json.", "org.chromium."
    )
    private val classPattern = Regex("[A-Za-z_$][A-Za-z0-9_$]*(?:\\.[A-Za-z_$][A-Za-z0-9_$]*)+")
    private val methodPattern = Regex("(?:[A-Za-z_$][A-Za-z0-9_$]*|<init>|<clinit>)")
    fun codeClass(value: String): Boolean = value.length <= 160 && prefixes.any { value.startsWith(it) } && classPattern.matches(value)
    fun codeMethod(value: String): Boolean = value.length <= 96 && methodPattern.matches(value)
    private fun type(value: String) = if (codeClass(value)) value else "other"
    private fun frame(value: CrashCodeFrame): Boolean = codeClass(value.owner) && codeMethod(value.method) && value.line in -2..1000000

    fun capture(error: Throwable, time: Long, versionCode: Int, mainThread: Boolean): CrashFingerprint {
        val seen = Collections.newSetFromMap(IdentityHashMap<Throwable, Boolean>())
        val causes = mutableListOf<CrashCause>()
        var current: Throwable? = error
        var remaining = MAX_FRAMES
        while (current != null && causes.size < MAX_CAUSES && seen.add(current)) {
            val frames = current.stackTrace.take(64).mapNotNull {
                val candidate = CrashCodeFrame(it.className, it.methodName, it.lineNumber)
                if (frame(candidate)) candidate else null
            }.take(remaining)
            remaining -= frames.size
            causes.add(CrashCause(type(current.javaClass.name), frames))
            current = current.cause
        }
        return CrashFingerprint(time, versionCode, mainThread, causes)
    }

    /** Preserve Android/React Native's existing termination path, even if recording fails.
     * One bounded best-effort capture per installed handler; concurrent crashes still delegate. */
    fun handler(previous: Thread.UncaughtExceptionHandler, save: (Thread, Throwable) -> Unit): Thread.UncaughtExceptionHandler {
        val recording = AtomicBoolean(false)
        return Thread.UncaughtExceptionHandler { thread, error ->
            try {
                if (recording.compareAndSet(false, true)) save(thread, error)
            } catch (_: Throwable) { /* Never replace or mask the original fatal exception. */ }
            finally { previous.uncaughtException(thread, error) }
        }
    }

    /** Tiny strict local format, not a raw stack trace. Also sanitizes values on disk reads. */
    fun encode(records: List<CrashFingerprint>): String = buildString {
        for (record in records.takeLast(MAX_RECORDS)) {
            if (record.time <= 0 || record.versionCode <= 0) continue
            append("C\t${record.time}\t${record.versionCode}\t${if (record.mainThread) 1 else 0}\n")
            var remaining = MAX_FRAMES
            for (cause in record.causes.take(MAX_CAUSES)) {
                append("E\t${type(cause.type)}\n")
                for (code in cause.frames.filter(::frame).take(remaining)) {
                    append("F\t${code.owner}\t${code.method}\t${code.line}\n")
                    remaining--
                }
            }
        }
    }
    fun decode(raw: String): List<CrashFingerprint> {
        if (raw.length > MAX_CHARS) return emptyList()
        val records = mutableListOf<CrashFingerprint>()
        var current: CrashFingerprint? = null
        var acceptFrames = false
        fun finish() {
            current?.let { records.add(it) }
            while (records.size > MAX_RECORDS) records.removeAt(0)
        }
        for (line in raw.lineSequence()) {
            if (line.length > 512) return emptyList()
            val fields = line.split('\t')
            when (fields.firstOrNull()) {
                "C" -> {
                    finish(); current = null; acceptFrames = false
                    if (fields.size != 4) continue
                    val time = fields[1].toLongOrNull() ?: continue
                    val version = fields[2].toIntOrNull() ?: continue
                    if (time > 0 && version > 0 && fields[3] in listOf("0", "1")) current = CrashFingerprint(time, version, fields[3] == "1", emptyList())
                }
                "E" -> {
                    val record = current ?: continue
                    acceptFrames = fields.size == 2 && record.causes.size < MAX_CAUSES
                    if (acceptFrames) current = record.copy(causes = record.causes + CrashCause(type(fields[1]), emptyList()))
                }
                "F" -> {
                    val record = current ?: continue
                    if (!acceptFrames || fields.size != 4 || record.causes.isEmpty() || record.causes.sumOf { it.frames.size } >= MAX_FRAMES) continue
                    val number = fields[3].toIntOrNull() ?: continue
                    val code = CrashCodeFrame(fields[1], fields[2], number)
                    if (!frame(code)) continue
                    val last = record.causes.last()
                    current = record.copy(causes = record.causes.dropLast(1) + last.copy(frames = last.frames + code))
                }
            }
        }
        finish()
        return records
    }
}
