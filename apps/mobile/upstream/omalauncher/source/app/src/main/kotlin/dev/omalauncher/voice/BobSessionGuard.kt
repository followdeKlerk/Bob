package dev.omalauncher.voice

/** Pure lifecycle guard shared by picker callbacks and voice submission; no Android state or IO. */
class BobSessionGuard {
    data class Ticket(val epoch: Long, val request: Long)
    private var epoch = 0L
    private var request = 0L
    var ready = false
        private set
    var recovery = false
        private set
    var blocked = false
        private set
    var picker = false
        private set
    var selecting = false
        private set
    val canSubmit get() = ready && !recovery && !blocked && !picker && !selecting
    val canChange get() = ready && !recovery && !blocked && !selecting

    fun reset() {
        epoch++
        request++
        ready = false
        recovery = false
        blocked = false
        picker = false
        selecting = false
    }
    fun reported(recovery: Boolean) {
        this.recovery = recovery
        ready = !blocked
    }
    fun refreshing() { ready = false }
    fun page(): Ticket? {
        if (!canChange) return null
        picker = true
        return Ticket(epoch, ++request)
    }
    fun current(ticket: Ticket) = ticket == Ticket(epoch, request) && picker
    fun choose(): Ticket? {
        if (!canChange || !picker) return null
        selecting = true
        return Ticket(epoch, ++request)
    }
    fun selected(ticket: Ticket, confirmed: Boolean): Boolean {
        if (!current(ticket) || !selecting) return false
        request++
        selecting = false
        blocked = !confirmed
        ready = confirmed
        picker = !confirmed
        return true
    }
    fun dismiss() {
        if (selecting) {
            blocked = true
            ready = false
        }
        selecting = false
        picker = false
        request++
    }
}
