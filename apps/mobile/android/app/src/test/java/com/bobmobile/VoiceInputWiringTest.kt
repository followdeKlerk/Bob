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
            "plan == null", "plan.networkCapable && !consent && !preferences.approved(plan.key)", "NativeSpeechEngineLease.stopForCapture()", "NativeVoiceCapture.claim(this)")) {
            assertTrue(gate, launch.indexOf(gate) in 0 until create)
        }
        assertTrue(source.contains("VoiceProviders.options(context, language).firstOrNull { it.key == key && it.language == language }"))
        assertTrue(providers.contains("Build.VERSION.SDK_INT < 31 || !SpeechRecognizer.isOnDeviceRecognitionAvailable(context)"))
        assertTrue(providers.contains("RecognitionService.SERVICE_META_DATA"))
        assertTrue(providers.contains("it.packageName.startsWith(\"com.google.\")"))
        assertTrue(providers.contains("requestedLanguage: String = \"en-GB\""))
        assertTrue(source.contains("preferences.selection"))
        assertTrue(source.contains("plans.sortedByDescending { it.selection == selected }"))
        assertTrue(source.contains("Saved provider unavailable"))
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
        val start = source.substringAfter("fun begin(language: String?)")
        assertTrue(start.indexOf("if (!admission.admit(ticket)") < start.indexOf("engine.startListening(intent)"))
        assertTrue(start.indexOf("if (!configured())") < start.indexOf("engine.startListening(intent)"))
        assertTrue(source.contains("VoiceProviders.options(context, plan.language).any { it.key == plan.key }"))
        for (method in listOf("start(", "startConfigured(")) {
            val start = source.substringAfter("@ReactMethod fun $method").substringBefore("private fun launch(")
            assertTrue(start.indexOf("val ticket = admission.claim(id)") < start.indexOf("main.post {"))
        }
        assertTrue(source.contains("val installed = support.installedOnDeviceLanguages"))
        assertFalse(source.contains("ERROR_LANGUAGE_UNAVAILABLE ->")) // no automatic engine/model/network retry
        assertTrue(source.contains("if (live()) event(ticket.id, \"partial\""))
    }
    @Test fun externalActivityIsExplicitOwnedOneUseAndOnlyDeliversBackToFocusedBob() {
        val source = code
        assertTrue(source.contains("check(admission.handoff(ticket))"))
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
        for (bad in listOf("MediaRecorder", "AudioRecord", "File(", "Log.", "printStackTrace", "OkHttp", "openConnection", "startService", "HeadlessJs", "startForeground", "dev.omalauncher", "ProcessBuilder", "Proot", "compose.runtime")) assertFalse(bad, code.contains(bad))
        assertTrue(code.contains("override fun onBufferReceived(buffer: ByteArray?) {}"))
    }
    @Test fun approvalIsNativeBoundRevocableAndSilenceHintsDoNotAddRetries() {
        val source = code
        assertTrue(source.contains("putBoolean(\"approved\", preferences.approved(plan.key))"))
        assertTrue(source.contains("preferences.remember(plan, consent)"))
        val revoke = source.substringAfter("@ReactMethod fun revokeApprovals").substringBefore("@ReactMethod fun availability")
        assertTrue(revoke.indexOf("admission.cancelCurrent()") < revoke.indexOf("main.post"))
        assertTrue(revoke.contains("preferences.revoke()"))
        for (extra in listOf("EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS", "EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS")) assertTrue(source.contains("RecognizerIntent.$extra, VoiceInputPolicy.SILENCE_MS"))
        assertEquals(1, Regex("engine.startListening").findAll(source).count())
    }
    @Test fun allRoutesSendTheDisclosedLocaleWithoutRegionRewriting() {
        assertTrue(code.contains("RecognizerIntent.EXTRA_LANGUAGE, VoiceLanguage.requested(plan.language)"))
        assertTrue(code.contains("@ReactMethod fun options(language: String?, promise: Promise)"))
        assertTrue(code.contains("@ReactMethod fun startConfigured(id: String, key: String, language: String, consent: Boolean, promise: Promise)"))
        assertTrue(providers.contains("fun options(context: Context, requestedLanguage: String"))
        assertTrue(code.indexOf("VoiceLanguage.requested(plan.language)") < code.indexOf("if (plan.mode == \"activity\")"))
        assertTrue(code.contains("VoiceLanguage.supportedRequest(plan.language, pools)"))
        assertTrue(code.contains("else begin(exact)")); assertTrue(code.contains("else begin(null)"))
        assertFalse(code.contains("VoiceLanguage.mainRegion")); assertFalse(code.contains("begin(closest)"))
    }
}
