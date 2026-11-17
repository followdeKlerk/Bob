package com.bobmobile

import android.content.Context
import android.content.SharedPreferences

/** Device-local preferences only. Never stores audio, transcripts, or per-chat state. */
internal class VoicePreferences(private val prefs: SharedPreferences) {
    constructor(context: Context) : this(context.getSharedPreferences("bob-speech-preferences-v1", Context.MODE_PRIVATE))
    val language: String get() = prefs.getString("language", null)?.takeIf(VoiceLanguage::valid) ?: "en-GB"
    val selection: String? get() = prefs.getString("recognizer", null)
    val voiceMode: String get() = prefs.getString("voiceMode", null) ?: "default"
    val systemVoice: Boolean get() = voiceMode == "system"
    val googleVoice: Boolean get() = voiceMode == "googleUK"
    fun approved(key: String) = prefs.getStringSet("approved", emptySet()).orEmpty().contains(key)
    fun remember(plan: VoiceProvider, consent: Boolean) {
        val edit = prefs.edit().putString("recognizer", plan.selection).putString("language", plan.language)
        if (plan.networkCapable && consent) {
            // Bound old configurations; updates/settings changes have different keys and need review.
            val approvals = prefs.getStringSet("approved", emptySet()).orEmpty().toMutableSet()
            approvals.remove(plan.key)
            edit.putStringSet("approved", (approvals.toList().takeLast(31) + plan.key).toSet())
        }
        edit.apply()
    }
    fun revoke() { prefs.edit().remove("approved").apply() }
    fun useSystemVoice(value: Boolean) { prefs.edit().putString("voiceMode", if (value) "system" else "googleUK").apply() }
}
