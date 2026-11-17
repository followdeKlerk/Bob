package dev.omalauncher.voice

import dev.omalauncher.linux.shellQuote
import org.json.JSONObject

/** Bob's separately paired voice companion; Pi is only a reused event parser, never the executable. */
class BobLink(write: (String) -> Unit) : AgentLink(write) {
    data class SessionOption(val id: String, val title: String)
    data class SessionPage(val items: List<SessionOption>, val next: String?)
    data class State(val session: String?, val recovery: Boolean, val attached: Boolean)
    sealed interface SelectionResult<out T> {
        data class Success<T>(val value: T) : SelectionResult<T>
        data class Failure(val message: String) : SelectionResult<Nothing>
    }

    var onState: (State) -> Unit = {}
    private var recoveryOnly = false
    private val transport = PiLink { line ->
        val command = JSONObject(line)
        if (recoveryOnly && command.optString("type") == "prompt") {
            recoveryOnly = false
            command.put("type", "recover")
        }
        write(command.toString())
    }
    private var nextId = 0
    private var turns = 0
    private var selecting = false
    private val calls = HashMap<String, Pair<String, (JSONObject) -> List<LinkEvent>>>()
    override val instructed = true

    override fun command(resume: String?) = "exec bob-voice-agent rpc --append-system-prompt ${shellQuote(VOICE_PROMPT)}"

    // Configuration/journal must load before Ready. Never fall back from failed Bob resume to a fresh chat.
    override fun open(resume: String?): List<LinkEvent> {
        call(JSONObject().put("type", "get_state")) { response ->
            val state = state(response) ?: return@call listOf(LinkEvent.Failed("Bob companion state unavailable"))
            if (state.recovery || resume == null) return@call ready(state)
            if (!validSession(resume)) return@call listOf(LinkEvent.Failed("Invalid Bob session reference"))
            call(JSONObject().put("type", "switch_session").put("sessionPath", resume)) { switched ->
                if (!switched.optBoolean("success")) return@call listOf(LinkEvent.Failed("Bob resume was not confirmed"))
                call(JSONObject().put("type", "get_state")) { checked ->
                    val confirmed = state(checked)
                    if (confirmed == null || confirmed.session != resume) {
                        listOf(LinkEvent.Failed("Bob resume was not confirmed"))
                    } else {
                        ready(confirmed)
                    }
                }
                emptyList()
            }
            emptyList()
        }
        return emptyList()
    }

    private fun ready(state: State): List<LinkEvent> {
        onState(state)
        return (state.session?.let { listOf(LinkEvent.Session(it)) } ?: emptyList()) + transport.open(null)
    }

    override fun prompt(text: String) {
        check(!selecting) { "Session selection is pending" }
        turns++
        transport.prompt(text)
    }

    /** Unlike an ordinary prompt, this cannot create work even if the pending receipt disappeared. */
    fun recover() {
        check(turns == 0 && !selecting) { "Voice work is already active" }
        recoveryOnly = true
        prompt("Recover the previous voice operation without submitting new input.")
    }

    override fun cancel() {
        if (turns > 0) turns = 1
        transport.cancel()
    }
    override fun answer(id: String, allow: Boolean, always: Boolean, instead: String?) = false

    fun listSessions(cursor: String? = null, callback: (SelectionResult<SessionPage>) -> Unit) {
        if (cursor != null && (cursor.isEmpty() || cursor.length > 4096)) {
            callback(SelectionResult.Failure("Invalid session-list cursor"))
            return
        }
        val request = JSONObject().put("type", "list_sessions")
        if (cursor != null) request.put("cursor", cursor)
        call(request) { response ->
            val page = runCatching {
                check(response.getBoolean("success"))
                val data = response.getJSONObject("data")
                val items = data.getJSONArray("items")
                check(items.length() <= 100)
                val options = (0 until items.length()).map { index ->
                    val item = items.getJSONObject(index)
                    val id = item.getString("id")
                    check(validId(id))
                    SessionOption(id, item.getString("title").filterNot(Char::isISOControl).take(160))
                }
                check(options.map { it.id }.distinct().size == options.size)
                val next = if (data.isNull("next")) null else data.getString("next").also { check(it.isNotEmpty() && it.length <= 4096) }
                SessionPage(options, next)
            }.getOrNull()
            callback(if (page == null) SelectionResult.Failure("Could not list Bob sessions") else SelectionResult.Success(page))
            emptyList()
        }
    }

    /** The caller must first show the selected title and obtain confirmation of exclusive voice use. */
    fun selectSession(id: String, callback: (SelectionResult<String>) -> Unit) {
        if (turns != 0 || selecting || !validId(id)) {
            callback(SelectionResult.Failure("Finish current work before selecting a Bob session"))
            return
        }
        selecting = true
        call(JSONObject().put("type", "select_session").put("sessionId", id).put("confirm", true)) { response ->
            val expected = "bob-voice:$id"
            if (response.optBoolean("success") && response.optJSONObject("data")?.optString("sessionFile") == expected) {
                callback(SelectionResult.Success(expected))
                selecting = false
                emptyList()
            } else {
                callback(SelectionResult.Failure("Bob session selection was not confirmed; restart voice before sending"))
                emptyList()
            }
        }
    }

    private fun call(command: JSONObject, callback: (JSONObject) -> List<LinkEvent>) {
        val id = "bob-selection-${++nextId}"
        calls[id] = command.getString("type") to callback
        write(command.put("id", id).toString())
    }

    override fun read(line: String): List<LinkEvent> {
        val value = runCatching { JSONObject(line) }.getOrNull()
        if (value?.optString("type") == "response") {
            val id = value.optString("id")
            val pending = calls[id]
            if (pending != null) {
                if (value.optString("command") != pending.first) return emptyList()
                calls.remove(id)
                return pending.second(value)
            }
            if (value.optString("command") == "get_state") state(value)?.let(onState)
        }
        return transport.read(line).also { events ->
            for (event in events) if (event is LinkEvent.Done) turns = (turns - 1).coerceAtLeast(0)
        }
    }

    private fun state(response: JSONObject): State? = runCatching {
        check(response.getBoolean("success"))
        val data = response.getJSONObject("data")
        val session = if (data.isNull("sessionFile")) null else data.getString("sessionFile").also { check(validSession(it)) }
        check(data.has("recoveryRequired") && data.has("attached"))
        State(session, data.getBoolean("recoveryRequired"), data.getBoolean("attached"))
    }.getOrNull()

    private fun validSession(value: String) = value.startsWith("bob-voice:") && validId(value.removePrefix("bob-voice:"))
    private fun validId(value: String) = value.matches(Regex("[1-9][0-9]{0,15}")) && (value.toLongOrNull() ?: Long.MAX_VALUE) <= 9007199254740991L
}
