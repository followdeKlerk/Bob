package com.bobmobile

import java.io.File
import org.junit.Assert.*
import org.junit.Test

/** Native bridge integration guards; not physical-engine execution. */
class VoiceInputWiringTest {
    private val code get() = File("src/main/java/com/bobmobile/BobVoiceInput.kt").readText()
    private val providers get() = File("src/main/java/com/bobmobile/VoiceProviders.kt").readText()
    @Test fun permissionFocusPinnedProviderConsentAndTtsCleanupPrecedeRecognizerCreation() {
        val source = code
        val launch = source.substringAfter("private fun launch(")
        val create = launch.indexOf("SpeechRecognizer.createOnDeviceSpeechRecognizer(context)")
        for (gate in listOf("!admission.accepts(ticket) || !windowFocused()", "checkSelfPermission(Manifest.permission.RECORD_AUDIO)",
            "plan == null", "plan.networkCapable && !consent", "NativeSpeechEngineLease.stopForCapture()", "NativeVoiceCapture.claim(this)")) {
            assertTrue(gate, launch.indexOf(gate) in 0 until create)
        }
        assertTrue(source.contains("VoiceProviders.options(context).firstOrNull { it.key == key }"))
        assertTrue(providers.contains("Build.VERSION.SDK_INT < 31 || !SpeechRecognizer.isOnDeviceRecognitionAvailable(context)"))
        assertTrue(providers.contains("RecognitionService.SERVICE_META_DATA"))
        assertTrue(providers.contains("pickedOther && selectedService"))
        assertTrue(providers.contains("pickedOther && selectedActivity"))
        assertTrue(providers.contains("activity.packageName == picked?.packageName"))
        assertTrue(source.contains("SpeechRecognizer.createSpeechRecognizer(context, plan.component)"))
        // Advisory offline preference is never mistaken for a guarantee: nonlocal providers require consent above.
        assertTrue(source.contains("RecognizerIntent.EXTRA_PREFER_OFFLINE, true"))
    }
    @Test fun terminalPathsRevokeBeforeDestroyAndStagesAreIndependentlyBounded() {
        val source = code
        assertTrue(source.indexOf("policy.end(current)") < source.indexOf("old?.destroy()"))
        assertTrue(source.contains("!policy.current(current) || !admission.accepts(ticket)"))
        assertTrue(source.contains("retire(admission.cancel(ticket.id))"))
        assertTrue(source.contains("NativeVoiceCapture.retire(this)"))
        assertTrue(source.contains("stopUnconfirmed = true"))
        for (lifecycle in listOf("onHostPause", "onHostDestroy")) assertTrue(source.contains("override fun $lifecycle()"))
        assertTrue(source.substringAfter("override fun invalidate()").contains("retire(admission.close())"))
        for (deadline in listOf("VoiceInputPolicy.LISTEN_MS", "VoiceInputPolicy.FINISH_MS", "12_000", "60_000", "2000")) assertTrue(deadline, source.contains("main.postDelayed(it, $deadline)"))
        assertTrue(source.contains("admission.admit(ticket) { engine.startListening(intent) }"))
        for (method in listOf("start(", "startConfigured(")) {
            val start = source.substringAfter("@ReactMethod fun $method").substringBefore("private fun launch(")
            assertTrue(start.indexOf("val ticket = admission.claim(id)") < start.indexOf("main.post {"))
        }
        assertTrue(source.contains("support.installedOnDeviceLanguages else"))
        assertFalse(source.contains("ERROR_LANGUAGE_UNAVAILABLE ->")) // no automatic engine/model/network retry
        assertTrue(source.contains("if (live()) event(ticket.id, \"partial\""))
    }
    @Test fun externalActivityIsExplicitOwnedOneUseAndOnlyDeliversBackToFocusedBob() {
        val source = code
        assertTrue(source.contains("if (!admission.handoff(ticket))"))
        assertTrue(source.contains("intent.setComponent(plan.component)"))
        assertTrue(source.contains("admission.ownsHandoff(ticket)"))
        assertTrue(source.contains("windowFocused() && admission.accepts(ticket)"))
        assertTrue(source.contains("VoiceActivityHandoff.cancel(id)"))
        val activity = File("src/main/java/com/bobmobile/BobVoiceRecognitionActivity.kt").readText()
        assertTrue(activity.contains("if (savedInstanceState != null) { VoiceActivityHandoff.finish(id, null); finish(); return }"))
        assertTrue(activity.indexOf("pending = null; activity = null") < activity.indexOf("request.result(text)"))
        assertTrue(activity.contains("finishActivity(requestCode)"))
        val manifest = File("src/main/AndroidManifest.xml").readText()
        assertTrue(manifest.contains("android:name=\".BobVoiceRecognitionActivity\" android:exported=\"false\""))
        assertTrue(manifest.contains("android.speech.action.RECOGNIZE_SPEECH"))
    }
    @Test fun noBackgroundCaptureStorageNetworkOrLauncherDependency() {
        val manifest = File("src/main/AndroidManifest.xml").readText()
        assertTrue(manifest.contains("android.permission.RECORD_AUDIO"))
        assertFalse(manifest.contains("FOREGROUND_SERVICE_MICROPHONE"))
        assertTrue(File("src/main/java/com/bobmobile/MainApplication.kt").readText().contains("add(BobVoiceInputPackage())"))
        for (bad in listOf("MediaRecorder", "AudioRecord", "File(", "SharedPreferences", "Log.", "printStackTrace", "OkHttp", "openConnection", "startService", "HeadlessJs", "startForeground", "dev.omalauncher", "ProcessBuilder", "Proot", "compose.runtime")) assertFalse(bad, code.contains(bad))
        assertTrue(code.contains("override fun onBufferReceived(buffer: ByteArray?) {}"))
    }
}
