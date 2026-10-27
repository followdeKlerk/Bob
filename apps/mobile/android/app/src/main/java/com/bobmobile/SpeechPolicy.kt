package com.bobmobile

/** Bounded UTF-16 chunks; never split a surrogate pair. No storage or networking. */
internal object SpeechPolicy {
    const val MAX_TEXT = 100_000
    fun chunks(text: String, limit: Int): List<String> {
        require(text.isNotBlank() && text.length <= MAX_TEXT) { "Reply must contain 1–100,000 characters." }
        require(limit >= 2)
        val result = mutableListOf<String>()
        var start = 0
        while (start < text.length) {
            var end = minOf(start + limit, text.length)
            if (end < text.length) {
                if (Character.isHighSurrogate(text[end - 1]) && Character.isLowSurrogate(text[end])) end--
                val boundary = (end - 1 downTo start + limit / 2).firstOrNull { text[it].isWhitespace() }
                if (boundary != null) end = boundary + 1
            }
            result.add(text.substring(start, end)); start = end
        }
        return result
    }
}
