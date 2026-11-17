package com.bobmobile

import java.io.File
import org.junit.Assert.*
import org.junit.Test

/** Source integration guards, not Android engine execution or device proof. */
class SpeechWiringTest {
    private val code get() = File("src/main/java/com/bobmobile/BobSpeech.kt").readText()
    @Test fun actualAndroidStopStatusAndShutdownFeedTheTestedProcessLifetimeLease() {
        assertTrue(code.contains("SpeechEngineLease<TextToSpeech>({ it.stop() == TextToSpeech.SUCCESS }, { it.shutdown() })"))
        assertTrue(code.contains("engineLease.attach(TextToSpeech(context)"))
        assertTrue(code.contains("internal object NativeSpeechEngineLease"))
        assertTrue(code.contains("val cleanupRegistry = SpeechEngineCleanup<TextToSpeech>()"))
        assertTrue(code.contains("owner?.stopForCapture() ?: cleanupRegistry.cleanup(emptyLease)"))
        assertFalse(code.contains("engine = null"))
        assertTrue(code.contains("private val engine: TextToSpeech? get() = engineLease.engine"))
        val stop = code.substringAfter("@ReactMethod fun stop(").substringBefore("@ReactMethod fun openSettings(")
        assertTrue(stop.contains("!NativeSpeechEngineLease.stopForCapture()) rejectStop(promise)"))
        assertTrue(code.contains("if (!finish(\"stopped\")) { rejectStop(promise); return@post }"))
        assertTrue(code.contains("putBoolean(\"stopUnconfirmed\", !cleaned)"))
        assertTrue(code.contains("if (cleaned) NativeSpeechEngineLease.release(this)"))
    }
    @Test fun failureRetiresCallbacksWithoutForgettingCleanupAndNetworkRequiresExplicitConfigBoundOptIn() {
        val finish = code.substringAfter("private fun finish(").substringBefore("private fun fail(")
        assertTrue(finish.indexOf("generation++") < finish.indexOf("cleanupRegistry.cleanup(engineLease)"))
        assertTrue(finish.indexOf("active = null") < finish.indexOf("cleanupRegistry.cleanup(engineLease)"))
        for (cleanup in listOf("main.removeCallbacks", "abandonAudioFocusRequest", "focus = null", "unregisterReceiver(noisy)", "pending = null", "return cleaned")) assertTrue(cleanup, finish.contains(cleanup))
        assertTrue(code.contains("if (token != generation) return@post"))
        assertTrue(code.contains("private var networkConsent = false"))
        assertTrue(code.contains("key != null && key != configuration()"))
        assertTrue(code.contains("networkConsent = consent && key != null"))
        assertTrue(code.contains("networkConsent || !it.isNetworkConnectionRequired"))
        assertTrue(code.contains("TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED"))
        assertTrue(code.contains("if (NativeVoiceCapture.active)"))
        assertTrue(code.contains("tts.setSpeechRate(rate.coerceIn(0.5f, 2f))"))
        assertTrue(code.contains("TextToSpeech.QUEUE_FLUSH")) // one bounded chunk at a time, next only on matching onDone
        assertTrue(code.contains("utteranceId != \"\$active:\$index\""))
    }
}
