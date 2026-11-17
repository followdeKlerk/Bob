package com.bobmobile

import android.content.SharedPreferences
import java.lang.reflect.Proxy
import org.junit.Assert.*
import org.junit.Test

/** In-memory Android preference interface; no speech engine, microphone or device performance claim. */
class VoicePreferencesTest {
    private fun storage(): SharedPreferences {
        val values = mutableMapOf<String, Any?>()
        val editor = Proxy.newProxyInstance(SharedPreferences.Editor::class.java.classLoader, arrayOf(SharedPreferences.Editor::class.java)) { proxy, method, args ->
            when (method.name) {
                "putString", "putBoolean", "putStringSet" -> { values[args!![0] as String] = args[1]; proxy }
                "remove" -> { values.remove(args!![0]); proxy }
                "apply" -> null
                "commit" -> true
                else -> error("Unexpected editor operation: ${method.name}")
            }
        } as SharedPreferences.Editor
        return Proxy.newProxyInstance(SharedPreferences::class.java.classLoader, arrayOf(SharedPreferences::class.java)) { _, method, args ->
            when (method.name) {
                "getString", "getBoolean", "getStringSet" -> values[args!![0]] ?: args[1]
                "edit" -> editor
                else -> error("Unexpected preference operation: ${method.name}")
            }
        } as SharedPreferences
    }
    private fun plan(key: String, language: String = "en-GB", mode: String = "platform") =
        VoiceProvider(mode, null, language, key, "Synthetic provider")

    @Test fun freshPreferencesReplaceTheAccidentalSystemLocaleWithUkEnglishWithoutInventingApproval() {
        val saved = VoicePreferences(storage())
        assertEquals("en-GB", saved.language)
        assertNull(saved.selection)
        assertFalse(saved.systemVoice)
        assertFalse(saved.googleVoice)
        assertFalse(saved.approved("google|v1|en-GB"))
    }
    @Test fun informedApprovalAndExplicitLanguageSurviveRecreationButNotProviderConfigChanges() {
        val storage = storage()
        val selected = plan("provider|version1|en-PL", "en-PL")
        VoicePreferences(storage).remember(selected, true)
        val restored = VoicePreferences(storage)
        assertEquals("en-PL", restored.language)
        assertEquals(selected.selection, restored.selection)
        assertTrue(restored.approved(selected.key))
        for (changed in listOf("other-provider|version1|en-PL", "provider|version2|en-PL", "provider|version1|en-GB", "provider|version1|en-PL|new-system-setting")) assertFalse(restored.approved(changed))
        restored.remember(selected, false)
        assertTrue(restored.approved(selected.key)) // Skipping the dialog cannot silently revoke its prior grant.
    }
    @Test fun revocationKeepsChoicesAndOfflineNeverGrantsNetworkApproval() {
        val storage = storage(); val saved = VoicePreferences(storage)
        val selected = plan("provider|version1|en-GB")
        saved.remember(selected, true); saved.useSystemVoice(true); saved.revoke()
        val restored = VoicePreferences(storage)
        assertFalse(restored.approved(selected.key)); assertEquals(selected.selection, restored.selection)
        assertEquals("en-GB", restored.language); assertTrue(restored.systemVoice)
        val offline = plan("local|en-GB", mode = "onDevice")
        restored.remember(offline, true); assertFalse(restored.approved(offline.key))
        restored.useSystemVoice(false); assertFalse(VoicePreferences(storage).systemVoice)
        assertTrue(VoicePreferences(storage).googleVoice)
    }
    @Test fun rememberedConfigurationsAreBounded() {
        val saved = VoicePreferences(storage())
        for (index in 0..40) saved.remember(plan("provider-update-$index"), true)
        assertTrue(saved.approved("provider-update-40")); assertFalse(saved.approved("provider-update-0"))
    }
}
