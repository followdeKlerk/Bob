package com.bobmobile

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.SocketTimeoutException
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.UUID

internal data class ConnectionPair(val backendId: String, val chat: Long)
internal class ConnectionProtocolException(val code: String = "protocol") : Exception()

/** No Android or JSON-library dependency: the wire is a tiny, bounded, flat status object. */
internal object ConnectionPolicy {
    const val MAX_BYTES = 1024
    const val HEARTBEAT_TIMEOUT_MS = 20_000L
    const val MAX_CHAT = 9007199254740991L
    fun identity(value: String): String {
        require(value.matches(Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")))
        return UUID.fromString(value).toString()
    }
    fun chat(value: Double): Long {
        require(value.isFinite() && value >= 1 && value <= MAX_CHAT.toDouble() && value == value.toLong().toDouble())
        return value.toLong()
    }
    fun token(value: String) { require(value.matches(Regex("[A-Za-z0-9_-]{32,128}"))) }
    fun terminalHttp(status: Int): String? = when (status) {
        401, 403, 409 -> "authorization"
        404 -> "backend-update"
        200, 408, 429 -> null
        in 500..599 -> null
        else -> "protocol" // Includes every redirect; never follow it with a bearer token.
    }
    fun retryMillis(attempt: Int, random: Double): Long {
        val base = minOf(30_000L, 1000L shl attempt.coerceIn(0, 5))
        return (base * (0.75 + random.coerceIn(0.0, 1.0) * 0.5)).toLong().coerceIn(1000L, 30_000L)
    }
    fun heartbeat(json: String, expected: ConnectionPair): String {
        try {
            if (json.toByteArray(Charsets.UTF_8).size > MAX_BYTES) throw ConnectionProtocolException()
            val fields = FlatJson(json).parse()
            if (fields.keys != setOf("backendId", "conversationId", "state", "observedAt")) throw ConnectionProtocolException()
            val id = fields["backendId"] ?: throw ConnectionProtocolException("identity")
            val chat = fields["conversationId"] ?: throw ConnectionProtocolException("identity")
            if (!id.quoted || !chat.value.matches(Regex("[1-9][0-9]{0,15}")) || chat.quoted ||
                identity(id.value) != expected.backendId || chat.value.toLongOrNull() != expected.chat) throw ConnectionProtocolException("identity")
            val state = fields["state"] ?: throw ConnectionProtocolException()
            if (!state.quoted || state.value !in setOf("idle", "working", "waiting")) throw ConnectionProtocolException()
            val observed = fields["observedAt"] ?: throw ConnectionProtocolException()
            // Server wall-clock milliseconds; freshness uses local monotonic receipt time, not clock agreement.
            if (observed.quoted || !observed.value.matches(Regex("[1-9][0-9]{0,15}")) || observed.value.toLong() > MAX_CHAT) throw ConnectionProtocolException()
            return state.value
        } catch (e: ConnectionProtocolException) { throw e }
          catch (_: Exception) { throw ConnectionProtocolException("identity") }
    }

    private data class Scalar(val value: String, val quoted: Boolean)
    private class FlatJson(private val text: String) {
        private var pos = 0
        private fun whitespace() { while (pos < text.length && text[pos] in " \r\n\t") pos++ }
        private fun take(c: Char) { whitespace(); if (pos >= text.length || text[pos++] != c) throw ConnectionProtocolException() }
        private fun string(): String {
            take('"'); val out = StringBuilder()
            while (pos < text.length) {
                val c = text[pos++]
                if (c == '"') return out.toString()
                if (c < ' ') throw ConnectionProtocolException()
                if (c != '\\') { out.append(c); continue }
                if (pos >= text.length) throw ConnectionProtocolException()
                when (val escaped = text[pos++]) {
                    '"', '\\', '/' -> out.append(escaped)
                    'b' -> out.append('\b'); 'f' -> out.append('\u000c'); 'n' -> out.append('\n'); 'r' -> out.append('\r'); 't' -> out.append('\t')
                    'u' -> {
                        if (pos + 4 > text.length) throw ConnectionProtocolException()
                        out.append(text.substring(pos, pos + 4).toIntOrNull(16)?.toChar() ?: throw ConnectionProtocolException()); pos += 4
                    }
                    else -> throw ConnectionProtocolException()
                }
            }
            throw ConnectionProtocolException()
        }
        fun parse(): Map<String, Scalar> {
            val result = linkedMapOf<String, Scalar>(); take('{')
            while (true) {
                val key = string(); take(':'); whitespace()
                val quoted = pos < text.length && text[pos] == '"'
                val value = if (quoted) string() else {
                    val start = pos
                    while (pos < text.length && text[pos] !in ",} \r\n\t") pos++
                    text.substring(start, pos)
                }
                if (result.put(key, Scalar(value, quoted)) != null || result.size > 4) throw ConnectionProtocolException()
                whitespace()
                if (pos < text.length && text[pos] == '}') { pos++; break }
                take(',')
            }
            whitespace(); if (pos != text.length) throw ConnectionProtocolException()
            return result
        }
    }
}

/** Caller owns synchronization. Selection changes and config retirement invalidate every old callback/action. */
internal class ConnectionScope {
    val nonce: String = UUID.randomUUID().toString()
    var selected: ConnectionPair? = null; private set
    var generation = 0L; private set
    fun select(pair: ConnectionPair?): Boolean {
        if (pair == selected) return false
        selected = pair; retire(); return true
    }
    fun retire() { generation++ }
    fun startTicket(pair: ConnectionPair): Long? = generation.takeIf { selected == pair }
    fun revokeStarts(backendId: String) {
        if (selected?.backendId == backendId) retire()
    }
    fun begin(pair: ConnectionPair): Long { require(selected == pair); retire(); return generation }
    fun accepts(epoch: Long, pair: ConnectionPair) = epoch == generation && selected == pair
    fun acceptsAction(nonce: String?, epoch: Long, pair: ConnectionPair) = nonce == this.nonce && accepts(epoch, pair)
}

/** At most 1 KiB per line AND whole SSE frame, strict UTF-8, no readLine/full-response buffering.
 * Comments are supported but cannot keep a stream alive without authenticated connection events. */
internal class ConnectionSseReader(private val input: InputStream, private val now: () -> Long) {
    private var lastHeartbeat = now()
    private var skipLf = false
    fun heartbeatReceived() { lastHeartbeat = now() }
    private fun line(budget: Int): Pair<String, Int>? {
        val out = ByteArrayOutputStream(); var consumed = 0
        while (true) {
            if (now() - lastHeartbeat > ConnectionPolicy.HEARTBEAT_TIMEOUT_MS) throw SocketTimeoutException()
            val b = input.read()
            if (b < 0) return null // An incomplete event at EOF is never dispatched.
            consumed++
            if (consumed > budget || out.size() >= ConnectionPolicy.MAX_BYTES) throw ConnectionProtocolException()
            if (skipLf) { skipLf = false; if (b == 10) continue }
            if (b == 10 || b == 13) {
                skipLf = b == 13
                val decoder = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
                val text = try { decoder.decode(ByteBuffer.wrap(out.toByteArray())).toString() } catch (_: Exception) { throw ConnectionProtocolException() }
                return text to consumed
            }
            out.write(b)
        }
    }
    fun next(): String? {
        var event: String? = null; val data = StringBuilder(); var size = 0
        while (true) {
            val (line, used) = line(ConnectionPolicy.MAX_BYTES - size) ?: return null
            size += used
            if (line.isEmpty()) {
                if (data.isNotEmpty()) {
                    if (event != "connection") throw ConnectionProtocolException()
                    return data.toString().removeSuffix("\n")
                }
                if (event != null) throw ConnectionProtocolException()
                size = 0; continue
            }
            if (line.startsWith(':')) continue
            val split = line.indexOf(':')
            val field = if (split < 0) line else line.substring(0, split)
            val value = if (split < 0) "" else line.substring(split + 1).removePrefix(" ")
            when (field) {
                "event" -> { if (event != null) throw ConnectionProtocolException(); event = value }
                "data" -> { data.append(value).append('\n'); if (data.length > ConnectionPolicy.MAX_BYTES) throw ConnectionProtocolException() }
                else -> throw ConnectionProtocolException() // No replay IDs, retry directives or other event types.
            }
        }
    }
}
