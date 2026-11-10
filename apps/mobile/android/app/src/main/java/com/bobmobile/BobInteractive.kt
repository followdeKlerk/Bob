package com.bobmobile

import android.content.Context
import android.graphics.Typeface
import android.util.Base64
import androidx.core.content.res.ResourcesCompat
import android.view.View
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.ActivityNotFoundException
import android.net.Uri
import android.view.MotionEvent
import android.os.Bundle
import android.webkit.*
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.ScrollView
import android.widget.Toast
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.net.HttpURLConnection
import java.net.URI
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.Semaphore

// Font failures must not prevent opening a surface (including resource-light tests).
private fun TextView.useSurfaceTypeface() {
    typeface = try { ResourcesCompat.getFont(context, R.font.nunito) ?: Typeface.DEFAULT }
        catch (_: Exception) { Typeface.DEFAULT }
}
private val surfaceFontCssCache = SurfaceFontCssCache()
private fun surfaceFontFaces(context: Context): String = surfaceFontCssCache.get {
    var complete = true
    // Reuse the exact native TTF resources offline; do not ship a second copy.
    val ui = listOf(
        Triple(R.font.nunito_regular, "400", "normal"), Triple(R.font.nunito_medium, "500", "normal"),
        Triple(R.font.nunito_semi_bold, "600", "normal"), Triple(R.font.nunito_bold, "700 1000", "normal"),
        Triple(R.font.nunito_regular_italic, "400", "italic"), Triple(R.font.nunito_medium_italic, "500", "italic"),
        Triple(R.font.nunito_semi_bold_italic, "600", "italic"), Triple(R.font.nunito_bold_italic, "700 1000", "italic")
    ).joinToString("") { (font, weight, style) ->
        try {
            val data = context.resources.openRawResource(font).use { Base64.encodeToString(it.readBytes(), Base64.NO_WRAP) }
            "@font-face{font-family:'Nunito';src:url(data:font/ttf;base64,$data) format('truetype');font-weight:$weight;font-style:$style;font-display:swap}"
        } catch (_: Exception) { complete = false; "" }
    }
    val mono = listOf(
        Triple("Regular", "400", "normal"), Triple("Bold", "500 900", "normal"),
        Triple("Italic", "400", "italic"), Triple("BoldItalic", "500 900", "italic")
    ).joinToString("") { (file, weight, style) ->
        try {
            val data = context.assets.open("fonts/NordwandMono-$file.woff2").use { Base64.encodeToString(it.readBytes(), Base64.NO_WRAP) }
            "@font-face{font-family:'Nordwand Mono';src:url(data:font/woff2;base64,$data) format('woff2');font-weight:$weight;font-style:$style;font-display:swap}"
        } catch (_: Exception) { complete = false; "" }
    }
    SurfaceFontCssCache.Loaded(ui + mono, complete)
}

internal data class SurfaceSession(val endpoint: String, val identity: String, val token: String, val chat: Long, val id: String, val resource: JSONObject)
private val surfaceSessions = SurfacePreparation<SurfaceSession>(8)
private class SurfaceHttpError(val status: Int) : IllegalStateException("Interactive request rejected (HTTP $status); do not automatically retry a tool action")
private fun surfaceRequest(endpoint: String, identity: String, token: String, path: String, payload: JSONObject, method: String = "POST", onConnection: ((HttpURLConnection?) -> Unit)? = null): JSONObject {
    val uri = URI(endpoint)
    require(uri.userInfo == null && uri.query == null && uri.fragment == null && (uri.path.isEmpty() || uri.path == "/"))
    require((uri.scheme == "https" && uri.host?.endsWith(".ts.net") == true) || (BuildConfig.DEBUG && uri.scheme == "http" && uri.host == "127.0.0.1" && uri.port in 1..65535)) { "Verified paired transport required" }
    val connection = URI(endpoint.trimEnd('/') + path).toURL().openConnection() as HttpURLConnection
    try {
        onConnection?.invoke(connection)
        connection.instanceFollowRedirects = false; connection.connectTimeout = 15000; connection.readTimeout = if (method == "GET") 10000 else 40000
        connection.requestMethod = method; connection.doOutput = method == "POST"
        connection.setRequestProperty("Authorization", "Bearer $token"); connection.setRequestProperty("x-bob-backend", identity)
        connection.setRequestProperty("Content-Type", "application/json")
        if (method == "POST") connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
        if (connection.responseCode !in 200..299) throw SurfaceHttpError(connection.responseCode)
        val output = java.io.ByteArrayOutputStream()
        connection.inputStream.use { input -> val buffer = ByteArray(8192)
            while (true) { val n = input.read(buffer); if (n < 0) break; require(output.size() + n <= 4194304) { "Interactive response too large" }; output.write(buffer, 0, n) }
        }
        return JSONObject(String(output.toByteArray(), Charsets.UTF_8))
    } finally { connection.disconnect(); onConnection?.invoke(null) }
}
// Closing is best effort: capabilities also expire server-side. Never retry a tool action.
private fun closeSurfaceSession(selected: SurfaceSession) {
    try { surfaceRequest(selected.endpoint, selected.identity, selected.token, "/v1/chats/${selected.chat}/ui/${selected.id}/close", JSONObject().put("capability", selected.resource.getString("capability"))) }
    catch (_: Exception) { }
}
private fun closeSurfaceSessionAsync(selected: SurfaceSession) {
    try { Thread { closeSurfaceSession(selected) }.start() } catch (_: Exception) { }
}
class BobInteractive(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "BobInteractive"
    @ReactMethod fun prepare(endpoint: String, identity: String, token: String, chat: Double, id: String, promise: Promise) {
        prepareSession(endpoint, identity, token, chat, id, promise, false)
    }
    @ReactMethod fun releasePrepared(handle: String) {
        surfaceSessions.take(handle)?.let { closeSurfaceSessionAsync(it) }
    }
    @ReactMethod fun open(endpoint: String, identity: String, token: String, chat: Double, id: String, promise: Promise) {
        prepareSession(endpoint, identity, token, chat, id, promise, true)
    }
    private fun prepareSession(endpoint: String, identity: String, token: String, chat: Double, id: String, promise: Promise, open: Boolean) {
        // Reserve BEFORE creating a thread or fetching. Both entry points share this budget.
        val reservation = surfaceSessions.reserve()
        if (reservation == null) { promise.reject("interactive", "Too many pending interactive surfaces"); return }
        var started = false
        try {
            Thread {
                var selected: SurfaceSession? = null
                var published = false
                var completed = false
                try {
                    require(chat > 0 && chat % 1.0 == 0.0); UUID.fromString(id); UUID.fromString(identity)
                    val resource = surfaceRequest(endpoint, identity, token, "/v1/chats/${chat.toLong()}/ui/$id/open", JSONObject())
                    // Own the capability before validation, so rejected resources are also closed.
                    selected = SurfaceSession(endpoint, identity, token, chat.toLong(), id, resource)
                    require(resource.getString("id") == id && resource.getString("html").length <= 2097152)
                    VisualActions.fromResource(resource)
                    val handle = UUID.randomUUID().toString()
                    reservation.publish(handle, selected)
                    published = true
                    if (open) context.startActivity(Intent(context, BobInteractiveActivity::class.java).putExtra("session", handle).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    promise.resolve(if (open) "Opened isolated surface" else handle)
                    completed = true
                } catch (e: Exception) { promise.reject("interactive", e.message ?: "Unable to open interactive surface") }
                finally {
                    if (!completed) {
                        // If already consumed/released, that owner alone closes the capability.
                        val abandoned = if (published) reservation.cancel() else { reservation.cancel(); selected }
                        abandoned?.let { closeSurfaceSession(it) }
                    }
                }
            }.start()
            started = true
        } catch (e: Exception) { promise.reject("interactive", e.message ?: "Unable to open interactive surface") }
        finally { if (!started) reservation.cancel() }
    }
}
internal class BobSurfacePanel(context: Context, private val onClose: () -> Unit, private val inline: Boolean = false, private val mountId: String? = null, private val onInlineHeight: ((Int) -> Unit)? = null) : LinearLayout(context), BobAppearance.Listener {
    @Volatile private var disposed = false
    private var approval: AlertDialog? = null
    private var session: SurfaceSession? = null
    private var web: WebView? = null
    private val nonce = UUID.randomUUID().toString() + UUID.randomUUID().toString()
    private val executor = Executors.newFixedThreadPool(2)
    private val requests = Semaphore(4)
    private lateinit var status: TextView
    private var lastInlineHeight = 0
    private var htmlInlineHeight = 0
    private var inlineOverflow = false
    private var actionFooter: ScrollView? = null
    private var actionContent: LinearLayout? = null
    private var footerPixels = 0
    private var latestData: JSONObject? = null
    private var dataRevision = -1L
    private var dataEnabled = false
    private var dataFetching = false
    private var dataDelay = 2000L
    @Volatile private var dataFetchAllowed = false
    @Volatile private var dataConnection: HttpURLConnection? = null
    private val dataRefresh = Runnable { refreshData() }
    override fun applyAppearance() {
        if (disposed) return
        val colors = BobAppearance.palette(context)
        web?.let { view ->
            view.setBackgroundColor(colors.background)
            // Only the trusted outer host changes. Do not reload or enter the user iframe.
            view.evaluateJavascript("document.documentElement.style.backgroundColor='${colors.backgroundCss}';document.body.style.backgroundColor='${colors.backgroundCss}';document.body.style.color='${colors.foregroundCss}';", null)
        }
    }
    private fun emit(name: String, fill: (WritableMap) -> Unit = {}) {
        val selected = session ?: return
        val reactContext = context as? ThemedReactContext ?: return
        val event = Arguments.createMap().apply {
            putString("backendId", selected.identity); putDouble("conversationId", selected.chat.toDouble()); putString("id", selected.id)
            putString("session", mountId); fill(this)
        }
        reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)?.emit(name, event)
    }
    private fun isSurfaceActive(): Boolean {
        if (disposed || !isAttachedToWindow || windowVisibility != View.VISIBLE || !hasWindowFocus()) return false
        // React Native keeps the chat mounted behind other tabs with opacity=0.
        // isShown/global bounds alone do not detect that kind of hidden parent.
        var ancestor: View? = this
        while (ancestor != null) { if (ancestor.visibility != View.VISIBLE || ancestor.alpha <= 0.01f) return false; ancestor = ancestor.parent as? View }
        return getGlobalVisibleRect(android.graphics.Rect())
    }
    private fun canRefreshData() = dataEnabled && isSurfaceActive()
    private fun scheduleData(delay: Long = 0L) { removeCallbacks(dataRefresh); if (!disposed && dataEnabled && isAttachedToWindow && windowVisibility == View.VISIBLE && hasWindowFocus()) postDelayed(dataRefresh, delay) }
    private fun pauseData() { dataFetchAllowed = false; removeCallbacks(dataRefresh); dataConnection?.disconnect() }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); scheduleData() }
    override fun onDetachedFromWindow() { pauseData(); super.onDetachedFromWindow() }
    override fun onWindowVisibilityChanged(visibility: Int) { super.onWindowVisibilityChanged(visibility); if (visibility == View.VISIBLE) scheduleData() else pauseData() }
    override fun onWindowFocusChanged(hasWindowFocus: Boolean) { super.onWindowFocusChanged(hasWindowFocus); if (hasWindowFocus) scheduleData() else pauseData() }
    private fun dataStatus(message: String) {
        if (inline) emit("BobSurfaceDataStatus") { it.putString("message", message) }
        else { status.text = message; status.visibility = if (message.isEmpty()) View.GONE else View.VISIBLE }
    }
    private fun refreshData() {
        if (disposed || !dataEnabled || dataFetching) return
        if (!canRefreshData()) { scheduleData(2000); return }
        val selected = session ?: return
        dataFetching = true; dataFetchAllowed = true
        val revision = dataRevision.coerceAtLeast(0)
        executor.execute {
            try {
                val value = surfaceRequest(selected.endpoint, selected.identity, selected.token, "/v1/chats/${selected.chat}/ui/${selected.id}/data?after=$revision", JSONObject(), "GET") { connection ->
                    dataConnection = connection; if (!dataFetchAllowed) connection?.disconnect()
                }
                val responseRevision = value.optDouble("revision", -1.0)
                require(value.optString("id") == selected.id && value.optDouble("conversationId", -1.0) == selected.chat.toDouble()) { "Visual data scope mismatch" }
                require(responseRevision.isFinite() && responseRevision >= 0 && responseRevision <= 9007199254740991.0 && responseRevision % 1.0 == 0.0) { "Invalid visual revision" }
                if (value.optBoolean("unchanged")) require(responseRevision == revision.toDouble()) { "Invalid unchanged visual revision" }
                else {
                    val data = value.opt("data")
                    require((data === JSONObject.NULL || data is JSONObject) && data.toString().toByteArray(Charsets.UTF_8).size <= 65536) { "Invalid visual data" }
                }
                post {
                    if (!disposed && canRefreshData()) { acceptVisualData(value); dataDelay = 2000; dataStatus("") }
                }
            } catch (error: Exception) {
                post {
                    if (!disposed && canRefreshData()) {
                        if (error is SurfaceHttpError && error.status in listOf(401, 403, 404)) dataEnabled = false
                        dataDelay = (dataDelay * 2).coerceAtMost(30000)
                        dataStatus(if (dataEnabled) "Live updates disconnected — showing last received data." else "Live updates unavailable. Expand or reopen to reconnect.")
                    }
                }
            } finally { post { dataFetching = false; scheduleData(dataDelay) } }
        }
    }
    // Called on the UI thread. Reject another surface's response and regressing
    // revisions even after reconnect; never reload the iframe or its local state.
    internal fun acceptVisualData(value: JSONObject): Boolean {
        val selected = session ?: return false
        if (selected.resource.optString("kind") != "visual" || value.optString("id") != selected.id || value.optDouble("conversationId", -1.0) != selected.chat.toDouble()) return false
        val revision = value.optDouble("revision", -1.0)
        if (!revision.isFinite() || revision < 0 || revision > 9007199254740991.0 || revision % 1.0 != 0.0 || revision <= dataRevision.toDouble()) return false
        val data = value.opt("data") ?: return false
        if (data !== JSONObject.NULL && data !is JSONObject) return false
        if (data.toString().toByteArray(Charsets.UTF_8).size > 65536) return false
        dataRevision = revision.toLong()
        latestData = JSONObject().put("revision", dataRevision).put("data", data).put("updatedAt", value.opt("updatedAt") ?: JSONObject.NULL)
        pushVisualData(); return true
    }
    private fun pushVisualData() {
        val value = latestData ?: return
        if (!disposed) web?.evaluateJavascript("window.__bobVisualData?.(JSON.parse(${JSONObject.quote(value.toString()).replace("<", "\\u003c")}))", null)
    }
    // The entire inline document/footer fits the row. A descendant WebView can
    // ask its parent directly to retain a gesture, so enforce this at the panel
    // boundary: chat may intercept drags; DOWN/UP still reach controls normally.
    override fun requestDisallowInterceptTouchEvent(disallowIntercept: Boolean) {
        super.requestDisallowInterceptTouchEvent(if (inline) false else disallowIntercept)
    }
    // Reject both fully and partially obscured taps before they reach native controls.
    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        if (event.flags and (MotionEvent.FLAG_WINDOW_IS_OBSCURED or MotionEvent.FLAG_WINDOW_IS_PARTIALLY_OBSCURED) != 0) return false
        return super.dispatchTouchEvent(event)
    }
    private fun launchAction(action: VisualAction, button: Button) {
        val selected = session ?: return
        // The notification context tracks the selected backend/chat, including while a
        // full-screen Activity is in front of React. Do not use appVisible here:
        // React legitimately pauses while that Activity owns the focused window.
        if (!isSurfaceActive() || web == null || inlineOverflow || NotificationRuntime.visibleBackend != selected.identity ||
            NotificationRuntime.visibleChat != selected.chat || !button.isShown || !button.getGlobalVisibleRect(android.graphics.Rect())) return
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(action.url)).addCategory(Intent.CATEGORY_BROWSABLE)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try { context.startActivity(intent) }
        catch (_: ActivityNotFoundException) { Toast.makeText(context, "No app can open this destination. Nothing was opened.", Toast.LENGTH_LONG).show() }
        catch (_: SecurityException) { Toast.makeText(context, "Android blocked opening this destination. Nothing was opened.", Toast.LENGTH_LONG).show() }
    }
    private fun createActionFooter(actions: List<VisualAction>): ScrollView? {
        if (actions.isEmpty()) return null
        val content = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        val padding = (8 * resources.displayMetrics.density).toInt()
        content.setPadding(padding, padding, padding, padding)
        for (action in actions) {
            val caption = TextView(context).apply {
                useSurfaceTypeface(); textSize = 14f; BobAppearance.text(this)
                textDirection = View.TEXT_DIRECTION_LTR
                text = "Destination: ${action.caption}"
            }
            content.addView(caption, LinearLayout.LayoutParams(-1, -2))
            val button = Button(context).apply {
                useSurfaceTypeface(); textSize = 16f; isAllCaps = false; text = action.label
                setSingleLine(false); maxLines = Int.MAX_VALUE; ellipsize = null; setHorizontallyScrolling(false)
                BobAppearance.button(this)
                minHeight = (48 * resources.displayMetrics.density).toInt()
                minimumHeight = minHeight; filterTouchesWhenObscured = true
                // These immutable values are captured once, never looked up in live data or JS.
                contentDescription = "${action.label}. Destination: ${action.caption}"
                setOnClickListener { launchAction(action, this) }
            }
            content.addView(button, LinearLayout.LayoutParams(-1, -2))
        }
        actionContent = content
        return ScrollView(context).apply {
            isFillViewport = false; isHorizontalScrollBarEnabled = false
            addView(content, LayoutParams(-1, -2)); actionFooter = this
        }
    }
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val footer = actionFooter
        val content = actionContent
        if (footer != null && content != null && !inlineOverflow) {
            val availableWidth = (View.MeasureSpec.getSize(widthMeasureSpec) - paddingLeft - paddingRight).coerceAtLeast(0)
            content.measure(View.MeasureSpec.makeMeasureSpec(availableWidth, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED))
            val measured = content.measuredHeight
            val changed = footerPixels != measured
            footerPixels = measured
            // Even before HTML telemetry arrives, reserve at least one CSS dp for
            // the document. Hide/promote now rather than clipping an oversized
            // footer until the host's measurement timeout. Ignore zero-width passes.
            if (inline && availableWidth > 0 && VisualActions.inlineHeight(1, measured, resources.displayMetrics.density) == null) {
                showInlineOverflow()
            } else {
                // Full screen retains readable controls at large font scales via native scrolling.
                val availableHeight = (View.MeasureSpec.getSize(heightMeasureSpec) - paddingTop - paddingBottom).coerceAtLeast(0)
                footer.layoutParams.height = if (inline) measured else measured.coerceAtMost((availableHeight * 0.6f).toInt())
                if (inline && changed) post { updateInlineSize() }
            }
        }
        super.onMeasure(widthMeasureSpec, heightMeasureSpec)
    }
    private fun updateInlineSize() {
        if (disposed || !inline || inlineOverflow || htmlInlineHeight == 0) return
        // Wait for real width/font-dependent footer measurement, not a guessed dp allowance.
        if (actionFooter != null && (width <= 0 || footerPixels == 0)) { requestLayout(); return }
        val total = VisualActions.inlineHeight(htmlInlineHeight, footerPixels, resources.displayMetrics.density)
        if (total == null) { showInlineOverflow(); return }
        if (lastInlineHeight == total) return
        lastInlineHeight = total
        ApprovedDiagnostics.record(context, "resize", web?.width ?: 0, web?.height ?: 0, total)
        onInlineHeight?.invoke(total)
        emit("BobSurfaceLayout") { it.putInt("height", total) }
    }
    private fun showInlineOverflow(reason: String = "content-overflow") {
        if (disposed || inlineOverflow) return
        inlineOverflow = true
        ApprovedDiagnostics.record(context, if (reason == "measurement-timeout") "fallback-timeout" else "fallback-overflow", web?.width ?: 0, web?.height ?: 0, lastInlineHeight)
        status.text = "Open full view to see this content."
        status.visibility = View.VISIBLE
        web?.visibility = View.INVISIBLE
        actionFooter?.visibility = View.GONE
        pauseData(); dataEnabled = false
        emit("BobSurfaceOverflow")
    }
    fun show(selected: SurfaceSession) {
        if (disposed || session != null) { closeSurfaceSessionAsync(selected); return }
        session = selected
        if (inline) ApprovedDiagnostics.record(context, "mount", width, height)
        orientation = LinearLayout.VERTICAL
        BobAppearance.background(this)
        BobAppearance.addListener(this)
        clipChildren = true; clipToPadding = true
        if (inline) { isFocusable = false; isFocusableInTouchMode = false }
        val layout = this
        status = TextView(context).apply { useSurfaceTypeface(); BobAppearance.text(this); textSize = 14f; setTextIsSelectable(true); visibility = View.GONE }
        layout.addView(status)
        val actions = try { VisualActions.fromResource(selected.resource) } catch (_: IllegalArgumentException) {
            status.text = "Content unavailable: invalid native actions. Reopen after correcting the visual."
            status.visibility = View.VISIBLE
            return
        }
        if (selected.resource.optString("kind") == "visual") selected.resource.optJSONObject("visualData")?.let { dataEnabled = true; acceptVisualData(it) }
        val start: () -> Unit = start@{
            if (disposed) return@start
            try {
                val view = object : WebView(context) {
                    // Scroll belongs to the chat, not a hidden WebView viewport.
                    override fun scrollTo(x: Int, y: Int) {
                        if (inline) super.scrollTo(0, 0) else super.scrollTo(x, y)
                    }
                    override fun overScrollBy(deltaX: Int, deltaY: Int, scrollX: Int, scrollY: Int, scrollRangeX: Int, scrollRangeY: Int, maxOverScrollX: Int, maxOverScrollY: Int, isTouchEvent: Boolean): Boolean {
                        if (inline) return false
                        return super.overScrollBy(deltaX, deltaY, scrollX, scrollY, scrollRangeX, scrollRangeY, maxOverScrollX, maxOverScrollY, isTouchEvent)
                    }
                }; web = view
                view.setBackgroundColor(BobAppearance.palette(context).background)
                view.isVerticalScrollBarEnabled = false; view.isHorizontalScrollBarEnabled = false
                WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
                view.settings.apply {
                    javaScriptEnabled = true; allowFileAccess = false; allowContentAccess = false
                    domStorageEnabled = false; databaseEnabled = false; blockNetworkLoads = true
                    javaScriptCanOpenWindowsAutomatically = false; setSupportMultipleWindows(false)
                    mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                    if (android.os.Build.VERSION.SDK_INT >= 26) safeBrowsingEnabled = true
                }
                CookieManager.getInstance().setAcceptCookie(false)
                CookieManager.getInstance().setAcceptThirdPartyCookies(view, false)
                view.webViewClient = object : WebViewClient() {
                    override fun onPageFinished(view: WebView, url: String) { if (!disposed) { applyAppearance(); pushVisualData(); scheduleData() } }
                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
                    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest) = WebResourceResponse("text/plain", "utf-8", 403, "Blocked", mapOf("Cache-Control" to "no-store"), ByteArrayInputStream("Network access denied".toByteArray()))
                    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean { pauseData(); dataEnabled = false; actionFooter?.visibility = View.GONE; layout.removeView(view); view.destroy(); web = null; status.visibility = View.VISIBLE; status.text = "Interactive content stopped. Reopen to try again; no tool action was retried."; return true }
                }
                view.webChromeClient = object : WebChromeClient() {
                    override fun onPermissionRequest(request: PermissionRequest) { request.deny() }
                    override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult): Boolean { result.cancel(); return true }
                    override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult): Boolean { result.cancel(); return true }
                    override fun onJsPrompt(view: WebView, url: String, message: String, defaultValue: String, result: JsPromptResult): Boolean { result.cancel(); return true }
                }
                view.addJavascriptInterface(Bridge(), "BobNative")
                layout.addView(view, LinearLayout.LayoutParams(-1, 0, 1f))
                createActionFooter(actions)?.let { layout.addView(it, LinearLayout.LayoutParams(-1, -2)) }
                val payload = JSONObject()
                for (key in listOf("kind", "title", "html", "input", "result", "allowedTools", "visualData")) if (selected.resource.has(key)) payload.put(key, selected.resource.get(key))
                val bundle = context.assets.open("bob-host.js").bufferedReader().use { it.readText() }.replace("</script", "<\\/script")
                // Only the host substitutes the per-frame layout key. Never give the child
                // the native bridge nonce (or reports will not match the host's layout key).
                val inlineMeasure = if (inline) context.assets.open("inline-measure.js").bufferedReader().use { it.readText() }.replace("</script", "<\\/script") else ""
                val fontFaceCss = surfaceFontFaces(context)
                val safePayload = payload.toString().replace("<", "\\u003c")
                val colors = BobAppearance.palette(context)
                val html = """<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src about: data: blob:; img-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style id="bob-font-faces">$fontFaceCss</style><style>html,body{height:100%;margin:0;background:${colors.backgroundCss};color:${colors.foregroundCss};font:14px Nunito,sans-serif}body{display:flex;flex-direction:column}#status{padding:8px}#status:empty{display:none}#surface{flex:1;min-height:0}</style></head><body><div id="status" role="status" aria-live="polite">Loading isolated content…</div><div id="surface"></div><script>$bundle
    window.startBobSurface($safePayload,${JSONObject.quote(nonce)},${if (inline) "true" else "false"},${JSONObject.quote(inlineMeasure)},document.getElementById('bob-font-faces').textContent).catch(e=>document.getElementById('status').textContent='Unavailable: '+e.message);</script></body></html>"""
                view.loadDataWithBaseURL("https://bob.invalid/", html, "text/html", "utf-8", null)
            } catch (_: Exception) { dispose(); onClose() }
        }
        if (selected.resource.optString("kind") == "mcp") {
            val names = selected.resource.optJSONArray("allowedTools")?.toString() ?: "[]"
            approval = AlertDialog.Builder((context as? ThemedReactContext)?.currentActivity ?: context).setTitle("Allow this MCP App's scoped tools?")
                .setMessage("Only this conversation and configured MCP server are granted. Allowed tools: $names\nThe app can call these tools while open. No ambient host or network access is granted.")
                .setPositiveButton("Open with these tools") { _, _ -> start() }
                .setNegativeButton("Cancel") { _, _ -> dispose(); onClose() }.setOnCancelListener { dispose(); onClose() }.show().also { BobAppearance.dialog(it) }
        } else start()
    }
    private fun reply(id: String, value: JSONObject) {
        post { if (!disposed) web?.evaluateJavascript("window.__bobReply(${JSONObject.quote(id)},${value.toString().replace("<", "\\u003c")})", null) }
    }
    inner class Bridge {
        @JavascriptInterface fun request(raw: String, key: String) {
            // Android exposes JS interfaces to every frame. Only the trusted opaque-parent host knows this nonce.
            if (disposed || raw.length > 65536 || key.length != nonce.length || !MessageDigest.isEqual(key.toByteArray(), nonce.toByteArray())) return
            val selected = session ?: return
            val parsed = try { JSONObject(raw) } catch (_: Exception) { return }
            if (parsed.optString("method") == "layout" && inline) {
                val height = parsed.optDouble("height", -1.0)
                if (!height.isFinite() || height % 1.0 != 0.0 || height < 1 || height > VisualActions.MAX_INLINE_HEIGHT) return
                post {
                    if (!disposed) { htmlInlineHeight = height.toInt(); updateInlineSize() }
                }
                return
            }
            if (parsed.optString("method") == "overflow" && inline) {
                post {
                    if (!disposed) {
                        if (BuildConfig.DEBUG) {
                            val reason = if (parsed.optString("reason") == "measurement-timeout") "measurement-timeout" else "content-overflow"
                            android.util.Log.d("BobInline", "Full view: $reason; native viewport=${web?.width}x${web?.height}")
                        }
                        showInlineOverflow(parsed.optString("reason"))
                    }
                }
                return
            }
            // Visuals have no tool or external-intent bridge authority, even with a valid host nonce.
            if (selected.resource.optString("kind") != "mcp" || parsed.optString("method") != "callTool") return
            val id = parsed.optString("id"); try { UUID.fromString(id) } catch (_: Exception) { return }
            if (!requests.tryAcquire()) { reply(id, JSONObject().put("error", "Too many in-flight tool calls")); return }
            executor.execute {
                try {
                    require(parsed.getString("method") == "callTool")
                    val params = parsed.getJSONObject("params")
                    val allowed = selected.resource.getJSONArray("allowedTools")
                    require((0 until allowed.length()).any { allowed.getString(it) == params.getString("name") })
                    val payload = JSONObject().put("capability", selected.resource.getString("capability")).put("requestId", id).put("name", params.getString("name")).put("arguments", params.optJSONObject("arguments") ?: JSONObject())
                    val result = surfaceRequest(selected.endpoint, selected.identity, selected.token, "/v1/chats/${selected.chat}/ui/${selected.id}/call", payload)
                    reply(id, JSONObject().put("result", result))
                } catch (e: Exception) { reply(id, JSONObject().put("error", e.message ?: "Unknown tool outcome; no automatic retry")) }
                finally { requests.release() }
            }
        }
    }
    fun dispose() {
        if (disposed) return
        if (inline) ApprovedDiagnostics.record(context, "dispose", web?.width ?: 0, web?.height ?: 0, lastInlineHeight)
        disposed = true; pauseData()
        BobAppearance.removeListener(this)
        actionFooter?.visibility = View.GONE; actionFooter = null; actionContent = null
        approval?.setOnCancelListener(null); approval?.dismiss(); approval = null
        web?.removeJavascriptInterface("BobNative"); web?.destroy(); web = null; executor.shutdownNow()
        val selected = session; session = null
        if (selected != null) closeSurfaceSessionAsync(selected)

    }
}


class BobInteractiveActivity : Activity() {
    private var panel: BobSurfacePanel? = null
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val selected = surfaceSessions.take(intent.getStringExtra("session"))
        if (selected == null) {
            setContentView(TextView(this).apply { BobAppearance.background(this); BobAppearance.text(this); useSurfaceTypeface(); textSize = 13f; text = "Content expired. Return to chat and reopen it." }); return
        }
        var handedOff = false
        try {
            val surface = BobSurfacePanel(this, { finish() })
            panel = surface
            androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(surface) { view, insets ->
                val safe = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars() or androidx.core.view.WindowInsetsCompat.Type.displayCutout())
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom); insets
            }
            setContentView(surface)
            handedOff = true
            surface.show(selected)
        } catch (e: Exception) {
            panel?.dispose(); panel = null
            if (!handedOff) closeSurfaceSessionAsync(selected)
            finish()
        }
    }
    override fun onDestroy() { panel?.dispose(); panel = null; super.onDestroy() }
}

class BobInlineSurfaceManager : SimpleViewManager<LinearLayout>() {
    override fun getName() = "BobInlineSurface"
    override fun createViewInstance(context: ThemedReactContext): LinearLayout = object : LinearLayout(context) {
        init { orientation = LinearLayout.VERTICAL }
        // React Native owns this host's bounds; explicitly lay out its native WebView child.
        override fun requestLayout() {
            super.requestLayout()
            post {
                if (width > 0 && height > 0) {
                    measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY))
                    layout(left, top, right, bottom)
                }
            }
        }
    }
    @ReactProp(name = "session")
    fun setSession(host: LinearLayout, handle: String?) {
        if (host.tag == handle) return
        (host.getChildAt(0) as? BobSurfacePanel)?.dispose(); host.removeAllViews(); host.tag = handle
        if (handle == null) return
        val selected = surfaceSessions.take(handle) ?: return
        var surface: BobSurfacePanel? = null
        var handedOff = false
        try {
            surface = BobSurfacePanel(host.context, {
                host.removeAllViews()
                host.addView(TextView(host.context).apply { useSurfaceTypeface(); textSize = 13f; text = "Opening cancelled. Expand to reopen."; BobAppearance.text(this, muted = true) })
            }, true, handle)
            surface.layoutParams = LinearLayout.LayoutParams(-1, -1)
            host.addView(surface, LinearLayout.LayoutParams(-1, -1))
            handedOff = true
            surface.show(selected)
        } catch (e: Exception) {
            surface?.dispose(); host.removeAllViews()
            if (!handedOff) closeSurfaceSessionAsync(selected)
        }
    }
    override fun onDropViewInstance(view: LinearLayout) {
        (view.getChildAt(0) as? BobSurfacePanel)?.dispose(); view.removeAllViews()
        super.onDropViewInstance(view)
    }
}
