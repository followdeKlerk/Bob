package com.bobmobile

import android.content.Context
import android.os.Build

internal data class AppVersion(val name: String, val code: Int)

/** Package replacement restarts the process. Cache only successful lookups, never
 * an old compile-time version or a failed PackageManager read. */
internal class InstalledVersionCache {
    @Volatile private var cached: AppVersion? = null
    // No lock, package query or loader call: safe even in a fatal handler.
    fun peek(): AppVersion = cached ?: AppVersion("unavailable", 0)
    @Synchronized fun get(load: () -> AppVersion): AppVersion {
        cached?.let { return it }
        return try {
            val value = load()
            require(value.code > 0)
            value.also { cached = it }
        } catch (_: Exception) { AppVersion("unavailable", 0) }
    }
}

internal object InstalledAppVersion {
    private val cache = InstalledVersionCache()
    fun cached(): AppVersion = cache.peek()
    @Suppress("DEPRECATION")
    fun get(context: Context): AppVersion = cache.get {
        // Kotlin consumers can retain inlined BuildConfig.VERSION_* values across
        // incremental version bumps. The installed manifest is the authority.
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        val code = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
        require(code in 1..Int.MAX_VALUE.toLong())
        val name = info.versionName?.takeIf { it.matches(Regex("[0-9A-Za-z._+-]{1,80}")) } ?: "unavailable"
        AppVersion(name, code.toInt())
    }
}
