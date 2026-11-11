package com.bobmobile

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.File
import java.io.InputStream

class Utf8PreviewTest {
    private val notice = Utf8Preview.TRUNCATION_NOTICE
    private fun preview(bytes: ByteArray, limit: Int = Utf8Preview.BYTE_LIMIT) = Utf8Preview.read(ByteArrayInputStream(bytes), limit)
    private fun preview(text: String, limit: Int = Utf8Preview.BYTE_LIMIT) = preview(text.toByteArray(Charsets.UTF_8), limit)

    @Test fun emptyAndShortFilesRemainUnchanged() {
        for (text in listOf("", "hello", "é日本語👋", "a\n\tb")) assertEquals(text, preview(text))
    }
    @Test fun asciiExactLimitIsNotTruncatedButOneByteOverIsLabeled() {
        val exact = "x".repeat(Utf8Preview.BYTE_LIMIT)
        assertEquals(exact, preview(exact))
        assertEquals(exact + notice, preview(exact + "y"))
    }
    @Test fun originalLongNonAsciiRegressionIsLabeledWithoutAnInventedReplacement() {
        // Original 200001-byte prefix ended midway through é and never showed a notice.
        val text = "é".repeat(150000)
        assertEquals("é".repeat(100000) + notice, preview(text))
        assertEquals("a" + "é".repeat(99999) + notice, preview("a" + text))
    }
    @Test fun allTwoThreeAndFourByteBoundarySplitsDropOnlyTheIncompleteCodePoint() {
        for (codePoint in listOf("é", "日", "👋")) {
            val width = codePoint.toByteArray(Charsets.UTF_8).size
            for (included in 1 until width) {
                val prefix = "x".repeat(Utf8Preview.BYTE_LIMIT - included)
                val result = preview(prefix + codePoint + "tail")
                assertEquals("width=$width included=$included", prefix + notice, result)
                assertFalse(result.contains('\uFFFD'))
            }
        }
    }
    @Test fun completeMultibyteEndingsAtExactBudgetRemainAndSuffixesAreLabeled() {
        for (codePoint in listOf("é", "日", "👋")) {
            val prefix = "x".repeat(Utf8Preview.BYTE_LIMIT - codePoint.toByteArray(Charsets.UTF_8).size)
            val exact = prefix + codePoint
            assertEquals(exact, preview(exact))
            assertEquals(exact + notice, preview(exact + "!"))
        }
    }
    @Test fun malformedAndIncompleteRealEofStillUseUtf8ReplacementDecoding() {
        for (bytes in listOf(
            byteArrayOf(0xff.toByte(), 0x61, 0xc3.toByte(), 0x28),
            byteArrayOf(0xe2.toByte(), 0x82.toByte()),
            byteArrayOf(0xed.toByte(), 0xa0.toByte(), 0x80.toByte()),
            byteArrayOf(0xf4.toByte(), 0x90.toByte(), 0x80.toByte(), 0x80.toByte())
        )) {
            assertEquals(String(bytes, Charsets.UTF_8), preview(bytes))
            assertEquals(String(bytes, Charsets.UTF_8), preview(bytes, bytes.size))
            assertEquals(String(bytes, Charsets.UTF_8) + notice, preview(bytes + byteArrayOf(0x61), bytes.size))
        }
    }
    @Test fun malformedLookaheadKeepsTheReplacementForAnInvalidPendingPrefix() {
        for ((prefix, next) in listOf(
            byteArrayOf(0xc3.toByte()) to 0x28,
            byteArrayOf(0xe0.toByte()) to 0x80,
            byteArrayOf(0xf4.toByte()) to 0x90,
            byteArrayOf(0xe2.toByte(), 0x82.toByte()) to 0x28
        )) assertEquals("\uFFFD" + notice, preview(prefix + byteArrayOf(next.toByte()), prefix.size))
    }
    @Test fun fourByteMalformedLookaheadPreservesOnlyTheInBudgetReplacement() {
        val prefix = byteArrayOf(0xf0.toByte(), 0x90.toByte(), 0x80.toByte())
        for (next in listOf(0x00, 0x41, 0x7f, 0xc0, 0xff)) {
            val bytes = prefix + byteArrayOf(next.toByte())
            assertEquals("next=$next", "\uFFFD" + notice, preview(bytes, 3))
            val padding = "x".repeat(Utf8Preview.BYTE_LIMIT - 3)
            assertEquals(padding + "\uFFFD" + notice, preview(padding.toByteArray() + bytes))
        }
        for (next in 0x80..0xbf) assertEquals(notice, preview(prefix + byteArrayOf(next.toByte()), 3))
    }
    @Test fun replacementPolicyAtRealEofMatchesTheExistingDecoderOnMalformedCorpus() {
        val random = java.util.Random(904)
        repeat(500) {
            val bytes = ByteArray(random.nextInt(81)); random.nextBytes(bytes)
            assertEquals(String(bytes, Charsets.UTF_8), preview(bytes))
        }
    }
    @Test fun readsNoMoreThanBudgetPlusOneEvenWithShortReadsOrZeroLengthProgress() {
        for (zeroRead in listOf(false, true)) {
            var consumed = 0
            val input = object : InputStream() {
                override fun read(): Int { consumed++; return 'x'.code }
                override fun read(bytes: ByteArray, offset: Int, length: Int): Int {
                    if (zeroRead) return 0
                    val n = minOf(3, length)
                    repeat(n) { bytes[offset + it] = 'x'.code.toByte() }; consumed += n; return n
                }
            }
            assertEquals("x".repeat(7) + notice, Utf8Preview.read(input, 7))
            assertEquals(8, consumed)
        }
        assertEquals("", preview("", 0)); assertEquals(notice, preview("é", 0))
    }
    @Test fun nativeTextPreviewUsesTheHelperWithoutChangingOriginalFileScopeOrOpenSaveFallback() {
        // Source contract only: no Activity/provider/UI execution.
        val source = File("src/main/java/com/bobmobile/BobPreviewActivity.kt").readText()
        assertTrue(source.contains("file.inputStream().use { Utf8Preview.read(it) }"))
        assertTrue(source.contains("setTextIsSelectable(true); this.text = text"))
        assertFalse(source.contains("text.take(200000)")); assertFalse(source.contains("text.length > 200000"))
        assertTrue(source.contains("file.parentFile == root && file.isFile"))
        assertTrue(source.contains("Close this preview and use Open or Save from the attachment."))
        assertFalse(source.contains("file.write")); assertFalse(source.contains("file.outputStream"))
    }
}
