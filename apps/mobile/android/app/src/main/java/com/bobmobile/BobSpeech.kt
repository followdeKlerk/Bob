package com.bobmobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import com.facebook.react.bridge.*
import com.facebook.react.common.LifecycleState
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.Locale

// Speaker engine/language/rate and queued playback adapted from Omalauncher Speaker.kt (MIT).
// Copyright (c) 2026 Simon Schubert and contributors. See upstream/omalauncher/source/LICENSE.
/** Phone presentation only. Never writes to Durable, a file, or a network endpoint. */
class BobSpeech(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context), LifecycleEventListener {
    private val cleanupRegistry get() = NativeSpeechEngineLease.cleanupRegistry
    private var networkConsent = false
    private var configured: String? = null
    private fun configuration(): String = listOf(
        Settings.Secure.getString(context.contentResolver, Settings.Secure.TTS_DEFAULT_SYNTH).orEmpty(),
        Locale.getDefault().toLanguageTag(),
        Settings.Secure.getString(context.contentResolver, "tts_default_rate").orEmpty(),
        Settings.Secure.getString(context.contentResolver, "tts_default_locale").orEmpty()
    ).joinToString("|")
    @ReactMethod fun configuration(promise: Promise) { main.post {
        promise.resolve(Arguments.createMap().apply {
            putString("key", configuration()); putString("provider", Settings.Secure.getString(context.contentResolver, Settings.Secure.TTS_DEFAULT_SYNTH).orEmpty())
        })
    } }
    private val main = Handler(Looper.getMainLooper())
    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val engineLease = SpeechEngineLease<TextToSpeech>({ it.stop() == TextToSpeech.SUCCESS }, { it.shutdown() })
    private val engine: TextToSpeech? get() = engineLease.engine
    private val stopFailure = "Read aloud could not be confirmed stopped. Try Stop again; if it still fails, close Bob completely and reopen before dictating."
    private var generation = 0
    private var active: String? = null
    private var pending: Promise? = null
    private var parts = emptyList<String>()
    private var index = 0
    private var foreground = context.lifecycleState == LifecycleState.RESUMED
    private var focus: AudioFocusRequest? = null
    private var receiverRegistered = false
    private var timeout: Runnable? = null
    private val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
    private var focusListener: AudioManager.OnAudioFocusChangeListener? = null
    private val noisy = object : BroadcastReceiver() {
        override fun onReceive(c: Context?, intent: Intent?) {
            if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) main.post { finish("stopped") }
        }
    }
    init { context.addLifecycleEventListener(this) }
    override fun getName() = "BobSpeech"
    @ReactMethod fun addListener(name: String) {}
    @ReactMethod fun removeListeners(count: Double) {}

    private fun event(id: String, state: String, message: String? = null, stopUnconfirmed: Boolean = false) {
        if (!context.hasActiveReactInstance()) return
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("BobSpeechState", Arguments.createMap().apply {
            putString("id", id); putString("state", state)
            if (message != null) putString("message", message)
            putBoolean("stopUnconfirmed", stopUnconfirmed)
        })
    }
    @Suppress("DEPRECATION")
    private fun finish(state: String, message: String? = null): Boolean {
        generation++
        timeout?.let { main.removeCallbacks(it) }; timeout = null
        val id = active; active = null
        val promise = pending; pending = null
        parts = emptyList(); index = 0
        val cleaned = cleanupRegistry.cleanup(engineLease)
        val failure = message ?: if (!cleaned) stopFailure else null
        try {
            if (Build.VERSION.SDK_INT >= 26) focus?.let { audio.abandonAudioFocusRequest(it) }
            else focusListener?.let { audio.abandonAudioFocus(it) }
        } catch (_: Exception) {}
        focus = null; focusListener = null
        if (receiverRegistered) { try { context.unregisterReceiver(noisy) } catch (_: Exception) {}; receiverRegistered = false }
        if (cleaned) NativeSpeechEngineLease.release(this)
        if (id != null) event(id, if (failure != null) "error" else state, failure, !cleaned)
        if (failure != null) promise?.reject("speech", failure, Arguments.createMap().apply { putBoolean("stopUnconfirmed", !cleaned) }) else promise?.resolve(null)
        return cleaned
    }
    private fun fail(message: String) = finish("error", message)

    internal fun stopForCapture(): Boolean = finish("stopped")
    @ReactMethod fun speak(text: String, id: String, promise: Promise) = speakInternal(text, id, null, false, promise)
    @ReactMethod fun speakConfigured(text: String, id: String, key: String, consent: Boolean, promise: Promise) = speakInternal(text, id, key, consent, promise)
    private fun rejectStop(promise: Promise) = promise.reject("speech", stopFailure, Arguments.createMap().apply { putBoolean("stopUnconfirmed", true) })
    private fun speakInternal(text: String, id: String, key: String?, consent: Boolean, promise: Promise) { main.post {
        if (NativeVoiceCapture.active) { promise.reject("speech", "Finish or cancel microphone capture before playback."); return@post }
        if (key != null && key != configuration()) { promise.reject("speech", "Text-to-speech configuration changed. Review the provider again."); return@post }
        if (!NativeSpeechEngineLease.stopForCapture()) { rejectStop(promise); return@post }
        configured = key; networkConsent = consent && key != null
        if (!foreground || context.currentActivity == null) { promise.reject("speech", "Open Bob to read a reply aloud."); return@post }
        val chunks = try { SpeechPolicy.chunks(text, minOf(3000, TextToSpeech.getMaxSpeechInputLength())) }
            catch (_: Exception) { promise.reject("speech", "Choose a reply containing 1–100,000 characters."); return@post }
        if (id.isBlank() || id.length > 100) { promise.reject("speech", "Invalid playback request."); return@post }
        if (!finish("stopped")) { rejectStop(promise); return@post }
        active = id; pending = promise; parts = chunks; index = 0
        val token = generation
        event(id, "starting")
        timeout = Runnable { if (token == generation) fail("Speech engine did not initialize. Check Android text-to-speech settings.") }.also { main.postDelayed(it, 15000) }
        try {
            // Always post: Android may invoke a failure callback before the constructor returns.
            NativeSpeechEngineLease.owner = this
            engineLease.attach(TextToSpeech(context) { status -> main.post {
                if (token != generation) return@post
                timeout?.let { main.removeCallbacks(it) }; timeout = null
                if (status != TextToSpeech.SUCCESS) { fail("No working speech engine. Install or configure one in Android text-to-speech settings."); return@post }
                try { start(token) } catch (_: Exception) { fail("Speech could not start. Check your installed voice and Android speech settings.") }
            } })
        } catch (_: Exception) { fail("Speech engine is unavailable. Check Android text-to-speech settings.") }
    } }

    @Suppress("DEPRECATION")
    private fun start(token: Int) {
        if (!foreground || NativeVoiceCapture.active) { finish("stopped"); return }
        if (configured != null && configured != configuration()) { fail("Speech provider changed. Review it before playback."); return }
        val tts = engine ?: return
        val preferred = tts.defaultVoice
        val locale = Locale.getDefault()
        val voice = tts.voices.orEmpty().filter {
            (networkConsent || !it.isNetworkConnectionRequired) && !it.features.orEmpty().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) && it.locale.language == locale.language
        }.sortedWith(compareByDescending<android.speech.tts.Voice> { it.name == preferred?.name }
            .thenByDescending { it.locale == locale }.thenByDescending { it.quality }.thenBy { it.name }).firstOrNull()
        if (voice == null || tts.setVoice(voice) != TextToSpeech.SUCCESS) {
            fail("No installed ${if (networkConsent) "provider" else "offline"} voice for ${locale.displayLanguage}. Download a voice in Android speech settings${if (!networkConsent) " or explicitly allow a provider voice for this reply" else ""}."); return
        }
        val rate = Settings.Secure.getInt(context.contentResolver, "tts_default_rate", 100) / 100f
        tts.setSpeechRate(rate.coerceIn(0.5f, 2f))
        if (tts.setAudioAttributes(attributes) != TextToSpeech.SUCCESS) { fail("Speech audio output is unavailable."); return }
        val listener = AudioManager.OnAudioFocusChangeListener { change ->
            if (change != AudioManager.AUDIOFOCUS_GAIN) main.post { if (token == generation) finish("stopped") }
        }
        focusListener = listener
        val granted = if (Build.VERSION.SDK_INT >= 26) {
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).setAudioAttributes(attributes)
                .setOnAudioFocusChangeListener(listener, main).setAcceptsDelayedFocusGain(false).build()
            focus = request; audio.requestAudioFocus(request)
        } else audio.requestAudioFocus(listener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
        if (granted != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { fail("Audio is busy. Try reading aloud again when the other audio session ends."); return }
        if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(noisy, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), Context.RECEIVER_NOT_EXPORTED)
        else context.registerReceiver(noisy, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY))
        receiverRegistered = true
        val listenerResult = tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) { main.post {
                if (token == generation && utteranceId == "$active:$index") active?.let { event(it, "speaking") }
            } }
            override fun onDone(utteranceId: String?) { main.post {
                if (token != generation || utteranceId != "$active:$index") return@post
                index++
                if (index >= parts.size) finish("done") else enqueue()
            } }
            @Deprecated("Legacy engine callback")
            override fun onError(utteranceId: String?) { main.post {
                if (token == generation && utteranceId == "$active:$index") fail("Speech playback failed. Check that the selected offline voice is installed.")
            } }
            override fun onError(utteranceId: String?, errorCode: Int) = onError(utteranceId)
            override fun onStop(utteranceId: String?, interrupted: Boolean) { main.post {
                if (token == generation && utteranceId == "$active:$index") finish("stopped")
            } }
        })
        if (listenerResult != TextToSpeech.SUCCESS) { fail("Speech progress reporting is unavailable."); return }
        enqueue()
    }
    private fun enqueue() {
        if (!foreground || NativeVoiceCapture.active) { finish("stopped"); return }
        timeout?.let(main::removeCallbacks)
        // A broken provider must not hold an invisible, endless playback lease.
        // Generous per-chunk bound also accommodates slow installed voices.
        val token = generation
        timeout = Runnable { if (token == generation) fail("Speech provider stopped reporting progress. Try Stop, then read the reply again.") }
            .also { main.postDelayed(it, 60_000L + parts[index].length * 200L) }
        try {
            if (engine?.speak(parts[index], TextToSpeech.QUEUE_FLUSH, null, "$active:$index") != TextToSpeech.SUCCESS) {
                fail("The speech engine rejected this reply."); return
            }
            pending?.resolve(null); pending = null // Admission only; done/error arrives through the listener.
        } catch (_: Exception) { fail("Speech playback is unavailable.") }
    }
    @ReactMethod fun stop(id: String, promise: Promise) { main.post {
        if ((id.isEmpty() || active == id) && !NativeSpeechEngineLease.stopForCapture()) rejectStop(promise)
        else promise.resolve(null)
    } }
    @ReactMethod fun openSettings(promise: Promise) { main.post {
        finish("stopped")
        try {
            context.startActivity(Intent("com.android.settings.TTS_SETTINGS").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            promise.resolve(null)
        } catch (_: Exception) { promise.reject("speech", "Open Android Settings and search for Text-to-speech output.") }
    } }
    override fun onHostResume() { foreground = true }
    override fun onHostPause() { foreground = false; main.post { finish("stopped") } }
    override fun onHostDestroy() { foreground = false; main.post { finish("stopped") } }
    override fun invalidate() {
        context.removeLifecycleEventListener(this)
        main.post { finish("stopped") }
        super.invalidate()
    }
}

/** All potentially live TTS leases remain reachable across React module recreation. Main thread only. */
internal object NativeSpeechEngineLease {
    val cleanupRegistry = SpeechEngineCleanup<TextToSpeech>()
    private val emptyLease = SpeechEngineLease<TextToSpeech>({ it.stop() == TextToSpeech.SUCCESS }, { it.shutdown() })
    var owner: BobSpeech? = null
    fun release(value: BobSpeech) { if (owner === value) owner = null }
    fun stopForCapture(): Boolean {
        val speech = owner?.stopForCapture() ?: cleanupRegistry.cleanup(emptyLease)
        val capture = NativeVoiceCapture.cleanupRetired()
        return speech && capture
    }
}
