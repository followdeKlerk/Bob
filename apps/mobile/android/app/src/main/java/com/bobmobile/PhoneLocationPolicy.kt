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
