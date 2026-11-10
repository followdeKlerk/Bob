package com.bobmobile

import android.os.Build
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import java.io.File

internal data class BobTerminalConfig(val host: String, val port: Int, val key: String,
    val backendId: String, val conversationId: String, val sessionId: String, val title: String, val cwd: String) {
    fun validate() {
        // mosh-client accepts a numeric address, not a hostname. No shell is used.
        require(host.length in 2..64 && (host.matches(Regex("[0-9.]+")) ||
            (host.contains(':') && host.matches(Regex("[0-9a-fA-F:]+"))))) { "Mosh requires a numeric IPv4/IPv6 address" }
        require(port in 1..65535) { "Invalid Mosh UDP port" }
        require(key.matches(Regex("[A-Za-z0-9+/]{22}"))) { "Invalid Mosh session key" }
        require(listOf(backendId, conversationId, sessionId).all { it.isNotBlank() && it.length <= 256 }) { "Missing session identity" }
        require(title.length <= 256 && cwd.length <= 4096) { "Terminal metadata too long" }
    }
    companion object {
        fun conversationIdentity(value: Double): String {
            require(value.isFinite() && value > 0 && value <= 9007199254740991.0 && value == value.toLong().toDouble()) { "Invalid conversation identity" }
            return value.toLong().toString()
        }
    }
    // Do not accidentally include the credential in diagnostics.
    override fun toString() = "BobTerminalConfig(redacted)"
}

internal object BobTerminalPrepared {
    val sessions = PreparedTerminalSessions { android.os.SystemClock.elapsedRealtime() }
}

internal class BobTerminalModule(private val app: ReactApplicationContext) : ReactContextBaseJavaModule(app) {
    override fun getName() = "BobTerminal"
    private fun unavailable(): String? = when {
        Build.VERSION.SDK_INT < 26 -> "Native Mosh requires Android 8 or newer (locale API)"
        Build.SUPPORTED_ABIS.firstOrNull() != "arm64-v8a" -> "The Mosh prototype currently supports arm64 Android only"
        !File(app.applicationInfo.nativeLibraryDir, "libbob_mosh.so").canExecute() -> "Native Mosh is not packaged/extracted in this build"
        !File(app.applicationInfo.nativeLibraryDir, "libbob_terminal_pty.so").isFile -> "Native terminal PTY adapter is missing"
        else -> null
    }
    @ReactMethod fun capabilities(promise: Promise) {
        val reason = unavailable()
        promise.resolve(Arguments.createMap().apply { putBoolean("available", reason == null); if (reason != null) putString("reason", reason) })
    }
    @ReactMethod fun prepare(config: ReadableMap, promise: Promise) {
        var handle: String? = null
        try {
            unavailable()?.let { throw IllegalStateException(it) }
            fun required(name: String) = config.getString(name) ?: throw IllegalArgumentException("Missing $name")
            val rawPort = config.getDouble("port")
            require(rawPort.isFinite() && rawPort == rawPort.toInt().toDouble()) { "Invalid UDP port" }
            val conversationId = BobTerminalConfig.conversationIdentity(config.getDouble("conversationId"))
            val value = BobTerminalConfig(required("host"), rawPort.toInt(), required("key"), required("backendId"),
                conversationId, required("sessionId"), config.getString("title") ?: "Terminal", config.getString("cwd") ?: "")
            value.validate()
            handle = BobTerminalPrepared.sessions.put(value)
            val prepared = handle
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({ BobTerminalPrepared.sessions.remove(prepared) }, 15_000)
            promise.resolve(prepared)
        } catch (error: Exception) {
            handle?.let(BobTerminalPrepared.sessions::remove)
            // Do not forward exception details from native preparation/ReadableMap: never risk logging a key.
            promise.reject("TERMINAL_UNAVAILABLE", "Cannot prepare the native terminal. Verify arm64 Mosh packaging and connection parameters.")
        }
    }
    @ReactMethod fun releasePrepared(handle: String, promise: Promise) {
        BobTerminalPrepared.sessions.remove(handle)
        promise.resolve(null)
    }
}

class BobTerminalPackage : ReactPackage {
    @Suppress("OVERRIDE_DEPRECATION")
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = listOf(BobTerminalModule(reactContext))
    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = listOf(BobTerminalViewManager())
}

internal object BobTerminalPty {
    init { System.loadLibrary("bob_terminal_pty") }
    external fun spawn(executable: String, host: String, port: Int, key: String): IntArray
    external fun resize(fd: Int, cols: Int, rows: Int)
    external fun stop(pid: Int)
    external fun waitFor(pid: Int): Int
}
