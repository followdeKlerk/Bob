package com.bobmobile

/** Coordinates are physical screen pixels, before padding. A consumed safe area
 * or system resize already lowers hostBottom; never subtract either twice. */
internal object ImeLayoutPolicy {
    // Bounds are physical IME pixels, independent of the safe-area overlap.
    // A settled/initially visible IME must restore the expanded geometry too.
    fun fraction(imeBottom: Int, animationMaximum: Int, visible: Boolean): Double =
        if (animationMaximum > 0) (imeBottom.toDouble() / animationMaximum).coerceIn(0.0, 1.0)
        else if (visible && imeBottom > 0) 1.0 else 0.0
    fun overlap(hostBottom: Int, hostHeight: Int, windowBottom: Int, imeBottom: Int): Int =
        if (imeBottom <= 0 || hostHeight <= 0) 0
        else (hostBottom.toLong() - (windowBottom.toLong() - imeBottom)).coerceIn(0L, hostHeight.toLong()).toInt()
}
