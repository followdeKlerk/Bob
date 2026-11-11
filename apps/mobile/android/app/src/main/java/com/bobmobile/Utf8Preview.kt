package com.bobmobile

import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.CodingErrorAction

/** Byte-budgeted display only; the original file is never rewritten. */
internal object Utf8Preview {
    const val BYTE_LIMIT = 200000
    const val TRUNCATION_NOTICE = "\n[Preview truncated; download retains original bytes]"

    fun read(input: InputStream, byteLimit: Int = BYTE_LIMIT): String {
        require(byteLimit >= 0 && byteLimit < Int.MAX_VALUE)
        val bytes = ByteArray(byteLimit + 1); var count = 0
        while (count < bytes.size) {
            val n = input.read(bytes, count, bytes.size - count)
            if (n < 0) break
            if (n == 0) {
                val next = input.read(); if (next < 0) break
                bytes[count++] = next.toByte()
            } else count += n
        }
        val truncated = count > byteLimit
        val payload = minOf(count, byteLimit)
        val chars = CharBuffer.allocate(payload)
        val decoder = Charsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPLACE).onUnmappableCharacter(CodingErrorAction.REPLACE)
        // At a preview boundary, underflow leaves a valid incomplete sequence undecoded.
        // At real EOF, malformed/incomplete input still uses the existing U+FFFD policy.
        val source = ByteBuffer.wrap(bytes, 0, payload)
        decoder.decode(source, chars, !truncated)
        if (truncated && source.hasRemaining()) {
            // One lookahead can prove that the pending prefix is malformed (e.g. C3 + ASCII).
            // Keep its replacement, but never a character that consumes beyond the byte budget.
            source.limit(count)
            val boundary = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            // Four-byte decoders need room for a surrogate pair even to report malformed input.
            // Probe without publishing decoded lookahead; only in-budget malformed spans count.
            val probe = CharBuffer.allocate(2)
            while (source.hasRemaining()) {
                probe.clear()
                val result = boundary.decode(source, probe, false)
                if (!result.isMalformed || source.position() + result.length() > payload) break
                chars.put('\uFFFD')
                source.position(source.position() + result.length())
            }
        }
        chars.flip()
        return chars.toString() + if (truncated) TRUNCATION_NOTICE else ""
    }
}
