package com.bobmobile

// Recognition/provider/language/partial-result behavior extracted from Omalauncher Speech.kt (MIT).
// Copyright (c) 2026 Simon Schubert and contributors. See upstream/omalauncher/source/LICENSE.
// Bob adaptation: no launcher/Linux; explicit provider consent, one utterance, native admission/revocation.
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognitionSupport
import android.speech.RecognitionSupportCallback
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.common.LifecycleState
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.ViewManager

/** User-started, bounded native recognition. No recorder, files, transcript logs or server transport. */
class BobVoiceInput(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context), LifecycleEventListener, WindowFocusChangeListener {
    private val main = Handler(Looper.getMainLooper())
    private val policy = VoiceInputPolicy()
    private var recognizer: SpeechRecognizer? = null
    private var foreground = context.lifecycleState == LifecycleState.RESUMED
    private val admission = VoiceInputAdmission(foreground, context.currentActivity?.hasWindowFocus() == true)
    private var activeTicket: VoiceInputAdmission.Ticket? = null
    private var invalidated = false
    private var token = 0L
    private var listenTimeout: Runnable? = null
    private var finalTimeout: Runnable? = null
    private var supportTimeout: Runnable? = null
    private var pendingExternal: Pair<Long, String?>? = null
    init { context.addLifecycleEventListener(this); context.addWindowFocusChangeListener(this) }
    override fun getName() = "BobVoiceInput"
    @ReactMethod fun addListener(name: String) {}
    @ReactMethod fun removeListeners(count: Double) {}
    private fun windowFocused() = !invalidated && foreground && context.lifecycleState == LifecycleState.RESUMED && context.currentActivity?.let { !it.isFinishing && !it.isDestroyed && it.hasWindowFocus() } == true
    @ReactMethod fun windowFocused(promise: Promise) { main.post { promise.resolve(windowFocused()) } }
    @ReactMethod fun options(language: String?, promise: Promise) { main.post {
        try {
            val tag = language?.takeIf { VoiceLanguage.valid(it) } ?: if (language == null) null else throw IllegalArgumentException("Invalid speech language")
            promise.resolve(Arguments.createArray().apply { VoiceProviders.options(context, tag ?: java.util.Locale.getDefault().toLanguageTag()).forEach { plan -> pushMap(Arguments.createMap().apply {
            putString("mode", plan.mode); putString("key", plan.key); putString("label", plan.label); putString("language", plan.language); putBoolean("networkCapable", plan.networkCapable)
        }) } }) } catch (_: Exception) { promise.reject("voice", "Could not inspect Android speech providers. Check Android speech settings.") }
    } }
    @ReactMethod fun availability(promise: Promise) { main.post { promise.resolve(runCatching { VoiceProviders.options(context).firstOrNull()?.mode }.getOrNull() ?: "unavailable") } }
    private fun event(id: String, state: String, text: String? = null, message: String? = null, stopUnconfirmed: Boolean = false) {
        if (!context.hasActiveReactInstance()) return
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("BobVoiceInputState", Arguments.createMap().apply {
            putString("id", id); putString("state", state)
            if (text != null) putString("text", text)
            if (message != null) putString("message", message)
            putBoolean("stopUnconfirmed", stopUnconfirmed)
        })
    }
    private fun end(current: Long, state: String, text: String? = null, message: String? = null) {
        // Revoke before destroy: even synchronous/late callbacks are inert.
        val id = policy.end(current) ?: return
        activeTicket?.let(admission::release); activeTicket = null
        pendingExternal = null
        listenTimeout?.let(main::removeCallbacks); listenTimeout = null
        finalTimeout?.let(main::removeCallbacks); finalTimeout = null
        supportTimeout?.let(main::removeCallbacks); supportTimeout = null
        val old = recognizer; recognizer = null
        val cleaned = NativeVoiceCapture.retire(this) {
            VoiceActivityHandoff.cancel(id)
            try { old?.cancel() } catch (_: Exception) {}
            old?.destroy() // A throwing destroy is NOT confirmation that capture stopped.
            true
        }
        if (cleaned) event(id, state, text, message)
        else event(id, "error", message = "Microphone cleanup is unconfirmed. Try Stop again before speaking.", stopUnconfirmed = true)
    }
    private fun retire(ticket: VoiceInputAdmission.Ticket?) {
        if (ticket == null) return
        val cleanup = Runnable { if (activeTicket == ticket) end(token, "cancelled") }
        if (Looper.myLooper() == main.looper) cleanup.run() else main.post(cleanup)
    }
    // Compatibility entry for existing draft-dictation clients. Production clients pin the complete provider key.
    @ReactMethod fun start(id: String, mode: String, platformConsent: Boolean, promise: Promise) {
        val ticket = admission.claim(id)
        if (ticket == null) { promise.reject("voice", "Bob’s window is not focused or recognition is busy."); return }
        main.post {
            val plan = runCatching { VoiceProviders.options(context).firstOrNull { it.mode == mode } }.getOrNull()
            launch(ticket, plan, platformConsent, promise)
        }
    }
    @ReactMethod fun startConfigured(id: String, key: String, language: String, consent: Boolean, promise: Promise) {
        val ticket = admission.claim(id)
        if (ticket == null) { promise.reject("voice", "Bob’s window is not focused or recognition is busy."); return }
        main.post {
            val plan = runCatching { if (VoiceLanguage.valid(language)) VoiceProviders.options(context, language).firstOrNull { it.key == key && it.language == language } else null }.getOrNull()
            launch(ticket, plan, consent, promise)
        }
    }
    private fun launch(ticket: VoiceInputAdmission.Ticket, plan: VoiceProvider?, consent: Boolean, promise: Promise) {
        if (!admission.accepts(ticket) || !windowFocused()) {
            admission.release(ticket); promise.reject("voice", "Recognition was interrupted. Tap the microphone again."); return
        }
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            admission.release(ticket); promise.reject("voice", VoiceInputPolicy.error(9)); return
        }
        if (policy.id != null || plan == null || (plan.networkCapable && !consent)) {
            admission.release(ticket); promise.reject("voice", "Speech provider/configuration changed. Tap again to review it; no fallback was started."); return
        }
        // JS cleanup is not the security boundary. Retry all unresolved TTS leases, including retired modules.
        val cleaned = NativeSpeechEngineLease.stopForCapture()
        if (!cleaned || !NativeVoiceCapture.claim(this)) {
            admission.release(ticket)
            promise.reject("voice", "Audio cleanup is unconfirmed or another microphone session is active. Try Stop again before speaking.", null,
                Arguments.createMap().apply { putBoolean("stopUnconfirmed", !cleaned) })
            return
        }
        try {
            token = policy.begin(ticket.id); activeTicket = ticket
            val current = token
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, VoiceLanguage.requested(plan.language))
                .putExtra("com.google.recognition.extra.MUTE_AUDIO_BEEPS", true)
            if (plan.mode == "activity") {
                if (!admission.handoff(ticket)) { end(current, "cancelled"); promise.reject("voice", "Speech screen handoff was cancelled."); return }
                VoiceActivityHandoff.begin(VoiceActivityHandoff.Request(ticket.id, intent.setComponent(plan.component)) { heard ->
                    if (policy.current(current) && admission.ownsHandoff(ticket)) {
                        pendingExternal = current to heard
                        deliverExternal()
                    }
                })
                event(ticket.id, "external")
                listenTimeout = Runnable { end(current, "error", message = "Speech screen timed out. Return to Bob and tap again.") }.also { main.postDelayed(it, 60_000) }
                context.currentActivity!!.startActivity(Intent(context, BobVoiceRecognitionActivity::class.java).putExtra("voiceRequest", ticket.id))
                promise.resolve(null); return
            }
            val engine = if (plan.mode == "onDevice" && Build.VERSION.SDK_INT >= 31) SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
                else SpeechRecognizer.createSpeechRecognizer(context, plan.component)
            recognizer = engine
            fun live(): Boolean {
                if (!policy.current(current) || !admission.accepts(ticket)) return false
                if (!windowFocused()) { retire(admission.cancel(ticket.id)); return false }
                return true
            }
            engine.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {
                    if (!live()) return
                    listenTimeout?.let(main::removeCallbacks)
                    listenTimeout = Runnable { if (live()) finishCurrent(current, true) }.also { main.postDelayed(it, VoiceInputPolicy.LISTEN_MS) }
                    event(ticket.id, "listening")
                }
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {} // Never retain raw audio.
                override fun onEndOfSpeech() { if (live()) finishCurrent(current, false) }
                override fun onError(error: Int) { if (live()) end(current, "error", message = VoiceInputPolicy.error(error)) }
                override fun onResults(results: Bundle?) { if (live()) complete(current, results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()) }
                override fun onPartialResults(partialResults: Bundle?) {
                    if (live()) event(ticket.id, "partial", partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.take(VoiceInputPolicy.MAX_TEXT))
                }
                override fun onEvent(eventType: Int, params: Bundle?) {}
            })
            // Support lookup is bounded independently of recognition and finalization.
            var started = false
            fun begin(language: String?) {
                if (started || !live()) return
                started = true
                supportTimeout?.let(main::removeCallbacks); supportTimeout = null
                if (language != null) intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
                listenTimeout = Runnable { end(current, "error", message = "Speech provider did not become ready. Use Speech options or tap again.") }.also { main.postDelayed(it, 12_000) }
                try {
                    if (!admission.admit(ticket) { engine.startListening(intent) }) end(current, "cancelled")
                } catch (_: Exception) { end(current, "error", message = "The selected speech provider refused recognition. Use Speech options to choose another; no fallback was started.") }
            }
            if (Build.VERSION.SDK_INT >= 33) {
                supportTimeout = Runnable { begin(null) }.also { main.postDelayed(it, 2000) }
                try { engine.checkRecognitionSupport(intent, context.mainExecutor, object : RecognitionSupportCallback {
                    override fun onSupportResult(support: RecognitionSupport) {
                        if (started || !live()) return
                        val installed = support.installedOnDeviceLanguages
                        val pools = if (plan.mode == "onDevice") installed else installed + support.onlineLanguages
                        val exact = VoiceLanguage.supportedRequest(plan.language, pools)
                        if (plan.mode == "onDevice" && exact == null && VoiceLanguage.supportedRequest(plan.language, support.supportedOnDeviceLanguages) != null) {
                            started = true; end(current, "error", message = "The requested ${plan.language} model is supported but not installed on this device. Download it in Android speech settings or choose another language explicitly. No online fallback was started.")
                        } else if (exact == null && (pools.isNotEmpty() || plan.mode == "onDevice" && support.supportedOnDeviceLanguages.isNotEmpty())) {
                            val alternative = VoiceLanguage.closest(plan.language, pools)
                            val suggestion = alternative?.let { " This provider advertises $it instead. Choose that language explicitly in Speech options; its model may still need downloading." }.orEmpty()
                            started = true; end(current, "error", message = VoiceInputPolicy.error(13) + suggestion)
                        } else begin(exact) // Unknown capabilities keep the exact requested tag; never guess a region.
                    }
                    override fun onError(error: Int) { if (error == 12 || error == 13) { if (!started && live()) { started = true; end(current, "error", message = VoiceInputPolicy.error(error)) } } else begin(null) }
                }) } catch (_: Exception) { begin(null) }
            } else begin(null)
            promise.resolve(null)
        } catch (_: Exception) {
            admission.release(ticket)
            end(token, "error", message = "Android recognition could not start. Check Speech options and the installed language model.")
            promise.reject("voice", "Android recognition could not start. Check Speech options and the installed language model.")
        }
    }
    private fun complete(current: Long, heard: String?) {
        val text = heard?.trim()
        if (text.isNullOrEmpty() || text.length > VoiceInputPolicy.MAX_TEXT || !text.any(Char::isLetterOrDigit)) end(current, "error", message = "No usable speech was recognized. Tap the microphone and try again.")
        else end(current, "final", text = text)
    }
    private fun deliverExternal() {
        val result = pendingExternal ?: return
        val ticket = activeTicket ?: return
        if (!admission.ownsHandoff(ticket)) return
        if (windowFocused() && admission.accepts(ticket)) { pendingExternal = null; complete(result.first, result.second) }
    }
    private fun finishCurrent(current: Long, stop: Boolean) {
        if (!policy.finish(current)) return
        policy.id?.let { event(it, "finishing") }
        listenTimeout?.let(main::removeCallbacks); listenTimeout = null
        finalTimeout = Runnable { end(current, "error", message = "Recognition ended without a final result. Tap again.") }.also { main.postDelayed(it, VoiceInputPolicy.FINISH_MS) }
        if (stop) try { recognizer?.stopListening() } catch (_: Exception) { end(current, "error", message = "Recognition was interrupted. Tap again.") }
    }
    @ReactMethod fun finish(id: String, promise: Promise) { main.post { if (policy.id == id && VoiceActivityHandoff.pending?.id != id) finishCurrent(token, true); promise.resolve(null) } }
    @ReactMethod fun cancel(id: String, promise: Promise) { retire(admission.cancel(id)); promise.resolve(null) }
    override fun onWindowFocusChange(hasFocus: Boolean) { retire(admission.focus(hasFocus)); if (hasFocus) main.post { deliverExternal() } }
    override fun onHostResume() {
        foreground = true; admission.foreground(true)
        retire(admission.focus(context.currentActivity?.hasWindowFocus() == true))
        main.post { deliverExternal() }
    }
    override fun onHostPause() { foreground = false; retire(admission.foreground(false)) }
    override fun onHostDestroy() { foreground = false; retire(admission.close()) }
    override fun invalidate() {
        invalidated = true; foreground = false; retire(admission.close())
        context.removeLifecycleEventListener(this); context.removeWindowFocusChangeListener(this)
        super.invalidate()
    }
}
class BobVoiceInputPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(BobVoiceInput(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
