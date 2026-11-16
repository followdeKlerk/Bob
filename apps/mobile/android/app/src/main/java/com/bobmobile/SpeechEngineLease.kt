package com.bobmobile

/** Testable ownership boundary: a failed shutdown must never lose the potentially live engine. */
internal class SpeechEngineLease<E>(private val stop: (E) -> Boolean, private val shutdown: (E) -> Unit) {
    var engine: E? = null
        private set
    fun attach(value: E) {
        check(engine == null) { "Previous speech engine cleanup is unresolved" }
        engine = value
    }
    fun cleanup(): Boolean {
        val current = engine ?: return true
        val stopped = try { stop(current) } catch (_: Exception) { false }
        // Independent attempt: a throwing stop must not skip shutdown.
        val shutDown = try { shutdown(current); true } catch (_: Exception) { false }
        val cleaned = stopped && shutDown
        if (cleaned) engine = null
        // Conservatively retain on EITHER failure, even when void shutdown returned normally.
        // Repeated stops cannot become a false success by forgetting this engine. Some broken
        // engines may require a full process close before dictation is safe again.
        return cleaned
    }
}

/** Keep unresolved leases reachable across React module invalidation/recreation within this process. */
internal class SpeechEngineCleanup<E> {
    private val unresolved = linkedSetOf<SpeechEngineLease<E>>()
    fun cleanup(lease: SpeechEngineLease<E>): Boolean {
        unresolved.add(lease)
        val iterator = unresolved.iterator()
        while (iterator.hasNext()) if (iterator.next().cleanup()) iterator.remove()
        return unresolved.isEmpty()
    }
}
