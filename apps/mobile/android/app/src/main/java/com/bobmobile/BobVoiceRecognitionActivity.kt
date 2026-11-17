package com.bobmobile

// Activity-only recognition handoff adapted from Omalauncher SpeakNowActivity.kt (MIT).
// Copyright (c) 2026 Simon Schubert and contributors. See upstream/omalauncher/source/LICENSE.
import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.speech.RecognizerIntent

/** In-memory, one-use handoff. Process death/recreation never restores submission authority. Main thread. */
internal object VoiceActivityHandoff {
    data class Request(val id: String, val intent: Intent, val result: (String?) -> Unit)
    var pending: Request? = null
        private set
    private var activity: BobVoiceRecognitionActivity? = null
    private var retiring: Pair<String, BobVoiceRecognitionActivity>? = null
    fun begin(request: Request) { check(pending == null); pending = request }
    fun attach(id: String, owner: BobVoiceRecognitionActivity): Intent? {
        val request = pending?.takeIf { it.id == id } ?: return null
        activity = owner
        return request.intent
    }
    fun finish(id: String, text: String?) {
        val request = pending?.takeIf { it.id == id } ?: return
        pending = null; activity = null
        request.result(text)
    }
    fun cancel(id: String) {
        if (pending?.id == id) {
            pending = null // Revoke result authority before attempting external cleanup.
            activity?.let { retiring = id to it }; activity = null
        }
        val old = retiring?.takeIf { it.first == id } ?: return
        old.second.revoke() // Retain failed cleanup across module recreation for Retry Stop.
        retiring = null
    }
}

/** Not exported, not a second chat/speech service. Owns exactly the provider Activity opened by a deliberate tap. */
class BobVoiceRecognitionActivity : Activity() {
    private val requestCode = 701
    private var id = ""
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        id = intent.getStringExtra("voiceRequest").orEmpty()
        if (savedInstanceState != null) { VoiceActivityHandoff.finish(id, null); finish(); return }
        val ask = VoiceActivityHandoff.attach(id, this)
        if (ask == null) { finish(); return }
        try { @Suppress("DEPRECATION") startActivityForResult(ask, requestCode) }
        catch (_: Exception) { VoiceActivityHandoff.finish(id, null); finish() }
    }
    @Deprecated("Activity result compatibility for Android speech-provider activities")
    override fun onActivityResult(request: Int, result: Int, data: Intent?) {
        super.onActivityResult(request, result, data)
        if (request != requestCode) return
        val heard = data?.takeIf { result == RESULT_OK }?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        VoiceActivityHandoff.finish(id, heard)
        finish()
    }
    internal fun revoke() {
        @Suppress("DEPRECATION") finishActivity(requestCode)
        finish()
    }
    override fun onDestroy() {
        if (isFinishing) VoiceActivityHandoff.finish(id, null)
        super.onDestroy()
    }
}
