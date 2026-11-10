package com.bobmobile

/** Counts fetching AND published preparations. No caller work runs under the registry lock. */
internal class SurfacePreparation<T : Any>(private val limit: Int) {
    private val pending = mutableMapOf<String, Reservation>()
    private var occupied = 0

    @Synchronized fun reserve(): Reservation? {
        if (occupied >= limit) return null
        occupied++
        return Reservation()
    }

    /** Both release and consume transfer ownership exactly once and recover the slot. */
    @Synchronized fun take(handle: String?): T? = pending[handle]?.cancel()

    internal inner class Reservation internal constructor() {
        private var active = true
        private var handle: String? = null
        private var value: T? = null

        fun publish(handle: String, value: T) = synchronized(this@SurfacePreparation) {
            check(active && this.handle == null && !pending.containsKey(handle))
            this.handle = handle
            this.value = value
            pending[handle] = this
        }

        /** Returns only a still-owned published value; safe after a racing take/cancel. */
        fun cancel(): T? = synchronized(this@SurfacePreparation) {
            if (!active) return@synchronized null
            active = false
            occupied--
            handle?.let { pending.remove(it) }
            value.also { value = null }
        }
    }
}

/** Only complete immutable CSS is retained. The loader (and its Context) never is. */
internal class SurfaceFontCssCache {
    internal data class Loaded(val css: String, val complete: Boolean)
    @Volatile private var cached: String? = null

    fun get(load: () -> Loaded): String {
        cached?.let { return it }
        return synchronized(this) {
            cached ?: load().let { result ->
                if (result.complete) cached = result.css
                result.css
            }
        }
    }
}
