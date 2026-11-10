package com.bobmobile

import kotlin.math.abs
import kotlin.math.max

/** Local, single-pointer axis latch. Cancellation cannot be undone without a fresh DOWN. */
internal class ImageGesturePolicy(private val touchSlop: Float) {
    private enum class Axis { IGNORED, PENDING, HORIZONTAL, VERTICAL }
    private var axis = Axis.IGNORED
    private var downX = 0f
    private var downY = 0f
    private var dx = 0f
    var enabled = false
        set(value) { field = value; if (!value) cancel() }
    var gestureKey = 0
        set(value) { if (field != value) { field = value; cancel() } }
    val holdsParent: Boolean get() = axis == Axis.PENDING || axis == Axis.HORIZONTAL

    fun down(x: Float, y: Float, pointers: Int) {
        cancel()
        if (!enabled || pointers != 1) return
        downX = x; downY = y; axis = Axis.PENDING
    }
    fun move(x: Float, y: Float, pointers: Int) {
        if (pointers != 1) { cancel(); return }
        if (!holdsParent) return
        dx = x - downX
        val dy = y - downY
        if (axis == Axis.PENDING && max(abs(dx), abs(dy)) >= touchSlop) {
            axis = if (abs(dx) > abs(dy) * 1.2f) Axis.HORIZONTAL else Axis.VERTICAL
        }
    }
    fun translation(width: Float): Float? =
        if (axis == Axis.HORIZONTAL) dx.coerceIn(-width, width) else null
    fun cancel() { axis = Axis.IGNORED; dx = 0f }
}
