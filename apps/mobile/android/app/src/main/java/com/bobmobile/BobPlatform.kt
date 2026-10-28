package com.bobmobile

import android.app.Activity
import android.content.Intent
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import com.google.zxing.integration.android.IntentIntegrator
import com.facebook.react.modules.core.DeviceEventManagerModule

class BobPlatform(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    private val fullscreenListener = object : com.facebook.react.interfaces.ExtraWindowEventListener {
        override fun onExtraWindowCreate(window: android.view.Window) { BobFullscreen.attach(window) }
        override fun onExtraWindowDestroy(window: android.view.Window) { BobFullscreen.detach(window) }
    }
    private var scanPromise: Promise? = null
    private var notificationTarget: WritableMap? = null
    private fun target(intent: Intent?): WritableMap? {
        val raw = intent?.data ?: return null
        if (raw.scheme != "bob" || raw.query != null || raw.fragment != null) return null
        if (raw.authority == "updates" && raw.pathSegments.size == 1) return try {
            val identity = raw.pathSegments[0]; java.util.UUID.fromString(identity)
            intent.data = null
            Arguments.createMap().apply { putString("backendId", identity); putString("screen", "updates") }
        } catch (_: Exception) { null }
        if (raw.authority != "work" || raw.pathSegments.size != 2) return null
        return try {
            val identity = raw.pathSegments[0]; java.util.UUID.fromString(identity)
            val chat = raw.pathSegments[1].toLong(); require(chat in 1..9007199254740991L)
            intent.data = null
            Arguments.createMap().apply { putString("backendId", identity); putDouble("conversationId", chat.toDouble()) }
        } catch (_: Exception) { null }
    }
    init {
        context.addExtraWindowEventListener(fullscreenListener)
        context.addActivityEventListener(object : BaseActivityEventListener() {
            override fun onNewIntent(intent: Intent) {
                val selected = target(intent) ?: return
                synchronized(this@BobPlatform) { notificationTarget = selected }
                context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("BobNotificationOpen", null)
            }
            override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
                val result = IntentIntegrator.parseActivityResult(requestCode, resultCode, data) ?: return
                val pending = scanPromise ?: return
                scanPromise = null
                if (result.contents == null) pending.reject("cancelled", "QR scan cancelled")
                else pending.resolve(result.contents)
            }
        })
    }
    override fun invalidate() {
        context.removeExtraWindowEventListener(fullscreenListener)
        super.invalidate()
    }
    override fun getName() = "BobPlatform"
    override fun getConstants(): Map<String, Any> = mapOf("loopbackTesting" to BuildConfig.DEBUG)
    @ReactMethod fun recordDiagnosticEvent(event: String, promise: Promise) {
        AppDiagnostics.record(context, event)
        promise.resolve(null)
    }
    @ReactMethod(isBlockingSynchronousMethod = true)
    fun recordJsFault(payload: String): Boolean = RuntimeDiagnostics.fault(context, payload)
    @ReactMethod fun recordStreamSample(values: ReadableMap, promise: Promise) {
        try {
            val safe = org.json.JSONObject()
            for (key in listOf("updates", "lastChars", "maxChars", "maxCallbackMs", "loadedEntries")) {
                if (values.hasKey(key) && values.getType(key) == ReadableType.Number) safe.put(key, values.getDouble(key))
            }
            RuntimeDiagnostics.sample(context, safe)
        } catch (_: Throwable) {}
        promise.resolve(null)
    }
    @ReactMethod fun approvedDiagnostics(promise: Promise) {
        // Called only after the native chat consent control receives approval.
        try { promise.resolve(ApprovedDiagnostics.report(context)) }
        catch (_: Exception) { promise.reject("diagnostics", "Diagnostic capture unavailable") }
    }
    @ReactMethod fun appDiagnostics(promise: Promise) {
        Thread {
            try { promise.resolve(AppDiagnostics.report(context)) }
            catch (e: Exception) { promise.reject("diagnostics", "Unable to read app diagnostics", e) }
        }.start()
    }
    @ReactMethod fun copyText(text: String, promise: Promise) {
        try {
            val clipboard = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
            val clip = android.content.ClipData.newPlainText("Bob", text)
            // Do not expose conversation contents in Android's clipboard preview.
            if (android.os.Build.VERSION.SDK_INT >= 24) clip.description.extras = android.os.PersistableBundle().apply {
                putBoolean("android.content.extra.IS_SENSITIVE", true)
            }
            clipboard.setPrimaryClip(clip)
            promise.resolve(null)
        } catch (e: Exception) { promise.reject("clipboard", "Unable to copy content", e) }
    }
    @ReactMethod fun takeNotificationTarget(promise: Promise) {
        synchronized(this) {
            val selected = notificationTarget ?: target(context.currentActivity?.intent)
            notificationTarget = null
            promise.resolve(selected)
        }
    }
    @ReactMethod fun scanPairing(promise: Promise) {
        val activity = context.currentActivity
        if (activity == null || scanPromise != null) { promise.reject("unavailable", "Scanner unavailable"); return }
        scanPromise = promise
        activity.runOnUiThread {
            try {
                IntentIntegrator(activity).setDesiredBarcodeFormats(IntentIntegrator.QR_CODE)
                    .setCaptureActivity(BobCaptureActivity::class.java)
                    .setPrompt("Scan Bob's short-lived backend invitation")
                    .setBeepEnabled(false).setOrientationLocked(true).initiateScan()
            } catch (e: Exception) { scanPromise = null; promise.reject("scan", "Unable to open camera", e) }
        }
    }
}
class BobPlatformPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(BobPlatform(context), BobFiles(context), BobLocation(context), BobNotifications(context), BobInteractive(context), BobKeyboard(context), BobSpeech(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = listOf(BobInlineSurfaceManager())
}
