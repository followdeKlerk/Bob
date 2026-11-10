package com.bobmobile

import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

internal data class PdfRect(val left: Float, val top: Float, val right: Float, val bottom: Float) {
    val width get() = right - left
    val height get() = bottom - top
}
internal data class PdfRasterPlan(val region: PdfRect, val scale: Float, val width: Int, val height: Int)
internal data class PdfRasterKey(val page: Int, val generation: Long, val plan: PdfRasterPlan)

/** Pure PDF-point/screen-pixel geometry; never scales the app's text or controls. */
internal class PdfViewport(val margin: Float) {
    var width = 0; private set
    var height = 0; private set
    var pageWidth = 0; private set
    var pageHeight = 0; private set
    var zoom = 1f; private set
    var left = 0f; private set
    var top = 0f; private set
    val ready get() = width > 0 && height > 0 && pageWidth > 0 && pageHeight > 0
    val fitScale get() = if (ready) min(max(1f, width - 2 * margin) / pageWidth, max(1f, height - 2 * margin) / pageHeight) else 1f
    val scale get() = fitScale * zoom
    val right get() = left + pageWidth * scale
    val bottom get() = top + pageHeight * scale
    val atLeft get() = left >= margin - 1f || pageWidth * scale <= width - 2 * margin
    val atRight get() = right <= width - margin + 1f || pageWidth * scale <= width - 2 * margin
    val centerX get() = if (ready) ((width / 2f - left) / (pageWidth * scale)).coerceIn(0f, 1f) else 0.5f
    val centerY get() = if (ready) ((height / 2f - top) / (pageHeight * scale)).coerceIn(0f, 1f) else 0.5f

    fun configure(width: Int, height: Int, pageWidth: Int, pageHeight: Int, preserve: Boolean = true) {
        val x = if (preserve) centerX else 0.5f; val y = if (preserve) centerY else 0.5f
        val previousZoom = if (preserve) zoom else 1f
        require(width > 0 && height > 0 && pageWidth in 1..1_000_000 && pageHeight in 1..1_000_000)
        this.width = width; this.height = height; this.pageWidth = pageWidth; this.pageHeight = pageHeight
        restore(previousZoom, x, y)
    }
    fun restore(value: Float, x: Float, y: Float) {
        zoom = if (value.isFinite()) value.coerceIn(1f, 6f) else 1f
        val cx = if (x.isFinite()) x.coerceIn(0f, 1f) else 0.5f
        val cy = if (y.isFinite()) y.coerceIn(0f, 1f) else 0.5f
        left = width / 2f - cx * pageWidth * scale; top = height / 2f - cy * pageHeight * scale
        constrain()
    }
    fun fit() = restore(1f, 0.5f, 0.5f)
    fun zoomAt(value: Float, x: Float, y: Float) {
        if (!ready || !value.isFinite() || !x.isFinite() || !y.isFinite()) return
        val px = (x - left) / scale; val py = (y - top) / scale
        zoom = value.coerceIn(1f, 6f)
        left = x - px * scale; top = y - py * scale; constrain()
    }
    fun pan(dx: Float, dy: Float) {
        if (!dx.isFinite() || !dy.isFinite()) return
        left += dx; top += dy; constrain()
    }
    private fun constrain() {
        if (!ready) return
        val w = pageWidth * scale; val h = pageHeight * scale
        left = if (w <= width - 2 * margin) (width - w) / 2f else left.coerceIn(width - margin - w, margin)
        top = if (h <= height - 2 * margin) (height - h) / 2f else top.coerceIn(height - margin - h, margin)
    }
    fun visible(): PdfRect = PdfRect(
        max(0f, -left / scale), max(0f, -top / scale),
        min(pageWidth.toFloat(), (width - left) / scale), min(pageHeight.toFloat(), (height - top) / scale)
    )
    companion object {
        const val BASE_PIXELS = 2_000_000
        const val DETAIL_PIXELS = 3_000_000
        fun raster(region: PdfRect, desiredScale: Float, pixelLimit: Int, sideLimit: Int = 3072): PdfRasterPlan {
            require(region.width > 0 && region.height > 0 && listOf(region.left, region.top, region.right, region.bottom, desiredScale).all { it.isFinite() })
            require(desiredScale > 0 && pixelLimit > 0 && sideLimit > 0)
            val area = region.width.toDouble() * region.height
            var scale = min(desiredScale.toDouble(), min(sideLimit / max(region.width, region.height).toDouble(), sqrt(pixelLimit / area)))
            var w: Int; var h: Int
            do {
                w = max(1, ceil(region.width * scale).toInt()).coerceAtMost(sideLimit)
                h = max(1, ceil(region.height * scale).toInt()).coerceAtMost(sideLimit)
                if (w.toLong() * h > pixelLimit) scale *= 0.99
            } while (w.toLong() * h > pixelLimit)
            val actual = scale.toFloat()
            return PdfRasterPlan(PdfRect(region.left, region.top, region.left + w / actual, region.top + h / actual), actual, w, h)
        }
        // Eligibility is captured at touch-down, never earned by panning to an edge.
        fun swipe(dx: Float, dy: Float, threshold: Float, startedAtLeft: Boolean, startedAtRight: Boolean, multiTouch: Boolean): Int {
            if (multiTouch || !dx.isFinite() || !dy.isFinite() || abs(dx) < threshold || abs(dx) < abs(dy) * 1.35f) return 0
            return if (dx < 0 && startedAtRight) 1 else if (dx > 0 && startedAtLeft) -1 else 0
        }
    }
}

/** At most one running/awaiting-UI operation and one replaceable pending request. */
internal class LatestPdfWork<T> {
    private var scheduled = false
    private var closed = false
    private var pending: T? = null
    @Synchronized fun offer(value: T, skipIfIdle: Boolean = false): Boolean {
        // Even a published match must replace pending work: an in-flight tile may supersede it.
        if (closed || (skipIfIdle && !scheduled)) return false
        pending = value
        if (scheduled) return false
        scheduled = true; return true
    }
    @Synchronized fun take(): T? = pending.also { pending = null }
    @Synchronized fun complete(): Boolean {
        if (closed || pending == null) { scheduled = false; return false }
        return true
    }
    @Synchronized fun close() { closed = true; pending = null }
}
