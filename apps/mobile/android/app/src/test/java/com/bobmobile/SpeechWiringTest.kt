package com.bobmobile

import java.io.File
import org.junit.Assert.*
import org.junit.Test

/** Source integration guards, not Android engine execution or device proof. */
class SpeechWiringTest {
    private val code get() = File("src/main/java/com/bobmobile/BobSpeech.kt").readText()
    @Test fun actualAndroidStopStatusAndShutdownFeedTheTestedOwnershipBoundary() {
        assertTrue(code.contains("SpeechEngineLease<TextToSpeech>({ it.stop() == TextToSpeech.SUCCESS }, { it.shutdown() })"))
        assertTrue(code.contains("engineLease.attach(TextToSpeech(context)"))
        assertTrue(code.contains("private companion object { val cleanupRegistry = SpeechEngineCleanup<TextToSpeech>() }"))
        assertFalse(code.contains("engine = null"))
        assertTrue(code.contains("private val engine: TextToSpeech? get() = engineLease.engine"))
        val stop = code.substringAfter("@ReactMethod fun stop(").substringBefore("@ReactMethod fun openSettings(")
        assertTrue(stop.contains("!finish(\"stopped\")) promise.reject(\"speech\", stopFailure)"))
        assertTrue(code.contains("if (!finish(\"stopped\")) { promise.reject(\"speech\", stopFailure); return@post }"))
    }
    @Test fun failureDoesNotSkipGenerationTimeoutAudioFocusOrListenerCleanupAndOfflineVoicesRemainRequired() {
        val finish = code.substringAfter("private fun finish(").substringBefore("private fun fail(")
        assertTrue(finish.indexOf("generation++") < finish.indexOf("cleanupRegistry.cleanup(engineLease)"))
        assertTrue(finish.indexOf("active = null") < finish.indexOf("cleanupRegistry.cleanup(engineLease)"))
        for (cleanup in listOf("main.removeCallbacks", "abandonAudioFocusRequest", "focus = null", "unregisterReceiver(noisy)", "pending = null", "return cleaned")) assertTrue(cleanup, finish.contains(cleanup))
        assertTrue(code.contains("if (token != generation) return@post"))
        assertTrue(code.contains("!it.isNetworkConnectionRequired"))
        assertTrue(code.contains("TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED"))
    }
}
