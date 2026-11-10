package com.bobmobile

internal object MediaPlaybackPolicy {
    fun session(value: String): String {
        require(Regex("^media-[1-9][0-9]{0,15}$").matches(value)) { "Invalid media session" }
        return value
    }
    fun position(value: Double): Int {
        require(value.isFinite() && value % 1.0 == 0.0 && value in 0.0..2147483647.0) { "Invalid media position" }
        return value.toInt()
    }
    fun seek(position: Int, duration: Int): Int = if (duration > 0) minOf(position, duration - 1) else 0
}
