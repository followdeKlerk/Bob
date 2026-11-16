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
        for (gate in listOf("!admission.accepts(ticket) || !windowFocused()",
            "checkSelfPermission(Manifest.permission.RECORD_AUDIO)", "policy.id != null", "VoiceInputPolicy.permitted(mode, onDevice(), platform(), platformConsent)")) {
            assertTrue(gate, source.indexOf(gate) in 0 until create)
        }
        assertTrue(source.contains("Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)"))
        assertFalse(source.contains("EXTRA_PREFER_OFFLINE")) // An advisory extra is not on-device support.
    }
    @Test fun allTerminalPathsRevokeBeforeDestroyAndBoundEvenAnUnresponsiveEngine() {
        val source = code
        assertTrue(source.indexOf("policy.end(token)") < source.indexOf("old?.destroy()"))
        assertTrue(source.contains("!policy.current(current) || !admission.accepts(ticket)"))
        assertTrue(source.contains("if (!windowFocused()) { retire(admission.cancel(id)); return false }"))
        for (lifecycle in listOf("onHostPause", "onHostDestroy")) {
            assertTrue(source.substringAfter("override fun $lifecycle()").substringBefore("\n").contains("foreground = false; retire(admission.foreground(false))"))
        }
        assertTrue(source.substringAfter("override fun invalidate()").contains("retire(admission.close())"))
        assertTrue(source.contains("main.postDelayed(it, VoiceInputPolicy.LISTEN_MS)"))
        assertTrue(source.contains("main.postDelayed(it, VoiceInputPolicy.FINISH_MS)"))
        assertTrue(source.indexOf("VoiceInputPolicy.LISTEN_MS") < source.indexOf("engine.startListening("))
        assertTrue(source.contains("retire(admission.cancel(id))"))
        assertTrue(source.contains("if (activeTicket == ticket) end(token, \"cancelled\")"))
        assertTrue(source.contains("context.addWindowFocusChangeListener(this)"))
        assertTrue(source.contains("context.removeWindowFocusChangeListener(this)"))
        assertTrue(source.contains("override fun onWindowFocusChange(hasFocus: Boolean) { retire(admission.focus(hasFocus)) }"))
        assertTrue(source.contains("it.hasWindowFocus()"))
        assertTrue(source.contains("admission.admit(ticket) { engine.startListening(intent) }"))
        val start = source.substringAfter("@ReactMethod fun start(")
        assertTrue(start.indexOf("val ticket = admission.claim(id)") < start.indexOf("main.post {"))
        assertTrue(start.lastIndexOf("!admission.accepts(ticket) || !windowFocused()", start.indexOf("engine.startListening(")) >= 0)
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
