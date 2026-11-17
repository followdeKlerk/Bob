package com.bobmobile

/** Synchronous cross-thread revocation, independent of the main-thread cleanup queue. */
internal class SpeechAdmission {
    class Owner { internal var closed = false }
    data class Ticket(val owner: Owner, val id: String, val epoch: Long)
    private var epoch = 0L
    private var current: Ticket? = null
    @Synchronized fun claim(owner: Owner, id: String): Ticket? {
        if (owner.closed) return null
        return Ticket(owner, id, ++epoch).also { current = it }
    }
    @Synchronized fun accepts(ticket: Ticket) = !ticket.owner.closed && current == ticket
    @Synchronized fun release(ticket: Ticket) { if (current == ticket) current = null }
    @Synchronized fun cancel(owner: Owner, id: String): Ticket? = current?.takeIf { it.owner === owner && (id.isEmpty() || it.id == id) }?.also { current = null }
    @Synchronized fun cancelAll(): Ticket? = current.also { current = null }
    @Synchronized fun close(owner: Owner) { owner.closed = true; cancel(owner, "") }
    // Stop cannot be admitted between the final authority check and the speak attempt.
    @Synchronized fun admit(ticket: Ticket, enqueue: () -> Unit): Boolean {
        if (!accepts(ticket)) return false
        enqueue()
        return true
    }
}
