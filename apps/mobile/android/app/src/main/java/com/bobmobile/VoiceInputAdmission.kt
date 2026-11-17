package com.bobmobile

/** Cross-thread revocation fence. Claims happen BEFORE posting to Android's main queue. */
internal class VoiceInputAdmission(private var foreground: Boolean, private var focused: Boolean) {
    data class Ticket(val id: String, val generation: Long)
    private var generation = 0L
    private var current: Ticket? = null
    private var closed = false
    private var external: Ticket? = null
    @Synchronized fun claim(id: String): Ticket? {
        if (closed || !foreground || !focused || current != null) return null
        return Ticket(id, ++generation).also { current = it }
    }
    @Synchronized fun accepts(ticket: Ticket) = !closed && foreground && focused && current == ticket
    @Synchronized fun admit(ticket: Ticket, start: () -> Unit): Boolean {
        if (!accepts(ticket)) return false
        start() // Linearize final admission with cross-thread cancel; no check/start gap.
        return true
    }
    /** Only a deliberately launched, token-owned speech Activity may borrow foreground. */
    @Synchronized fun handoff(ticket: Ticket): Boolean {
        if (!accepts(ticket)) return false
        external = ticket
        return true
    }
    @Synchronized fun ownsHandoff(ticket: Ticket) = !closed && current == ticket && external == ticket
    @Synchronized fun release(ticket: Ticket) { if (current == ticket) { current = null; external = null } }
    @Synchronized fun cancel(id: String): Ticket? = current?.takeIf { it.id == id }?.also { current = null; external = null }
    @Synchronized fun foreground(value: Boolean): Ticket? {
        foreground = value
        return if (!value && external == null) revoke() else null
    }
    @Synchronized fun focus(value: Boolean): Ticket? {
        focused = value
        return if (!value && external == null) revoke() else null
    }
    @Synchronized fun cancelCurrent(): Ticket? = revoke()
    @Synchronized fun close(): Ticket? { closed = true; return revoke() }
    private fun revoke(): Ticket? = current.also { current = null; external = null }
}

/** Native audio exclusion also survives React module replacement. Main-thread owned. */
internal object NativeVoiceCapture {
    private var owner: Any? = null
    private var retired: (() -> Boolean)? = null
    val active get() = owner != null
    fun claim(value: Any): Boolean { if (!cleanupRetired() || owner != null) return false; owner = value; return true }
    fun release(value: Any) { if (owner === value) { owner = null; retired = null } }
    fun retire(value: Any, cleanup: () -> Boolean): Boolean {
        if (owner !== value) return true
        retired = cleanup
        return cleanupRetired()
    }
    fun cleanupRetired(): Boolean {
        val cleanup = retired ?: return true // Never stop a currently admitted capture here.
        if (!runCatching(cleanup).getOrDefault(false)) return false
        retired = null; owner = null
        return true
    }
}
