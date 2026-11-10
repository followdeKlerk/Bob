package com.bobmobile

/** Admission is explicit and one-shot; visibility/resume is never authority to reconnect. UI-thread only. */
internal class TerminalAdmission {
    var session: String? = null
        private set
    var phase: String = "closed"
        private set
    val admitted get() = phase == "starting" || phase == "running"

    fun admit(handle: String): Boolean {
        if (handle == session) return false
        session = handle
        phase = "starting"
        return true
    }
    fun running(): Boolean {
        if (phase != "starting") return false
        phase = "running"
        return true
    }
    fun finish(failed: Boolean = false): Boolean {
        if (!admitted) return false
        phase = if (failed) "failed" else "closed"
        return true
    }
}

/** Credentials stay only in native memory. Clock injection keeps expiry/consumption testable. */
internal class PreparedTerminalSessions(private val now: () -> Long) {
    private data class Pending(val config: BobTerminalConfig, val deadline: Long)
    private val pending = mutableMapOf<String, Pending>()
    @Synchronized fun put(config: BobTerminalConfig): String {
        val time = now()
        pending.entries.removeAll { it.value.deadline <= time }
        check(pending.size < 4)
        val handle = java.util.UUID.randomUUID().toString()
        pending[handle] = Pending(config, time + 15_000)
        return handle
    }
    @Synchronized fun take(handle: String): BobTerminalConfig? = pending.remove(handle)?.let {
        it.config.takeIf { _ -> it.deadline > now() }
    }
    @Synchronized fun remove(handle: String) { pending.remove(handle) }
}

/** Immutable before posting to React: old events must never acknowledge a later command/session. */
internal class TerminalStateSnapshot(val session: String, val phase: String, val message: String?,
    val ctrl: Boolean, completedSequence: Double) {
    val acknowledged: Double? = completedSequence.takeIf { it >= 0 }
}
