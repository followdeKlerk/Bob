package com.bobmobile

import java.io.InputStream
import java.io.InputStreamReader
import java.net.SocketTimeoutException
import java.nio.charset.CodingErrorAction

internal class ConnectionRetryException : Exception()

internal const val CONNECTION_MAX_CHARS = 16 * 1024 * 1024
internal data class ConnectionFrame(val event: String, val data: String)

/** Incremental strict UTF-8 decoding. Neither consumed response text nor frame history is retained. */
internal class ChatSseReader(input: InputStream, private val now: () -> Long, private val limit: Int = CONNECTION_MAX_CHARS) {
    private val reader = InputStreamReader(input, Charsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT))
    private val buffer = CharArray(8192)
    private var position = 0
    private var count = 0
    private var lastData = now()
    private var skipLf = false
    fun received() { lastData = now() }
    private fun read(): Int {
        if (count < 0) return -1
        if (position == count) {
            // Check before every potentially blocking refill, including one-byte trickle reads.
            if (now() - lastData > ConnectionPolicy.HEARTBEAT_TIMEOUT_MS) throw SocketTimeoutException()
            count = reader.read(buffer); position = 0
            if (count < 0) return -1
        }
        return buffer[position++].code
    }
    fun next(): ConnectionFrame? {
        var event: String? = null
        val data = StringBuilder()
        var used = 0
        while (true) {
            val line = StringBuilder()
            if (now() - lastData > ConnectionPolicy.HEARTBEAT_TIMEOUT_MS) throw SocketTimeoutException()
            while (true) {
                if (used % 4096 == 0 && now() - lastData > ConnectionPolicy.HEARTBEAT_TIMEOUT_MS) throw SocketTimeoutException()
                val value = read()
                if (value < 0) return null // Never publish an incomplete frame at EOF.
                if (++used > limit + 1024) throw ConnectionProtocolException("overflow")
                if (skipLf) { skipLf = false; if (value == 10) continue }
                if (value == 10 || value == 13) { skipLf = value == 13; break }
                if (line.length >= limit + 1024) throw ConnectionProtocolException("overflow")
                line.append(value.toChar())
            }
            val text = line.toString()
            if (text.isEmpty()) {
                if (data.isNotEmpty()) {
                    if (event !in setOf("snapshot", "snapshot-patch", "heartbeat")) throw ConnectionProtocolException()
                    data.setLength(data.length - 1)
                    return ConnectionFrame(event!!, data.toString())
                }
                if (event != null) throw ConnectionProtocolException()
                used = 0; continue
            }
            if (text.startsWith(':')) continue
            val split = text.indexOf(':')
            val field = if (split < 0) text else text.substring(0, split)
            val value = if (split < 0) "" else text.substring(split + 1).removePrefix(" ")
            when (field) {
                "event" -> { if (event != null) throw ConnectionProtocolException(); event = value }
                "data" -> {
                    if (data.length.toLong() + value.length + 1 > limit.toLong() + 1) throw ConnectionProtocolException("overflow")
                    data.append(value).append('\n')
                }
                else -> throw ConnectionProtocolException()
            }
        }
    }
}

/** Strict JSON scanner, not a transcript object graph. Skips view contents without allocating them.
 * Splice offsets deliberately use Kotlin/JS UTF-16 code units, including split surrogate pairs. */
internal object ChatWire {
    fun snapshot(json: String, pair: ConnectionPair, limit: Int = CONNECTION_MAX_CHARS) {
        if (json.length > limit) throw ConnectionProtocolException("overflow")
        val p = Json(json)
        var backend: String? = null; var chat: Long? = null; var view = false
        p.obj { key -> when (key) {
            "backendId" -> backend = p.identityString()
            "conversationId" -> chat = p.identityChat()
            "view" -> {
                var entries = false; var docs = false
                p.obj { name -> when (name) {
                    "entries" -> { p.array(); entries = true }
                    "docs" -> { p.obj { p.skip() }; docs = true }
                    else -> p.skip()
                } }
                view = entries && docs
            }
            else -> p.skip()
        } }
        p.end()
        if (backend != pair.backendId || chat != pair.chat) throw ConnectionProtocolException("identity")
        if (!view) throw ConnectionProtocolException()
    }
    fun heartbeat(json: String, pair: ConnectionPair) {
        if (json.length > 1024) throw ConnectionProtocolException()
        val p = Json(json); var backend: String? = null; var chat: Long? = null; var observed = false
        p.obj { key -> when (key) {
            "backendId" -> backend = p.identityString()
            "conversationId" -> chat = p.identityChat()
            "observedAt" -> observed = p.integer() > 0
            else -> p.skip()
        } }; p.end()
        if (backend != pair.backendId || chat != pair.chat) throw ConnectionProtocolException("identity")
        if (!observed) throw ConnectionProtocolException()
    }
    fun patch(previous: String?, sequence: Long, raw: String, limit: Int = CONNECTION_MAX_CHARS): Pair<String, Long> {
        if (raw.length > limit) throw ConnectionProtocolException("overflow")
        val p = Json(raw); val values = mutableMapOf<String, Long>(); var insert: String? = null
        p.obj { key -> when (key) {
            "base", "sequence", "prefix", "remove", "length" -> values[key] = p.integer()
            "insert" -> insert = p.string()
            else -> p.skip()
        } }; p.end()
        val old = previous ?: throw ConnectionProtocolException()
        val prefix = values["prefix"] ?: throw ConnectionProtocolException()
        val remove = values["remove"] ?: throw ConnectionProtocolException()
        val addition = insert ?: throw ConnectionProtocolException()
        if (values["base"] != sequence || values["sequence"] != sequence + 1 || values["length"] != old.length.toLong() ||
            prefix > old.length || remove > old.length - prefix) throw ConnectionProtocolException()
        val length = old.length.toLong() - remove + addition.length
        if (length > limit) throw ConnectionProtocolException("overflow")
        return (old.substring(0, prefix.toInt()) + addition + old.substring((prefix + remove).toInt())) to (sequence + 1)
    }

    private class Json(private val text: String) {
        private var pos = 0
        private var depth = 0
        private fun ws() { while (pos < text.length && text[pos] in " \r\n\t") pos++ }
        private fun peek(): Char { ws(); return text.getOrNull(pos) ?: throw ConnectionProtocolException() }
        private fun take(c: Char) { if (peek() != c) throw ConnectionProtocolException(); pos++ }
        fun end() { ws(); if (pos != text.length) throw ConnectionProtocolException() }
        fun string(): String = quoted(true)!!
        fun identityString(): String = try { string() } catch (_: ConnectionProtocolException) { throw ConnectionProtocolException("identity") }
        fun identityChat(): Long = try { integer() } catch (_: ConnectionProtocolException) { throw ConnectionProtocolException("identity") }
        private fun quoted(keep: Boolean): String? {
            take('"'); val result = if (keep) StringBuilder() else null
            while (pos < text.length) {
                var c = text[pos++]
                if (c == '"') return result?.toString()
                if (c < ' ') throw ConnectionProtocolException()
                if (c == '\\') {
                    c = when (val escaped = text.getOrNull(pos++) ?: throw ConnectionProtocolException()) {
                        '"', '\\', '/' -> escaped
                        'b' -> '\b'; 'f' -> '\u000c'; 'n' -> '\n'; 'r' -> '\r'; 't' -> '\t'
                        'u' -> {
                            if (pos + 4 > text.length) throw ConnectionProtocolException()
                            val hex = text.substring(pos, pos + 4)
                            if (!hex.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }) throw ConnectionProtocolException()
                            pos += 4; hex.toInt(16).toChar()
                        }
                        else -> throw ConnectionProtocolException()
                    }
                }
                result?.append(c)
            }
            throw ConnectionProtocolException()
        }
        private fun number(): String {
            ws(); val start = pos
            if (text.getOrNull(pos) == '-') pos++
            if (text.getOrNull(pos) == '0') pos++ else {
                if (text.getOrNull(pos) !in '1'..'9') throw ConnectionProtocolException()
                while (text.getOrNull(pos) in '0'..'9') pos++
            }
            if (text.getOrNull(pos) == '.') {
                pos++; val begin = pos; while (text.getOrNull(pos) in '0'..'9') pos++
                if (pos == begin) throw ConnectionProtocolException()
            }
            if (text.getOrNull(pos) == 'e' || text.getOrNull(pos) == 'E') {
                pos++; if (text.getOrNull(pos) == '+' || text.getOrNull(pos) == '-') pos++
                val begin = pos; while (text.getOrNull(pos) in '0'..'9') pos++
                if (pos == begin) throw ConnectionProtocolException()
            }
            return text.substring(start, pos)
        }
        fun integer(): Long {
            val n = number().toDoubleOrNull() ?: throw ConnectionProtocolException()
            if (!n.isFinite() || n < 0 || n > ConnectionPolicy.MAX_CHAT || n != n.toLong().toDouble()) throw ConnectionProtocolException()
            return n.toLong()
        }
        private fun enter() { if (++depth > 128) throw ConnectionProtocolException() }
        fun obj(field: (String) -> Unit) {
            enter(); take('{'); val keys = mutableSetOf<String>()
            if (peek() != '}') while (true) {
                val key = string(); if (!keys.add(key)) throw ConnectionProtocolException()
                take(':'); field(key)
                if (peek() == '}') break
                take(',')
            }
            take('}'); depth--
        }
        fun array() {
            enter(); take('[')
            if (peek() != ']') while (true) { skip(); if (peek() == ']') break; take(',') }
            take(']'); depth--
        }
        fun skip() {
            when (peek()) {
                '{' -> obj { skip() }
                '[' -> array()
                '"' -> quoted(false)
                't' -> literal("true")
                'f' -> literal("false")
                'n' -> literal("null")
                else -> number()
            }
        }
        private fun literal(value: String) {
            if (!text.startsWith(value, pos)) throw ConnectionProtocolException()
            pos += value.length
        }
    }
}

/** Caller serializes this with selection/config changes. Counters survive cache/config retirement. */
internal class ChatStreamCache {
    var revision = 0L; private set
    var epoch = 0L; private set
    var snapshot: String? = null; private set
    private var receivedAt: Long? = null
    private var initial = false
    fun clear() { snapshot = null; receivedAt = null; initial = false }
    fun attempt() { epoch++; receivedAt = null; initial = false }
    fun snapshot(value: String, now: Long): Boolean {
        if (value.length > CONNECTION_MAX_CHARS) throw ConnectionProtocolException("overflow")
        val wasHealthy = healthy(now)
        snapshot = value; revision++; initial = true; receivedAt = now
        return !wasHealthy
    }
    /** A stale read never restarts transport; the next healthy receipt must still invalidate the UI. */
    fun heartbeat(now: Long): Boolean {
        val wasHealthy = healthy(now)
        if (initial) receivedAt = now
        return !wasHealthy && healthy(now)
    }
    fun age(now: Long): Long? = receivedAt?.let { (now - it).coerceAtLeast(0) }
    fun healthy(now: Long) = initial && age(now)?.let { it <= ConnectionPolicy.HEARTBEAT_TIMEOUT_MS } == true
    fun disconnected() { initial = false } // Retain latest complete snapshot while retrying, never call it fresh.
}

internal data class StreamObserver(val pair: ConnectionPair, val id: String)
internal class ChatStreamObserver {
    var observer: StreamObserver? = null; private set
    private var resumed = false
    private var dirty = false
    private var pending = false
    fun read(pair: ConnectionPair, id: String, selected: Boolean) {
        if (selected && observer != StreamObserver(pair, id)) { observer = StreamObserver(pair, id); pending = false; dirty = false }
        if (observer == StreamObserver(pair, id)) { pending = false; dirty = false }
    }
    fun release(id: String) { if (observer?.id == id) { observer = null; dirty = false; pending = false } }
    fun changed(pair: ConnectionPair) { if (observer?.pair == pair) dirty = true }
    fun lifecycle(active: Boolean) {
        if (active && !resumed && observer != null) { pending = false; dirty = true }
        resumed = active
    }
    fun take(): StreamObserver? {
        if (!resumed || pending || !dirty) return null
        dirty = false; pending = true; return observer
    }
    fun detach() { observer = null; resumed = false; dirty = false; pending = false }
}

/** Latest relevant Settings invalidation only. No paused React event queue or backend/status history. */
internal class ChatStateInvalidation {
    private var resumed = false
    private var latest: ConnectionPair? = null
    fun lifecycle(active: Boolean) { resumed = active }
    fun changed(pair: ConnectionPair) { latest = pair }
    fun take(): ConnectionPair? {
        if (!resumed) return null
        return latest.also { latest = null }
    }
    fun detach() { resumed = false; latest = null }
}

/** Timeout-backed, generation-owned lease. Worker activity only; no timer can keep a dead worker awake. */
internal class ConnectionWakeLease(private val acquire: (Long) -> Unit, private val release: () -> Unit) {
    companion object { const val TIMEOUT_MS = 120_000L; const val RENEW_MS = 30_000L }
    private var owner: Long? = null
    private var renewedAt = 0L
    @Synchronized fun activity(generation: Long, now: Long) {
        if (owner != generation) { clear(); acquire(TIMEOUT_MS); owner = generation; renewedAt = now }
        else if (now - renewedAt >= RENEW_MS) { acquire(TIMEOUT_MS); renewedAt = now }
    }
    @Synchronized fun clear(generation: Long? = null) {
        if (owner != null && (generation == null || generation == owner)) { owner = null; release() }
    }
}
