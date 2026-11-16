package com.bobmobile

import java.io.File
import org.junit.Assert.*
import org.junit.Test

/** Bridge security/lifecycle guardrails supplement policy tests; not a physical microphone test. */
class VoiceInputWiringTest {
    private val code get() = File("src/main/java/com/bobmobile/BobVoiceInput.kt").readText()
    @Test fun foregroundAndAndroidPermissionPrecedeAnyRecognizerCreation() {
        val source = code
        val create = source.indexOf("SpeechRecognizer.createOnDeviceSpeechRecognizer(context)")
        for (gate in listOf("!foreground", "context.currentActivity == null", "context.lifecycleState != LifecycleState.RESUMED",
            "checkSelfPermission(Manifest.permission.RECORD_AUDIO)", "policy.id != null", "VoiceInputPolicy.permitted(mode, onDevice(), platform(), platformConsent)")) {
            assertTrue(gate, source.indexOf(gate) in 0 until create)
        }
        assertTrue(source.contains("Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)"))
        assertFalse(source.contains("EXTRA_PREFER_OFFLINE")) // An advisory extra is not on-device support.
    }
    @Test fun allTerminalPathsRevokeBeforeDestroyAndBoundEvenAnUnresponsiveEngine() {
        val source = code
        assertTrue(source.indexOf("policy.end(token)") < source.indexOf("old?.destroy()"))
        assertTrue(source.contains("policy.current(current) && foreground && !invalidated"))
        for (lifecycle in listOf("onHostPause", "onHostDestroy")) {
            assertTrue(source.substringAfter("override fun $lifecycle()").substringBefore("\n").contains("foreground = false; main.post { cancelCurrent() }"))
        }
        assertTrue(source.substringAfter("override fun invalidate()").contains("main.post { cancelCurrent() }"))
        assertTrue(source.contains("main.postDelayed(it, VoiceInputPolicy.LISTEN_MS)"))
        assertTrue(source.contains("main.postDelayed(it, VoiceInputPolicy.FINISH_MS)"))
        assertTrue(source.indexOf("VoiceInputPolicy.LISTEN_MS") < source.indexOf("engine.startListening("))
        assertTrue(source.contains("if (policy.id == id) cancelCurrent()")) // Old cancellation cannot stop a new request.
    }
    @Test fun registrationIsDiscoverableButNoBackgroundCapturePersistenceOrAudioTransportIsAdded() {
        val manifest = File("src/main/AndroidManifest.xml").readText()
        assertTrue(manifest.contains("android.permission.RECORD_AUDIO"))
        assertTrue(manifest.contains("android.speech.RecognitionService"))
        assertFalse(manifest.contains("FOREGROUND_SERVICE_MICROPHONE"))
        assertTrue(File("src/main/java/com/bobmobile/MainApplication.kt").readText().contains("add(BobVoiceInputPackage())"))
        for (bad in listOf("MediaRecorder", "AudioRecord", "File(", "SharedPreferences", "Log.", "printStackTrace", "OkHttp", "openConnection", "startService", "HeadlessJs", "startForeground")) {
            assertFalse(bad, code.contains(bad))
        }
        assertTrue(code.contains("override fun onBufferReceived(buffer: ByteArray?) {}"))
        assertTrue(code.contains("override fun onPartialResults(partialResults: Bundle?) {}"))
    }
}
