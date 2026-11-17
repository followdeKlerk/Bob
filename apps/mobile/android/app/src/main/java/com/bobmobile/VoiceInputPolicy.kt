package com.bobmobile

/** Main-thread admission/finalization policy. No Android dependencies or transcript retention. */
internal class VoiceInputPolicy {
    companion object {
        const val LISTEN_MS = 20_000L
        const val FINISH_MS = 5_000L
        const val MAX_TEXT = 16_000
        fun mode(onDevice: Boolean, platform: Boolean): String = when {
            onDevice -> "onDevice"
            platform -> "platform"
            else -> "unavailable"
        }
        fun permitted(mode: String, onDevice: Boolean, platform: Boolean, consent: Boolean): Boolean = when (mode) {
            "onDevice" -> onDevice
            "platform" -> platform && consent
            else -> false
        }
        fun error(code: Int): String = when (code) {
            1, 2 -> "The Android speech engine could not connect. Try again or type your message."
            3 -> "The microphone is unavailable. Check Android microphone access and try again."
            6, 7 -> "No speech was recognized. Tap the mic and try again."
            8 -> "Android speech recognition is busy. Wait a moment, then tap the mic again."
            9 -> "Microphone permission is unavailable. Check Bob’s Microphone permission in Android Settings."
            12, 13 -> "This speech engine has no installed model for your language. Use Speech options to choose the selected service or speech screen, or download the language model in Android speech settings. No online fallback was started."
            else -> "Android speech recognition was interrupted or unavailable. Tap the mic to try again."
        }
    }
    var id: String? = null
        private set
    private var generation = 0L
    private var finishing = false
    fun begin(request: String): Long {
        check(id == null) { "busy" }
        require(request.isNotBlank() && request.length <= 100)
        id = request; finishing = false
        return ++generation
    }
    fun current(token: Long) = id != null && token == generation
    fun finish(token: Long): Boolean {
        if (!current(token) || finishing) return false
        finishing = true
        return true
    }
    fun end(token: Long): String? {
        if (!current(token)) return null
        val request = id
        id = null; finishing = false; generation++
        return request
    }
}
