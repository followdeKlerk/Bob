package com.bobmobile

import android.app.Activity
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.Drawable
import android.graphics.drawable.RippleDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import java.io.File

class BobPreviewActivity : Activity() {
    private val appearanceListener = object : BobAppearance.Listener { override fun applyAppearance() = updateAppearance() }
    private var bitmap: Bitmap? = null
    private var pdfView: PdfPreviewView? = null
    private var progress: ProgressBar? = null
    private val actions = ArrayList<ImageButton>()
    private fun dp(value: Int) = (value * resources.displayMetrics.density + 0.5f).toInt()
    private fun label(size: Float, monospaced: Boolean = false) = TextView(this).apply {
        typeface = androidx.core.content.res.ResourcesCompat.getFont(context, if (monospaced) R.font.nordwand_mono else R.font.nunito)
        textSize = size; BobAppearance.text(this)
    }
    private fun previewFile(): File {
        val root = File(cacheDir, "bob-previews").canonicalFile
        val file = File(intent.getStringExtra("path") ?: error("Missing attachment")).canonicalFile
        require(file.parentFile == root && file.isFile) { "Invalid preview scope" }
        return file
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val mime = intent.getStringExtra("mime") ?: "application/octet-stream"
        val pdf = mime == "application/pdf"
        val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; BobAppearance.background(this) }
        setContentView(layout)
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(layout) { view, insets ->
            val safe = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars() or androidx.core.view.WindowInsetsCompat.Type.displayCutout())
            val extra = if (pdf) 0 else 24
            view.setPadding(safe.left + extra, safe.top + extra, safe.right + extra, safe.bottom + extra); insets
        }
        androidx.core.view.ViewCompat.requestApplyInsets(layout)
        if (pdf) { showPdf(layout, savedInstanceState?.getBundle("pdf.viewport")); return }
        // Keep the existing bounded text/image preview and original-file behavior.
        layout.addView(Button(this).apply { BobAppearance.button(this); typeface = androidx.core.content.res.ResourcesCompat.getFont(context, R.font.nunito); textSize = 13f; text = "Close preview"; setOnClickListener { finish() } })
        try {
            val file = previewFile()
            when {
                mime.startsWith("text/") -> {
                    val text = file.inputStream().use { input ->
                        val bytes = ByteArray(200001); var count = 0
                        while (count < bytes.size) { val n = input.read(bytes, count, bytes.size - count); if (n < 0) break; count += n }
                        String(bytes, 0, count, Charsets.UTF_8)
                    }
                    val body = label(16f, monospaced = true).apply { setTextIsSelectable(true); this.text = text.take(200000) + if (text.length > 200000) "\n[Preview truncated; download retains original bytes]" else "" }
                    layout.addView(ScrollView(this).apply { isVerticalScrollBarEnabled = false; isHorizontalScrollBarEnabled = false; addView(body) }, LinearLayout.LayoutParams(-1, 0, 1f))
                }
                mime.startsWith("image/") -> {
                    val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeFile(file.path, options)
                    require(options.outWidth > 0 && options.outHeight > 0) { "Unsupported image" }
                    options.inSampleSize = 1
                    while (options.outWidth / options.inSampleSize > 2048 || options.outHeight / options.inSampleSize > 2048) options.inSampleSize *= 2
                    options.inJustDecodeBounds = false
                    bitmap = BitmapFactory.decodeFile(file.path, options) ?: error("Unable to decode image")
                    layout.addView(ImageView(this).apply { contentDescription = "Attachment image preview"; scaleType = ImageView.ScaleType.FIT_CENTER; setImageBitmap(bitmap) }, LinearLayout.LayoutParams(-1, 0, 1f))
                }
                else -> error("Use download/open for this attachment")
            }
        } catch (_: Exception) { layout.addView(label(13f).apply { text = "Preview unavailable. Close this preview and use Open or Save from the attachment." }) }
    }
    private fun action(icon: PreviewIcon, description: String, run: () -> Unit): ImageButton = ImageButton(this).apply {
        contentDescription = description
        setImageDrawable(PreviewGlyph(icon, dp(22)))
        setPadding(dp(13), dp(13), dp(13), dp(13))
        minimumWidth = dp(48); minimumHeight = dp(48)
        layoutParams = LinearLayout.LayoutParams(dp(48), dp(48))
        setOnClickListener { run() }; actions.add(this)
    }
    private fun showPdf(layout: LinearLayout, restored: Bundle?) {
        val body = FrameLayout(this)
        val page = PdfPreviewView(this).also { pdfView = it }
        body.addView(page, FrameLayout.LayoutParams(-1, -1))
        val status = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(12), dp(24), dp(12))
        }
        val spinner = ProgressBar(this).also { progress = it }
        status.addView(spinner, LinearLayout.LayoutParams(dp(32), dp(32)))
        val message = label(14f).apply { gravity = Gravity.CENTER; text = "Opening PDF…"; accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }
        status.addView(message, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) })
        body.addView(status, FrameLayout.LayoutParams(-1, -2, Gravity.CENTER))
        layout.addView(body, LinearLayout.LayoutParams(-1, 0, 1f))
        val toolbar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(8), dp(4), dp(8), dp(4)); minimumHeight = dp(56)
        }
        toolbar.addView(action(PreviewIcon.CLOSE, "Close preview") { finish() })
        val previous = action(PreviewIcon.PREVIOUS, "Previous page") { page.goToPage(page.currentState.page - 1) }
        toolbar.addView(previous)
        val position = label(13f).apply { gravity = Gravity.CENTER; accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }
        toolbar.addView(position, LinearLayout.LayoutParams(0, -2, 1f))
        val next = action(PreviewIcon.NEXT, "Next page") { page.goToPage(page.currentState.page + 1) }
        toolbar.addView(next)
        val fit = action(PreviewIcon.FIT, "Fit page") { page.fitPage() }
        toolbar.addView(fit)
        layout.addView(toolbar, LinearLayout.LayoutParams(-1, -2))
        fun update(state: PdfPreviewState) {
            previous.visibility = if (state.pageCount > 1) View.VISIBLE else View.GONE
            next.visibility = previous.visibility
            previous.isEnabled = state.page > 0
            next.isEnabled = state.page + 1 < state.pageCount
            fit.isEnabled = state.pageCount > 0 && !state.loading && state.error == null
            listOf(previous, next, fit).forEach { it.alpha = if (it.isEnabled) 1f else 0.35f }
            position.text = if (state.pageCount > 0) "${state.page + 1} / ${state.pageCount}" else "PDF"
            position.contentDescription = if (state.pageCount > 0) "Page ${state.page + 1} of ${state.pageCount}" else "PDF document"
            status.visibility = if (state.loading || state.error != null) View.VISIBLE else View.GONE
            spinner.visibility = if (state.loading) View.VISIBLE else View.GONE
            message.text = state.error ?: if (state.pageCount == 0) "Opening PDF…" else "Loading page ${state.page + 1}…"
        }
        page.onStateChanged = ::update
        update(page.currentState)
        BobAppearance.addListener(appearanceListener)
        try { page.open(previewFile(), restored) }
        catch (_: Exception) { update(PdfPreviewState(loading = false, error = "Preview unavailable. Close this preview and open the attachment again.")) }
    }
    private fun updateAppearance() {
        val colors = BobAppearance.palette(this)
        actions.forEach {
            it.imageTintList = ColorStateList.valueOf(colors.foreground)
            it.background = RippleDrawable(ColorStateList.valueOf(Color.argb(36, Color.red(colors.foreground), Color.green(colors.foreground), Color.blue(colors.foreground))), null, ColorDrawable(Color.BLACK))
        }
        progress?.indeterminateTintList = ColorStateList.valueOf(colors.foreground)
    }
    override fun onSaveInstanceState(outState: Bundle) {
        pdfView?.let { outState.putBundle("pdf.viewport", it.saveState()) }
        super.onSaveInstanceState(outState)
    }
    override fun onDestroy() {
        BobAppearance.removeListener(appearanceListener); pdfView?.dispose(); pdfView = null
        bitmap?.recycle(); bitmap = null
        super.onDestroy()
    }
}

private enum class PreviewIcon { CLOSE, PREVIOUS, NEXT, FIT }
/** Small unboxed icons, with full-size native touch/focus targets supplied by ImageButton. */
private class PreviewGlyph(private val icon: PreviewIcon, private val size: Int) : Drawable() {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.BLACK; style = Paint.Style.STROKE; strokeWidth = 2f; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }
    override fun getIntrinsicWidth() = size
    override fun getIntrinsicHeight() = size
    override fun draw(canvas: Canvas) {
        val save = canvas.save(); canvas.translate(bounds.left.toFloat(), bounds.top.toFloat()); canvas.scale(bounds.width() / 24f, bounds.height() / 24f)
        val path = Path()
        fun line(vararg points: Float) { path.moveTo(points[0], points[1]); for (i in 2 until points.size step 2) path.lineTo(points[i], points[i + 1]) }
        when (icon) {
            PreviewIcon.CLOSE -> { line(6f, 6f, 18f, 18f); line(18f, 6f, 6f, 18f) }
            PreviewIcon.PREVIOUS -> line(15f, 5f, 8f, 12f, 15f, 19f)
            PreviewIcon.NEXT -> line(9f, 5f, 16f, 12f, 9f, 19f)
            PreviewIcon.FIT -> { line(9f, 4f, 4f, 4f, 4f, 9f); line(15f, 4f, 20f, 4f, 20f, 9f); line(4f, 15f, 4f, 20f, 9f, 20f); line(15f, 20f, 20f, 20f, 20f, 15f) }
        }
        canvas.drawPath(path, paint); canvas.restoreToCount(save)
    }
    override fun setTintList(tint: ColorStateList?) { paint.color = tint?.defaultColor ?: Color.BLACK; invalidateSelf() }
    override fun setAlpha(alpha: Int) { paint.alpha = alpha; invalidateSelf() }
    override fun setColorFilter(colorFilter: ColorFilter?) { paint.colorFilter = colorFilter; invalidateSelf() }
    @Deprecated("Deprecated in Java") override fun getOpacity() = PixelFormat.TRANSLUCENT
}
