package com.bobmobile

// Adapted from Omalauncher ui/voice/Speech.kt (MIT).
// Copyright (c) 2026 Simon Schubert and contributors. See upstream/omalauncher/source/LICENSE.
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Resources
import android.os.Build
import android.provider.Settings
import android.speech.RecognitionService
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import java.util.Locale

internal data class VoiceProvider(val mode: String, val component: ComponentName?, val language: String, val key: String, val label: String) {
    val networkCapable get() = mode != "onDevice"
}
internal object VoiceProviders {
    private fun onDevice(context: Context): ComponentName? {
        if (Build.VERSION.SDK_INT < 31 || !SpeechRecognizer.isOnDeviceRecognitionAvailable(context)) return null
        val resources = Resources.getSystem()
        val id = resources.getIdentifier("config_defaultOnDeviceSpeechRecognitionService", "string", "android")
        if (id == 0) return ComponentName("android", "onDevice")
        val component = ComponentName.unflattenFromString(resources.getString(id)) ?: return null
        return runCatching {
            component.takeIf { context.packageManager.getServiceInfo(it, 0).isEnabled && context.packageManager.getApplicationInfo(it.packageName, 0).enabled }
        }.getOrNull()
    }
    private fun stamp(context: Context, component: ComponentName): String = runCatching {
        val info = context.packageManager.getPackageInfo(component.packageName, 0)
        "${info.lastUpdateTime}:${if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()}"
    }.getOrDefault("system")
    fun options(context: Context, requestedLanguage: String = Locale.getDefault().toLanguageTag()): List<VoiceProvider> {
        val pm = context.packageManager
        val picked = runCatching { Settings.Secure.getString(context.contentResolver, "voice_recognition_service") }.getOrNull()?.let(ComponentName::unflattenFromString)
        val services = pm.queryIntentServices(Intent(RecognitionService.SERVICE_INTERFACE), PackageManager.GET_META_DATA)
            .mapNotNull { it.serviceInfo }.filter { it.isEnabled && it.applicationInfo.enabled && it.metaData?.containsKey(RecognitionService.SERVICE_META_DATA) == true }
        val service = services.firstOrNull { ComponentName(it.packageName, it.name) == picked } ?: services.firstOrNull()
        val device = onDevice(context)
        val activityIntent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
        val activities = pm.queryIntentActivities(activityIntent, PackageManager.MATCH_DEFAULT_ONLY).mapNotNull { it.activityInfo }
            .filter { it.enabled && it.applicationInfo.enabled && it.exported }
        val resolved = pm.resolveActivity(activityIntent, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo
        // Pin a REAL component, never the system ResolverActivity: consent must name the
        // exact provider, not an undisclosed provider selected later by a chooser.
        val activity = activities.firstOrNull { it.packageName == picked?.packageName }
            ?: activities.firstOrNull { it.packageName == resolved?.packageName && it.name == resolved?.name }
            ?: activities.firstOrNull()
        val language = requestedLanguage
        fun plan(mode: String, component: ComponentName, label: String) = VoiceProvider(mode, component, language,
            listOf(mode, component.flattenToString(), stamp(context, component), language, picked?.flattenToString().orEmpty()).joinToString("|"), label)
        val local = device?.let { plan("onDevice", it, "On-device recognition") }
        val regular = service?.let { plan("platform", ComponentName(it.packageName, it.name), "${pm.getApplicationLabel(it.applicationInfo)} speech service") }
        val screen = activity?.let { plan("activity", ComponentName(it.packageName, it.name), "${pm.getApplicationLabel(it.applicationInfo)} speech screen") }
        // Honor an explicitly selected non-Google service rather than silently replacing it with Google's local engine.
        val pickedOther = picked != null && !picked.packageName.startsWith("com.google.")
        val selectedService = service != null && picked == ComponentName(service.packageName, service.name)
        val selectedActivity = activity != null && activity.packageName == picked?.packageName
        return when {
            pickedOther && selectedService -> listOf(regular, local, screen)
            pickedOther && selectedActivity -> listOf(screen, local, regular)
            else -> listOf(local, regular, screen)
        }.filterNotNull()
    }
}

/** No automatic retry/restart or cross-language guessing. The user can choose a disclosed alternative. */
internal object VoiceLanguage {
    // Preserve the owner's BCP-47 tag, including region, script and extensions.
    fun valid(tag: String): Boolean = tag.length in 2..100 && tag.all { it.isLetterOrDigit() || it == '-' } &&
        Locale.forLanguageTag(tag).let { it.language.isNotEmpty() && it.toLanguageTag().equals(tag, true) }
    fun requested(tag: String): String = tag
    fun mainRegion(tag: String): String = requested(tag) // Compatibility for the original independent probe.
    fun closest(tag: String, available: List<String>): String? {
        val wanted = Locale.forLanguageTag(tag)
        val same = available.filter {
            val candidate = Locale.forLanguageTag(it)
            candidate.language == wanted.language && (wanted.script.isEmpty() || candidate.script == wanted.script)
        }
        return same.firstOrNull { it.equals(tag, true) } ?: same.firstOrNull()
    }
    fun supportedRequest(tag: String, available: List<String>): String? =
        available.firstOrNull { it.equals(tag, true) }?.let { requested(tag) }

}
