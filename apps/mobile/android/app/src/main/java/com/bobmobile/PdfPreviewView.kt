package com.bobmobile

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.view.ViewConfiguration
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.io.File
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

internal data class PdfPreviewState(val page: Int = 0, val pageCount: Int = 0, val loading: Boolean = true,
    val error: String? = null, val zoom: Float = 1f)

/** Native gestures and drawing only; PDFium/file work belongs to PdfRenderSession. */
internal class PdfPreviewView(context: Context) : View(context) {
    var onStateChanged: ((PdfPreviewState) -> Unit)? = null
    var currentState = PdfPreviewState(); private set
    private val main = Handler(Looper.getMainLooper())
    private val viewport = PdfViewport(12f * resources.displayMetrics.density)
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val paper = Paint().apply { color = Color.WHITE }
    private var session: PdfRenderSession? = null
    private var generation = 0L
    private var requestedBaseGeneration = -1L
    private var disposed = false
    private var base: PdfFrame? = null
    private var detail: PdfFrame? = null
    private var restore: Bundle? = null
    private var startX = 0f; private var startY = 0f
    private var lastX = 0f; private var lastY = 0f
    private var pinchX = 0f; private var pinchY = 0f
    private var leftEdge = false; private var rightEdge = false
    private var multiTouch = false; private var lockedToPan = false
    private var pageDirection = 0; private var pageDrag = 0f
    private var doubleTap = false
    private val slop = ViewConfiguration.get(context).scaledTouchSlop.toFloat()
    private val renderDetail = Runnable {
        if (disposed || base == null || !viewport.ready || currentState.loading) return@Runnable
        if (viewport.zoom <= 1.001f && base!!.plan.scale >= viewport.scale * 0.99f) { detail = null; invalidate(); return@Runnable }
        val plan = PdfViewport.raster(viewport.visible(), viewport.scale, PdfViewport.DETAIL_PIXELS)
        session?.detail(currentState.page, generation, plan)
    }
    private val pinch = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScaleBegin(detector: ScaleGestureDetector): Boolean {
            if (base == null) return false
            multiTouch = true; pageDirection = 0; pageDrag = 0f
            pinchX = detector.focusX; pinchY = detector.focusY
            return true
        }
        override fun onScale(detector: ScaleGestureDetector): Boolean {
            viewport.zoomAt(viewport.zoom * detector.scaleFactor, pinchX, pinchY)
            viewport.pan(detector.focusX - pinchX, detector.focusY - pinchY)
            pinchX = detector.focusX; pinchY = detector.focusY
            invalidate(); scheduleDetail(); return true
        }
        override fun onScaleEnd(detector: ScaleGestureDetector) { commitTransform() }
    }).apply { isQuickScaleEnabled = false }
    private val taps = GestureDetector(context, object : GestureDetector.SimpleOnGestureListener() {
        override fun onDown(event: MotionEvent) = true
        override fun onDoubleTap(event: MotionEvent): Boolean {
            if (base == null) return false
            doubleTap = true; pageDirection = 0; pageDrag = 0f
            if (viewport.zoom > 1.05f) viewport.fit() else viewport.zoomAt(2.5f, event.x, event.y)
            commitTransform(); return true
        }
    }).apply { setIsLongpressEnabled(false) }

    init { isFocusable = true; importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES }
    private fun state(value: PdfPreviewState) {
        currentState = value
        contentDescription = if (value.error != null) value.error else if (value.pageCount == 0) "Opening PDF"
            else "PDF page ${value.page + 1} of ${value.pageCount}, ${(value.zoom * 100).roundToInt()} percent zoom"
        onStateChanged?.invoke(value)
    }
    fun open(file: File, restored: Bundle? = null) {
        if (disposed) return
        session?.close(); generation++; base = null; detail = null; restore = restored
        state(PdfPreviewState()); invalidate()
        lateinit var openedSession: PdfRenderSession
        openedSession = PdfRenderSession(file, opened = { count, error ->
            if (!disposed && session === openedSession) {
                if (error != null) state(PdfPreviewState(loading = false, error = error))
                else {
                    val page = (restored?.getInt("page", 0) ?: 0).coerceIn(0, count - 1)
                    state(PdfPreviewState(page = page, pageCount = count)); requestPage()
                }
            }
        }, rendered = { frame, page, epoch, isDetail, error ->
            if (disposed || session !== openedSession || epoch != generation || page != currentState.page) {
                // Unpublished results have never entered a display list and are safe to recycle.
                frame?.bitmap?.recycle()
            } else if (frame == null) {
                if (!isDetail) state(currentState.copy(loading = false, error = error ?: "This page couldn't be displayed."))
                // A failed refinement never hides a readable base page.
            } else if (isDetail) {
                detail = frame; invalidate()
            } else {
                base = frame; detail = null
                viewport.configure(max(1, width), max(1, height), frame.pageWidth, frame.pageHeight, preserve = false)
                restore?.let { viewport.restore(it.getFloat("zoom", 1f), it.getFloat("centerX", 0.5f), it.getFloat("centerY", 0.5f)) }
                restore = null
                state(currentState.copy(loading = false, error = null, zoom = viewport.zoom)); invalidate(); scheduleDetail()
            }
        })
        session = openedSession
    }
    private fun requestPage() {
        if (!disposed && width > 0 && height > 0 && currentState.pageCount > 0 && requestedBaseGeneration != generation) {
            val owner = session ?: return
            requestedBaseGeneration = generation
            owner.page(currentState.page, generation, width, height, viewport.margin)
        }
    }
    fun goToPage(index: Int) {
        if (disposed || index !in 0 until currentState.pageCount || index == currentState.page) return
        generation++; main.removeCallbacks(renderDetail); base = null; detail = null; restore = null
        pageDrag = 0f; viewport.fit()
        state(currentState.copy(page = index, loading = true, error = null, zoom = 1f)); invalidate(); requestPage()
        sendAccessibilityEvent(AccessibilityEvent.TYPE_VIEW_SCROLLED)
    }
    fun fitPage() { if (base != null) { viewport.fit(); commitTransform() } }
    private fun scheduleDetail() { main.removeCallbacks(renderDetail); if (!disposed) main.postDelayed(renderDetail, 120) }
    private fun commitTransform() {
        if (disposed) return
        state(currentState.copy(zoom = viewport.zoom)); invalidate(); scheduleDetail()
    }
    fun saveState(): Bundle = Bundle().apply {
        val pending = restore
        putInt("page", if (currentState.pageCount == 0) pending?.getInt("page", 0) ?: 0 else currentState.page)
        putFloat("zoom", pending?.getFloat("zoom", 1f) ?: if (base == null) 1f else viewport.zoom)
        putFloat("centerX", pending?.getFloat("centerX", 0.5f) ?: if (base == null) 0.5f else viewport.centerX)
        putFloat("centerY", pending?.getFloat("centerY", 0.5f) ?: if (base == null) 0.5f else viewport.centerY)
    }
    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        if (w <= 0 || h <= 0 || disposed) return
        val frame = base
        if (frame == null) requestPage() else {
            viewport.configure(w, h, frame.pageWidth, frame.pageHeight); invalidate(); scheduleDetail()
        }
    }
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val background = base ?: return
        if (disposed || !viewport.ready) return
        val saved = canvas.save()
        canvas.translate(pageDrag, 0f)
        canvas.clipRect(viewport.left, viewport.top, viewport.right, viewport.bottom)
        canvas.drawRect(viewport.left, viewport.top, viewport.right, viewport.bottom, paper)
        fun draw(frame: PdfFrame) {
            val r = frame.plan.region
            canvas.drawBitmap(frame.bitmap, null, RectF(viewport.left + r.left * viewport.scale, viewport.top + r.top * viewport.scale,
                viewport.left + r.right * viewport.scale, viewport.top + r.bottom * viewport.scale), paint)
        }
        draw(background); detail?.let { draw(it) }; canvas.restoreToCount(saved)
    }
    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (disposed || currentState.pageCount == 0) return false
        if (event.actionMasked == MotionEvent.ACTION_DOWN) {
            startX = event.x; startY = event.y; lastX = event.x; lastY = event.y
            leftEdge = viewport.atLeft; rightEdge = viewport.atRight
            multiTouch = false; lockedToPan = false; pageDirection = 0; pageDrag = 0f; doubleTap = false
            main.removeCallbacks(renderDetail)
        } else if (event.pointerCount > 1) {
            multiTouch = true; pageDirection = 0; pageDrag = 0f
        }
        pinch.onTouchEvent(event); taps.onTouchEvent(event)
        when (event.actionMasked) {
            MotionEvent.ACTION_MOVE -> if (base != null && event.pointerCount == 1 && !pinch.isInProgress && !doubleTap) {
                val dx = event.x - startX; val dy = event.y - startY
                if (!multiTouch && !lockedToPan && pageDirection == 0 && (abs(dx) > slop || abs(dy) > slop)) {
                    pageDirection = PdfViewport.swipe(dx, dy, slop, leftEdge, rightEdge, false)
                    lockedToPan = pageDirection == 0
                }
                if (pageDirection != 0 && !multiTouch) {
                    val canTurn = currentState.page + pageDirection in 0 until currentState.pageCount
                    pageDrag = dx.coerceIn(-width.toFloat(), width.toFloat()) * if (canTurn) 1f else 0.15f
                } else viewport.pan(event.x - lastX, event.y - lastY)
                lastX = event.x; lastY = event.y; invalidate(); scheduleDetail()
            }
            MotionEvent.ACTION_POINTER_UP -> {
                val remaining = if (event.actionIndex == 0) 1 else 0
                if (remaining < event.pointerCount) { lastX = event.getX(remaining); lastY = event.getY(remaining) }
            }
            MotionEvent.ACTION_UP -> {
                val dx = event.x - startX; val dy = event.y - startY
                val delta = if (pageDirection != 0 && !doubleTap) PdfViewport.swipe(dx, dy, max(48f * resources.displayMetrics.density, width * 0.16f), leftEdge, rightEdge, multiTouch) else 0
                pageDrag = 0f
                if (delta != 0) goToPage(currentState.page + delta) else {
                    if (!multiTouch && abs(dx) < slop && abs(dy) < slop && !doubleTap) performClick()
                    commitTransform()
                }
                invalidate()
            }
            MotionEvent.ACTION_CANCEL -> { pageDrag = 0f; pageDirection = 0; commitTransform() }
        }
        return true
    }
    override fun performClick(): Boolean { super.performClick(); return true }
    override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
        super.onInitializeAccessibilityNodeInfo(info)
        info.className = "android.widget.ImageView"
        info.isScrollable = currentState.pageCount > 1
        if (currentState.page + 1 < currentState.pageCount) info.addAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_FORWARD)
        if (currentState.page > 0) info.addAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_BACKWARD)
        if (base != null) {
            info.addAction(AccessibilityNodeInfo.AccessibilityAction(R.id.pdf_zoom_in, "Zoom in"))
            info.addAction(AccessibilityNodeInfo.AccessibilityAction(R.id.pdf_zoom_out, "Zoom out"))
            info.addAction(AccessibilityNodeInfo.AccessibilityAction(R.id.pdf_fit_page, "Fit page"))
        }
    }
    override fun performAccessibilityAction(action: Int, arguments: Bundle?): Boolean {
        when (action) {
            AccessibilityNodeInfo.ACTION_SCROLL_FORWARD -> { goToPage(currentState.page + 1); return true }
            AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD -> { goToPage(currentState.page - 1); return true }
            R.id.pdf_zoom_in, R.id.pdf_zoom_out -> if (base != null) {
                viewport.zoomAt(viewport.zoom * if (action == R.id.pdf_zoom_in) 1.5f else 1f / 1.5f, width / 2f, height / 2f)
                commitTransform(); return true
            }
            R.id.pdf_fit_page -> { fitPage(); return true }
        }
        return super.performAccessibilityAction(action, arguments)
    }
    fun dispose() {
        if (disposed) return
        disposed = true; generation++; main.removeCallbacks(renderDetail); onStateChanged = null
        session?.close(); session = null
        // Published bitmaps may still be referenced by RenderThread display lists.
        // Drop our bounded two-layer ownership; only unpublished results are recycled.
        base = null; detail = null; invalidate()
    }
}
