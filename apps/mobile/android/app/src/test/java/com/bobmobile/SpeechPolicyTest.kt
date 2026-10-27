package com.bobmobile

import org.junit.Assert.*
import org.junit.Test

class SpeechPolicyTest {
    @Test fun chunksAreBoundedAndPreserveEveryCharacter() {
        val text = "Hello world. ".repeat(1000)
        val chunks = SpeechPolicy.chunks(text, 127)
        assertEquals(text, chunks.joinToString(""))
        assertTrue(chunks.all { it.isNotEmpty() && it.length <= 127 })
    }
    @Test fun emojiPairsAreNeverSplitAtTheBoundary() {
        val text = "a😀".repeat(2000)
        val chunks = SpeechPolicy.chunks(text, 4)
        assertEquals(text, chunks.joinToString(""))
        assertTrue(chunks.all { it.length <= 4 && !Character.isHighSurrogate(it.last()) && !Character.isLowSurrogate(it.first()) })
    }
    @Test fun invalidOrExcessiveRepliesFailInsteadOfSilentlyTruncating() {
        for (text in listOf("", "   ", "x".repeat(SpeechPolicy.MAX_TEXT + 1))) {
            try { SpeechPolicy.chunks(text, 3000); fail("Accepted invalid text") } catch (_: IllegalArgumentException) {}
        }
        assertEquals(SpeechPolicy.MAX_TEXT, SpeechPolicy.chunks("x".repeat(SpeechPolicy.MAX_TEXT), 3000).sumOf { it.length })
    }
}
