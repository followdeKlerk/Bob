package com.bobmobile

import org.json.JSONObject
import java.io.Closeable
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

/** Test-only authenticated loopback HTTP fixture, never a production backend. */
internal class VisualDataFixture(val id: String, private val html: String? = null, initial: JSONObject? = null) : Closeable {
    private val server = ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"))
    val endpoint = "http://127.0.0.1:${server.localPort}"
    val reads = AtomicInteger()
    private val current = AtomicReference<String>()
    @Volatile private var closed = false
    init {
        advance(1, "First data", 0)
        if (html != null) current.set((initial?.let { JSONObject(it.toString()) } ?: JSONObject().put("revision", 0).put("data", JSONObject.NULL).put("updatedAt", JSONObject.NULL)).put("id", id).put("conversationId", 1).toString())
        thread(name = "inline-data-fixture", isDaemon = true) {
            while (!closed) try {
                server.accept().use { socket ->
                    socket.soTimeout = 3000
                    val reader = socket.getInputStream().bufferedReader()
                    val request = reader.readLine() ?: return@use
                    var authorized = false
                    var contentLength = 0
                    while (true) {
                        val line = reader.readLine() ?: break
                        if (line.isEmpty()) break
                        if (line.equals("Authorization: Bearer no-credentials", true)) authorized = true
                        if (line.startsWith("Content-Length:", true)) contentLength = line.substringAfter(':').trim().toInt()
                    }
                    require(contentLength in 0..65536)
                    repeat(contentLength) { reader.read() }
                    val dataPath = "/v1/chats/1/ui/$id/data?after="
                    val isData = request.startsWith("GET $dataPath")
                    val value = snapshot()
                    val after = request.substringAfter("?after=", "").substringBefore(' ').toLongOrNull()
                    val body = if (!authorized) JSONObject().put("error", "Unauthorized")
                    else if (request.startsWith("POST /v1/chats/1/ui/$id/open ") && html != null) {
                        JSONObject().put("id", id).put("kind", "visual").put("title", "Reported fixture").put("html", html).put("presentation", "inline").put("allowedTools", org.json.JSONArray()).put("capability", "test-only").put("visualData", value)
                    } else if (isData) {
                        reads.incrementAndGet()
                        if (after == value.getLong("revision")) JSONObject().put("id", id).put("conversationId", 1).put("revision", after).put("unchanged", true) else value
                    } else JSONObject().put("closed", true)
                    val bytes = body.toString().toByteArray(Charsets.UTF_8)
                    socket.getOutputStream().use { output ->
                        output.write("HTTP/1.1 ${if (authorized) "200 OK" else "401 Unauthorized"}\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray())
                        output.write(bytes); output.flush()
                    }
                }
            } catch (_: Exception) { if (closed) break }
        }
    }
    fun advance(revision: Long, text: String, height: Int) {
        current.set(JSONObject().put("id", id).put("conversationId", 1).put("revision", revision).put("updatedAt", revision)
            .put("data", JSONObject().put("text", text).put("height", height)).toString())
    }
    fun snapshot() = JSONObject(current.get())
    override fun close() { closed = true; server.close() }
}
