package com.bobmobile

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.pdf.PdfRenderer
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.ParcelFileDescriptor
import java.io.File
import kotlin.math.max
import kotlin.math.min

internal data class PdfFrame(val page: Int, val generation: Long, val pageWidth: Int, val pageHeight: Int,
    val bitmap: Bitmap, val plan: PdfRasterPlan, val detail: Boolean) {
    val key get() = PdfRasterKey(page, generation, plan)
}

/** The descriptor, renderer and open pages have exactly one worker-thread owner.
 * UI acknowledgement gates the next render, so completed bitmaps cannot queue up. */
internal class PdfRenderSession(file: File, opened: (Int, String?) -> Unit,
    rendered: (PdfFrame?, Int, Long, Boolean, String?) -> Unit) {
    private var onOpened: ((Int, String?) -> Unit)? = opened
    private var onRendered: ((PdfFrame?, Int, Long, Boolean, String?) -> Unit)? = rendered
    private data class Request(val page: Int, val generation: Long, val width: Int = 0, val height: Int = 0,
        val margin: Float = 0f, val tile: PdfRasterPlan? = null)
    private val thread = HandlerThread("BobPdfRender").apply { start() }
    private val worker = Handler(thread.looper)
    private val main = Handler(Looper.getMainLooper())
    private val queue = LatestPdfWork<Request>()
    @Volatile private var closed = false
    private var descriptor: ParcelFileDescriptor? = null
    private var renderer: PdfRenderer? = null
    init {
        worker.post {
            var count = 0; var error: String? = null
            try {
                if (closed) return@post
                descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
                renderer = PdfRenderer(descriptor!!)
                count = renderer!!.pageCount
                require(count > 0)
            } catch (_: Exception) { error = "Couldn't open this PDF. It may be damaged or password-protected." }
            catch (_: OutOfMemoryError) { error = "Not enough memory to open this PDF. Close the preview and try again." }
            if (error != null) { closeResources(); thread.quitSafely() }
            main.post { if (!closed) onOpened?.invoke(count, error) }
        }
    }
    fun page(index: Int, generation: Long, width: Int, height: Int, margin: Float) = offer(Request(index, generation, width, height, margin))
    // Only the view's accepted detail is supplied here, never a requested or failed plan.
    fun detail(index: Int, generation: Long, plan: PdfRasterPlan, published: PdfRasterKey?) =
        offer(Request(index, generation, tile = plan), skipIfIdle = published == PdfRasterKey(index, generation, plan))
    private fun offer(request: Request, skipIfIdle: Boolean = false) {
        if (!closed && queue.offer(request, skipIfIdle)) worker.post { renderLatest() }
    }
    private fun renderLatest() {
        val request = queue.take() ?: return
        var output: PdfFrame? = null; var allocated: Bitmap? = null; var error: String? = null
        try {
            if (!closed) {
                val pdf = renderer ?: throw IllegalStateException("Document unavailable")
                require(request.page in 0 until pdf.pageCount)
                pdf.openPage(request.page).use { page ->
                    require(page.width in 1..1_000_000 && page.height in 1..1_000_000)
                    val plan = request.tile ?: PdfViewport.raster(PdfRect(0f, 0f, page.width.toFloat(), page.height.toFloat()),
                        min(max(1f, request.width - 2 * request.margin) / page.width, max(1f, request.height - 2 * request.margin) / page.height), PdfViewport.BASE_PIXELS, 2048)
                    require(plan.width.toLong() * plan.height <= if (request.tile == null) PdfViewport.BASE_PIXELS else PdfViewport.DETAIL_PIXELS)
                    val image = Bitmap.createBitmap(plan.width, plan.height, Bitmap.Config.ARGB_8888)
                    allocated = image; image.eraseColor(Color.WHITE)
                    val matrix = Matrix().apply { setScale(plan.scale, plan.scale); postTranslate(-plan.region.left * plan.scale, -plan.region.top * plan.scale) }
                    page.render(image, null, matrix, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                    output = PdfFrame(request.page, request.generation, page.width, page.height, image, plan, request.tile != null)
                }
            }
        } catch (_: Exception) { error = "This page couldn't be displayed. Try another page, or reopen the PDF." }
        catch (_: OutOfMemoryError) { error = "Not enough memory to display this page. Try another page, or reopen the PDF." }
        if (output == null) allocated?.recycle()
        val result = output
        main.post {
            try {
                if (closed) result?.bitmap?.recycle() else onRendered?.invoke(result, request.page, request.generation, request.tile != null, error)
            } finally { if (queue.complete() && !closed) worker.post { renderLatest() } }
        }
    }
    private fun closeResources() {
        try { renderer?.close() } catch (_: Exception) {} finally { renderer = null }
        try { descriptor?.close() } catch (_: Exception) {} finally { descriptor = null }
    }
    fun close() {
        if (closed) return
        closed = true; queue.close(); onOpened = null; onRendered = null
        // A finishing native render must not retain a destroyed Activity through callbacks.
        // Never wait on PDFium or close an actively rendered page from the UI thread.
        worker.post { closeResources(); thread.quitSafely() }
    }
}
