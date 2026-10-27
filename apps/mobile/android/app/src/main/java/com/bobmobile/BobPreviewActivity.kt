package com.bobmobile

import android.app.Activity
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.pdf.PdfRenderer
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.io.File

class BobPreviewActivity : Activity() {
    private var renderer: PdfRenderer? = null
    private var descriptor: ParcelFileDescriptor? = null
    private var bitmap: Bitmap? = null
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(24, 64, 24, 48); setBackgroundColor(0xff000000.toInt()) }
        setContentView(layout)
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(layout) { view, insets ->
            val safe = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars() or androidx.core.view.WindowInsetsCompat.Type.displayCutout())
            view.setPadding(safe.left + 24, safe.top + 24, safe.right + 24, safe.bottom + 24); insets
        }
        layout.addView(Button(this).apply { text = "Close preview"; setOnClickListener { finish() } })
        try {
            val root = File(cacheDir, "bob-previews").canonicalFile
            val file = File(intent.getStringExtra("path") ?: error("Missing attachment")).canonicalFile
            require(file.parentFile == root && file.isFile) { "Invalid preview scope" }
            val mime = intent.getStringExtra("mime") ?: "application/octet-stream"
            when {
                mime.startsWith("text/") -> {
                    val text = file.inputStream().use { input ->
                        val bytes = ByteArray(200001); var count = 0
                        while (count < bytes.size) { val n = input.read(bytes, count, bytes.size - count); if (n < 0) break; count += n }
                        String(bytes, 0, count, Charsets.UTF_8)
                    }
                    val body = TextView(this).apply { setTextColor(0xfff2f0e9.toInt()); textSize = 17f; setTextIsSelectable(true); this.text = text.take(200000) + if (text.length > 200000) "\n[Preview truncated; download retains original bytes]" else "" }
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
                mime == "application/pdf" -> {
                    descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
                    renderer = PdfRenderer(descriptor!!)
                    val pdf = renderer!!; require(pdf.pageCount > 0)
                    var pageNumber = 0
                    val label = TextView(this).apply { setTextColor(0xfff2f0e9.toInt()) }
                    val image = ImageView(this).apply { contentDescription = "PDF page preview"; scaleType = ImageView.ScaleType.FIT_CENTER }
                    fun render() {
                        pdf.openPage(pageNumber).use { page ->
                            val scale = minOf(2f, 2048f / maxOf(page.width, page.height))
                            val next = Bitmap.createBitmap(maxOf(1, (page.width * scale).toInt()), maxOf(1, (page.height * scale).toInt()), Bitmap.Config.ARGB_8888)
                            next.eraseColor(android.graphics.Color.WHITE)
                            page.render(next, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                            image.setImageBitmap(next); bitmap?.recycle(); bitmap = next
                        }
                        label.text = "Page ${pageNumber + 1} of ${pdf.pageCount}"
                    }
                    layout.addView(label)
                    layout.addView(image, LinearLayout.LayoutParams(-1, 0, 1f))
                    layout.addView(Button(this).apply { text = "Previous page"; setOnClickListener { if (pageNumber > 0) { pageNumber--; render() } } })
                    layout.addView(Button(this).apply { text = "Next page"; setOnClickListener { if (pageNumber + 1 < pdf.pageCount) { pageNumber++; render() } } })
                    render()
                }
                else -> error("Use download/open for this attachment")
            }
        } catch (e: Exception) {
            layout.addView(TextView(this).apply { text = "Preview unavailable: ${e.message}"; setTextColor(0xfff2f0e9.toInt()) })
        }
    }
    override fun onDestroy() { renderer?.close(); descriptor?.close(); bitmap?.recycle(); super.onDestroy() }
}
