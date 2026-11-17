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
        assertTrue(stop.contains("!NativeSpeechEngineLease.cleanRevoked()) rejectStop(promise)"))
        assertTrue(code.contains("if (!finish(\"stopped\")) { admission.release(ticket); rejectStop(promise); return@post }"))
        assertTrue(code.contains("putBoolean(\"stopUnconfirmed\", !cleaned)"))
        assertTrue(code.contains("if (cleaned) NativeSpeechEngineLease.release(this)"))
    }
    @Test fun failureRetiresCallbacksWithoutForgettingCleanupAndNetworkExceptionsFailClosed() {
        val finish = code.substringAfter("private fun finish(").substringBefore("private fun fail(")
        assertTrue(finish.indexOf("generation++") < finish.indexOf("cleanupRegistry.cleanup(engineLease)"))
        assertTrue(finish.indexOf("active = null") < finish.indexOf("cleanupRegistry.cleanup(engineLease)"))
        for (cleanup in listOf("main.removeCallbacks", "abandonAudioFocusRequest", "focus = null", "unregisterReceiver(noisy)", "pending = null", "return cleaned")) assertTrue(cleanup, finish.contains(cleanup))
        assertTrue(code.contains("if (token != generation || !admission.accepts(ticket)) return@post"))
        assertFalse(code.contains("networkConsent"))
        assertTrue(code.contains("key != null && key != configuration()"))
        assertTrue(code.contains("if (consent) { promise.reject"))
        assertTrue(code.contains("SpeechPolicy.permitsVoice(it.isNetworkConnectionRequired)"))
        assertTrue(code.contains("TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED"))
        assertTrue(code.contains("if (NativeVoiceCapture.active)"))
        assertTrue(code.contains("tts.setSpeechRate(rate.coerceIn(0.5f, 2f))"))
        assertTrue(code.contains("TextToSpeech.QUEUE_FLUSH")) // one bounded chunk at a time, next only on matching onDone
        assertTrue(code.contains("utteranceId != \"\$active:\$index\""))
    }
    @Test fun queuedInitializationAndEveryChunkUseSynchronousNativeRevocation() {
        val stop = code.substringAfter("@ReactMethod fun stop(").substringBefore("@ReactMethod fun openSettings(")
        assertTrue(stop.indexOf("admission.cancelAll()") < stop.indexOf("main.post"))
        val invalidate = code.substringAfter("override fun invalidate()")
        assertTrue(invalidate.indexOf("admission.close(ticketOwner)") < invalidate.indexOf("main.post"))
        val enqueue = code.substringAfter("private fun enqueue(").substringBefore("internal fun hasCurrentTicket")
        assertTrue(enqueue.contains("admission.admit(ticket)"))
        assertTrue(enqueue.indexOf("engineLease.markPossibleAudio()") < enqueue.indexOf("engine?.speak("))
        assertTrue(code.contains("owner?.hasCurrentTicket() == false"))
        assertFalse(code.contains("getCurrentEngine")); assertFalse(code.contains("java.lang.reflect"))
        assertFalse(code.contains("putString(\"provider\"")) // settings are not recipient attestation
        val start = code.substringAfter("private fun speakInternal(")
        assertTrue(start.indexOf("if (consent)") < start.indexOf("TextToSpeech(context)"))
    }
}
