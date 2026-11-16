package com.bobmobile

/** Cross-thread revocation fence. Claims happen BEFORE posting to Android's main queue. */
internal class VoiceInputAdmission(private var foreground: Boolean, private var focused: Boolean) {
    data class Ticket(val id: String, val generation: Long)
    private var generation = 0L
    private var current: Ticket? = null
    private var closed = false
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
    @Synchronized fun release(ticket: Ticket) { if (current == ticket) current = null }
    @Synchronized fun cancel(id: String): Ticket? = current?.takeIf { it.id == id }?.also { current = null }
    @Synchronized fun foreground(value: Boolean): Ticket? {
        foreground = value
        return if (!value) revoke() else null
    }
    @Synchronized fun focus(value: Boolean): Ticket? {
        focused = value
        return if (!value) revoke() else null
    }
    @Synchronized fun close(): Ticket? { closed = true; return revoke() }
    private fun revoke(): Ticket? = current.also { current = null }
}
