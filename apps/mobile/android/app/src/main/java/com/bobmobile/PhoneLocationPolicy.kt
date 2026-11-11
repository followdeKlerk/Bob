package com.bobmobile

import java.net.URI

internal object PhoneLocationPolicy {
    fun endpoint(value: String, debug: Boolean = false): String {
        val uri = URI(value)
        require(uri.userInfo == null && uri.query == null && uri.fragment == null && (uri.rawPath.isNullOrEmpty() || uri.rawPath == "/"))
        require((uri.scheme == "https" && uri.host?.lowercase()?.endsWith(".ts.net") == true) || (debug && uri.scheme == "http" && uri.host == "127.0.0.1" && uri.port in 1..65535))
        return value.trimEnd('/')
    }
    fun mayStart(previous: String?, identity: String, allowEnable: Boolean) = allowEnable || previous == identity
    fun fresh(fixNanos: Long, nowNanos: Long): Boolean = fixNanos > 0 && nowNanos >= fixNanos && nowNanos - fixNanos <= 30_000_000_000L
}

internal data class LocationConnection(val endpoint: String, val identity: String, val token: String)

/** Process-local handoff only. Identical refreshes reuse ownership; stop invalidates queued intents.
 * Callers use this same monitor when changing the opt-in or admitting service work. */
internal class PhoneLocationSessions {
    data class Session(val generation: Long, val config: LocationConnection)
    private var generation = 0L
    private var selected: Session? = null

    @Synchronized fun current(): Session? = selected
    @Synchronized fun refresh(config: LocationConnection): Session {
        selected?.let { if (it.config == config) return it }
        return Session(++generation, config).also { selected = it }
    }
    @Synchronized fun accepts(generation: Long) = selected?.generation == generation
    @Synchronized fun isCurrent(session: Session) = selected === session
    @Synchronized fun ifCurrent(session: Session, action: () -> Unit): Boolean {
        if (!isCurrent(session)) return false
        action()
        return true
    }
    @Synchronized fun stop(): Session? = selected.also { selected = null }
}
