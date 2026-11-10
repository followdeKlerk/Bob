package com.bobmobile

/** One admitted command at a time, matching React's bounded FIFO. UI-thread only.
 * Admission is NOT completion: async clipboard/renderer work must retain its ticket.
 * Ticket identity, not just sequence, revokes callbacks across reset/close/re-entry. */
internal class TerminalControlOrder {
    class Ticket internal constructor(val sequence: Double, val action: String)
    var commandSequence = -1.0
        private set
    var completedSequence = -1.0
        private set
    private var pending: Ticket? = null

    fun admit(sequence: Double, action: String): Ticket? {
        if (!sequence.isFinite() || sequence < 0 || sequence > 9007199254740991.0 ||
            sequence % 1.0 != 0.0 || sequence <= commandSequence || pending != null) return null
        val ticket = Ticket(sequence, action)
        commandSequence = sequence
        pending = ticket
        return ticket
    }
    fun isPending(ticket: Ticket) = pending === ticket
    fun complete(ticket: Ticket): Boolean {
        if (!isPending(ticket)) return false
        completedSequence = ticket.sequence
        pending = null
        return true
    }
    fun revoke() { pending = null }
    fun reset() { revoke(); commandSequence = -1.0; completedSequence = -1.0 }
}
