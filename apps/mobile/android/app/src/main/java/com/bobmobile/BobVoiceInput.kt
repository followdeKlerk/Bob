package com.bobmobile

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.common.LifecycleState
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.ViewManager

/** User-started, bounded native recognition. No recorder, files, transcript logs or server transport. */
class BobVoiceInput(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context), LifecycleEventListener {
    private val main = Handler(Looper.getMainLooper())
    private val policy = VoiceInputPolicy()
    private var recognizer: SpeechRecognizer? = null
    private var foreground = context.lifecycleState == LifecycleState.RESUMED
    private var invalidated = false
    private var listenTimeout: Runnable? = null
    private var finalTimeout: Runnable? = null
    init { context.addLifecycleEventListener(this) }
    override fun getName() = "BobVoiceInput"
    @ReactMethod fun addListener(name: String) {}
    @ReactMethod fun removeListeners(count: Double) {}
    private fun onDevice() = Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
    private fun platform() = SpeechRecognizer.isRecognitionAvailable(context)
    @ReactMethod fun availability(promise: Promise) { main.post {
        try { promise.resolve(VoiceInputPolicy.mode(onDevice(), platform())) }
        catch (_: Exception) { promise.resolve("unavailable") }
    } }
    private fun event(id: String, state: String, text: String? = null, message: String? = null) {
        if (!context.hasActiveReactInstance()) return
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("BobVoiceInputState", Arguments.createMap().apply {
            putString("id", id); putString("state", state)
            if (text != null) putString("text", text)
            if (message != null) putString("message", message)
        })
    }
    private fun end(token: Long, state: String, text: String? = null, message: String? = null) {
        // Revoke before destroy: even synchronous/late callbacks are inert.
        val id = policy.end(token) ?: return
        listenTimeout?.let(main::removeCallbacks); listenTimeout = null
        finalTimeout?.let(main::removeCallbacks); finalTimeout = null
        val old = recognizer; recognizer = null
        try { old?.cancel() } catch (_: Exception) {}
        try { old?.destroy() } catch (_: Exception) {}
        event(id, state, text, message)
    }
    private var token = 0L
    private fun cancelCurrent() { end(token, "cancelled") }
    @ReactMethod fun start(id: String, mode: String, platformConsent: Boolean, promise: Promise) { main.post {
        if (invalidated || !foreground || context.currentActivity == null || context.lifecycleState != LifecycleState.RESUMED) {
            promise.reject("voice", "Open Bob in the foreground to dictate."); return@post
        }
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            promise.reject("voice", VoiceInputPolicy.error(9)); return@post
        }
        if (policy.id != null) { promise.reject("voice", VoiceInputPolicy.error(8)); return@post }
        try {
            if (!VoiceInputPolicy.permitted(mode, onDevice(), platform(), platformConsent)) {
                promise.reject("voice", "Speech recognition availability changed. Tap the mic again to review the available engine. No fallback was started."); return@post
            }
            token = policy.begin(id)
            val current = token
            val engine = if (mode == "onDevice" && Build.VERSION.SDK_INT >= 31) SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
                else SpeechRecognizer.createSpeechRecognizer(context)
            recognizer = engine
            engine.setRecognitionListener(object : RecognitionListener {
                private fun live() = policy.current(current) && foreground && !invalidated
                override fun onReadyForSpeech(params: Bundle?) { if (live()) event(id, "listening") }
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {} // Never retain raw audio.
                override fun onEndOfSpeech() { if (live()) finishCurrent(current, stop = false) }
                override fun onError(error: Int) { if (live()) end(current, "error", message = VoiceInputPolicy.error(error)) }
                override fun onResults(results: Bundle?) {
                    if (!live()) return
                    val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim()
                    if (text.isNullOrEmpty() || text.length > VoiceInputPolicy.MAX_TEXT) end(current, "error", message = "No usable speech was recognized. Tap the mic and try again.")
                    else end(current, "final", text = text)
                }
                override fun onPartialResults(partialResults: Bundle?) {} // A partial is never a final or a draft edit.
                override fun onEvent(eventType: Int, params: Bundle?) {}
            })
            // Even an engine that never reports ready/end/results cannot leave the microphone open.
            listenTimeout = Runnable { if (policy.current(current)) finishCurrent(current, stop = true) }.also { main.postDelayed(it, VoiceInputPolicy.LISTEN_MS) }
            engine.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false))
            // Admission is not readiness; the UI stays in cancellable setup until onReadyForSpeech.
            promise.resolve(null)
        } catch (_: Exception) {
            val message = "Android speech recognition could not start. Check your installed speech service or language model. No fallback was started."
            end(token, "error", message = message)
            promise.reject("voice", message)
        }
    } }
    private fun finishCurrent(current: Long, stop: Boolean) {
        if (!policy.finish(current)) return
        policy.id?.let { event(it, "finishing") }
        listenTimeout?.let(main::removeCallbacks); listenTimeout = null
        finalTimeout = Runnable { end(current, "error", message = "Dictation ended without a final result. Tap the mic and try again.") }
            .also { main.postDelayed(it, VoiceInputPolicy.FINISH_MS) }
        if (stop) try { recognizer?.stopListening() } catch (_: Exception) { end(current, "error", message = "Dictation was interrupted. Tap the mic to try again.") }
    }
    @ReactMethod fun finish(id: String, promise: Promise) { main.post {
        if (policy.id == id) finishCurrent(token, stop = true)
        promise.resolve(null)
    } }
    @ReactMethod fun cancel(id: String, promise: Promise) { main.post {
        if (policy.id == id) cancelCurrent()
        promise.resolve(null)
    } }
    override fun onHostResume() { foreground = true }
    override fun onHostPause() { foreground = false; main.post { cancelCurrent() } }
    override fun onHostDestroy() { foreground = false; main.post { cancelCurrent() } }
    override fun invalidate() {
        invalidated = true; foreground = false
        context.removeLifecycleEventListener(this)
        main.post { cancelCurrent() }
        super.invalidate()
    }
}
class BobVoiceInputPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(BobVoiceInput(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
