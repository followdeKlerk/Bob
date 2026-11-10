package com.bobmobile

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.res.Configuration
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.webkit.*
import android.widget.FrameLayout
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.common.LifecycleState
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.Event
import org.json.JSONObject
import org.json.JSONTokener
import java.io.ByteArrayInputStream
import java.io.File

private class TerminalStateEvent(surface: Int, view: Int, private val state: TerminalStateSnapshot) : Event<TerminalStateEvent>(surface, view) {
    override fun getEventName() = "topState"
    override fun canCoalesce() = false
    override fun getEventData() = Arguments.createMap().apply {
        putString("session", state.session); putString("phase", state.phase); putBoolean("ctrl", state.ctrl)
        state.message?.let { putString("message", it) }
        state.acknowledged?.let { putDouble("acknowledged", it) }
    }
}

/** In-app renderer only. React owns chrome, admission and IME insets; no Activity/window mutation. */
@Suppress("SetJavaScriptEnabled")
internal class BobTerminalView(private val react: ThemedReactContext) : FrameLayout(react),
    LifecycleEventListener, BobAppearance.Listener {
    var sessionProp: String? = null
    var activeProp = false
    var controlProp: ReadableMap? = null
    private val main = Handler(Looper.getMainLooper())
    private val admission = TerminalAdmission()
    private var pending: BobTerminalConfig? = null
    private var client: TerminalClient? = null
    private var disposed = false
    private var rendererReady = false
    private var rendererGone = false
    private var generation = 0
    private val controls = TerminalControlOrder()
    private data class ControlScope(val epoch: Int, val session: String, val ticket: TerminalControlOrder.Ticket)
    private var pendingControl: ControlScope? = null
    private var ctrl = false
    private val timeout = Runnable { finish("Terminal renderer is not ready. Return to chat and reconnect.") }
    private val web = WebView(react)

    init {
        react.addLifecycleEventListener(this)
        web.apply {
            setBackgroundColor(BobAppearance.palette(react).background)
            settings.javaScriptEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.domStorageEnabled = false
            settings.databaseEnabled = false
            settings.cacheMode = WebSettings.LOAD_NO_CACHE
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.setSupportMultipleWindows(false)
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.blockNetworkLoads = true
            // Text scaling is applied explicitly from Android's accessibility fontScale.
            settings.textZoom = 100
            isSaveEnabled = false
            importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
            addJavascriptInterface(RendererBridge(), "BobTerminalInput")
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?) = true
                override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse {
                    val uri = request?.url
                    val asset = TerminalRendererAssets.path(request?.method, uri?.scheme, uri?.host, uri?.port,
                        uri?.encodedPath, uri?.encodedQuery, uri?.encodedFragment, uri?.encodedUserInfo)
                    if (asset == null) return forbidden()
                    return try {
                        val type = when {
                            asset.endsWith(".js") -> "text/javascript"
                            asset.endsWith(".css") -> "text/css"
                            asset.endsWith(".woff2") -> "font/woff2"
                            else -> "text/html"
                        }
                        WebResourceResponse(type, if (type == "font/woff2") null else "UTF-8", 200, "OK", mapOf(
                            "Content-Security-Policy" to "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
                            "Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff"
                        ), react.assets.open(asset))
                    } catch (_: Exception) { forbidden() }
                }
                override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
                    rendererReady = false; rendererGone = true
                    finish("Terminal renderer stopped. Reopen Terminal from chat.")
                    removeView(web); web.destroy()
                    return true
                }
            }
        }
        addView(web, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        BobAppearance.addListener(this)
        web.loadUrl("https://terminal.bob.invalid/index.html")
    }
    private fun forbidden() = WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", emptyMap(), ByteArrayInputStream(ByteArray(0)))

    fun applyProps() {
        if (disposed) return
        val handle = sessionProp
        if (handle == null) finish()
        else if (handle != admission.session) {
            finish()
            admission.admit(handle)
            generation++
            controls.reset(); ctrl = false
            pending = BobTerminalPrepared.sessions.take(handle)
            val current = generation
            emit("starting")
            if (rendererGone) post { if (generation == current) finish("Terminal renderer stopped. Reopen Terminal from chat.") }
            else if (pending == null) post { if (generation == current) finish("Terminal authorization expired or was already used. Reconnect from chat.") }
            else if (!activeProp || react.reactApplicationContext.lifecycleState != LifecycleState.RESUMED) {
                post { if (generation == current) finish() }
            } else {
                main.removeCallbacks(timeout); main.postDelayed(timeout, 15_000)
                post { if (generation == current) maybeStart() }
            }
        }
        if (!activeProp) finish()
        val command = controlProp
        controlProp = null
        if (command != null) command(command)
    }

    private fun maybeStart() {
        if (disposed || !admission.admitted || !activeProp || !rendererReady || !isAttachedToWindow || width <= 0 || height <= 0) return
        if (react.reactApplicationContext.lifecycleState != LifecycleState.RESUMED) { finish(); return }
        val config = pending ?: return
        pending = null
        val epoch = generation
        val identity = admission.session
        // A new handle explicitly clears renderer history; it never reuses a previous client's IO/ack.
        web.evaluateJavascript("window.bobSession($epoch)", null)
        lateinit var running: TerminalClient
        running = TerminalClient(
            render = { bytes, ticket -> main.post {
                if (!disposed && admission.admitted && generation == epoch && client === running)
                    web.evaluateJavascript("window.bobWrite($epoch,$ticket,'$bytes')", null)
            } },
            ended = { failed -> main.post {
                if (generation == epoch && client === running && admission.session == identity)
                    finish(if (failed) "Terminal IO stopped. Return to chat and reconnect." else null)
            } }
        )
        client = running
        try {
            running.start(File(react.applicationInfo.nativeLibraryDir, "libbob_mosh.so").absolutePath, config)
            main.removeCallbacks(timeout)
            // This means local spawn/PTY success ONLY, not a verified network handshake.
            if (admission.running()) emit("running")
            web.evaluateJavascript("window.bobResize()", null)
        } catch (_: Throwable) { finish("Native Mosh could not start. Return to chat and reconnect.") }
    }
    private inner class RendererBridge {
        @JavascriptInterface fun ready() { main.post {
            if (!disposed && !rendererGone) { rendererReady = true; applyAppearance(); maybeStart() }
        } }
        @JavascriptInterface fun outputConsumed(epoch: Int, ticket: Long) { main.post {
            if (!disposed && epoch == generation && admission.admitted) client?.acknowledge(ticket)
        } }
        @JavascriptInterface fun input(epoch: Int, value: String) { main.post {
            if (disposed || epoch != generation || !admission.admitted) return@post
            if (value.length > 65536) { finish("Terminal input is too large. Return to chat and reconnect."); return@post }
            send(value)
        } }
        @JavascriptInterface fun pasteInput(epoch: Int, sequence: Double, value: String, overflow: Boolean) { main.post {
            val scope = pendingControl ?: return@post
            if (scope.epoch != epoch || scope.ticket.sequence != sequence || scope.ticket.action != "paste" || !isCurrent(scope)) return@post
            if (overflow || value.length > 65536) { finish("Terminal paste is too large. Use a smaller selection and reconnect."); return@post }
            // xterm's generated (possibly bracketed) bytes enter the same bounded writer
            // BEFORE completing the paste ticket. No later Tab/Ctrl may overtake them.
            if (send(value)) complete(scope)
        } }
        @JavascriptInterface fun resize(epoch: Int, cols: Int, rows: Int) { main.post {
            if (!disposed && epoch == generation && admission.admitted) client?.resize(cols, rows)
        } }
    }
    override fun applyAppearance() {
        if (disposed) return
        val colors = BobAppearance.palette(react)
        setBackgroundColor(colors.background)
        if (rendererGone) return
        web.setBackgroundColor(colors.background)
        if (!rendererReady) return
        val theme = JSONObject().put("background", colors.backgroundCss).put("foreground", colors.foregroundCss)
            .put("cursor", colors.foregroundCss).put("cursorAccent", colors.backgroundCss)
        BobTerminalColors.ansi(colors.light).forEach { (name, color) -> theme.put(name, color) }
        val fontSize = 14.0 * resources.configuration.fontScale
        web.evaluateJavascript("window.bobTheme($theme,$fontSize)", null)
    }
    private fun send(value: String): Boolean {
        if (!admission.admitted || client == null) return false
        var text = value
        if (ctrl && text.isNotEmpty()) {
            val code = text[0].uppercaseChar().code
            if (code in 64..95) text = (code - 64).toChar() + text.drop(1)
            ctrl = false
            emit(admission.phase) // Reports only the LAST COMPLETED control, never a pending paste.
        }
        if (text.length > 65536 || client?.send(text) != true) {
            finish("Terminal input stopped. Return to chat and reconnect.")
            return false
        }
        return true
    }
    private fun isCurrent(scope: ControlScope): Boolean = !disposed && admission.admitted && activeProp &&
        rendererReady && client != null && generation == scope.epoch && admission.session == scope.session && controls.isPending(scope.ticket)

    private fun complete(scope: ControlScope) {
        if (!isCurrent(scope) || !controls.complete(scope.ticket)) return
        pendingControl = null
        emit(admission.phase)
    }

    private fun command(value: ReadableMap) {
        if (!admission.admitted || !activeProp || !rendererReady || client == null) return
        var scope: ControlScope? = null
        try {
            val sequence = value.getDouble("sequence")
            val action = value.getString("action") ?: return
            if (action !in listOf("input", "ctrl", "copy", "paste", "history", "keyboard")) return
            // Validate payloads before admission; malformed controls never become acknowledged.
            val inputText = if (action == "input") value.getString("text") ?: return else null
            val enabled = if (action in listOf("ctrl", "keyboard") && value.hasKey("enabled")) value.getBoolean("enabled") else null
            val ticket = controls.admit(sequence, action) ?: return
            val current = ControlScope(generation, admission.session ?: return, ticket)
            scope = current
            pendingControl = current
            when (action) {
                "input" -> if (send(inputText!!)) complete(current)
                "ctrl" -> { ctrl = enabled ?: !ctrl; complete(current) }
                "history" -> if (send("\u0002[")) complete(current)
                "copy" -> {
                    web.evaluateJavascript("window.bobSelection(${current.epoch})") { encoded ->
                        if (!isCurrent(current)) return@evaluateJavascript
                        try {
                            val selected = JSONTokener(encoded).nextValue() as? String
                            if (!selected.isNullOrEmpty() && selected.length <= 65536)
                                (react.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Terminal selection", selected))
                            // Clipboard update OR deliberate no-op is the ordering point, not scheduling JS.
                            complete(current)
                        } catch (_: Exception) { finish("Clipboard copy could not complete. Return to chat and reconnect.") }
                    }
                }
                "paste" -> {
                    val text = (react.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).primaryClip?.getItemAt(0)?.coerceToText(react)?.toString()
                    if (text.isNullOrEmpty()) complete(current)
                    else {
                        if (text.length > 65536 || text.toByteArray(Charsets.UTF_8).size > 65536) {
                            finish("Clipboard paste is too large. Use a smaller selection and reconnect.")
                            return
                        }
                        // Completion comes ONLY from pasteInput after generated bytes are queued.
                        web.evaluateJavascript("window.bobPaste(${current.epoch},$sequence,${JSONObject.quote(text)})", null)
                    }
                }
                "keyboard" -> {
                    val ime = react.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
                    if (enabled != false) {
                        // Mount/start/theme never request focus or show an IME.
                        web.requestFocus()
                        web.evaluateJavascript("window.bobFocus(${current.epoch})") {
                            if (isCurrent(current)) {
                                ime.showSoftInput(web, InputMethodManager.SHOW_IMPLICIT)
                                complete(current)
                            }
                        }
                    } else {
                        web.evaluateJavascript("window.bobBlur(${current.epoch})") {
                            if (isCurrent(current)) {
                                if (web.hasFocus()) { ime.hideSoftInputFromWindow(web.windowToken, 0); web.clearFocus() }
                                complete(current)
                            }
                        }
                    }
                }
            }
        } catch (_: Exception) {
            // Parsing errors are ignored; failures AFTER admission fail closed without leaking details.
            if (scope?.let { isCurrent(it) } == true) finish("Terminal control could not complete. Return to chat and reconnect.")
        }
    }
    private fun emit(phase: String, message: String? = null) {
        val identity = admission.session ?: return
        val epoch = generation
        val snapshot = TerminalStateSnapshot(identity, phase, message, ctrl, controls.completedSequence)
        // Fabric props can precede mounting/event registration. Preserve phase ordering and
        // snapshot the handle: a callback from an old client can never masquerade as a new one.
        post {
            if (disposed || generation != epoch || admission.session != identity || id == View.NO_ID || !react.hasActiveReactInstance()) return@post
            UIManagerHelper.getEventDispatcher(react)?.dispatchEvent(TerminalStateEvent(UIManagerHelper.getSurfaceId(this), id, snapshot))
        }
    }

    private fun finish(message: String? = null) {
        main.removeCallbacks(timeout)
        // RN TextInputState cannot dismiss a WebView textarea. Do this synchronously
        // before destruction, but never hide the IME for a newly focused chat input.
        if (!disposed && web.hasFocus()) {
            (react.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
                .hideSoftInputFromWindow(web.windowToken, 0)
            web.clearFocus()
        }
        pending = null; ctrl = false
        controls.revoke(); pendingControl = null
        client?.close(); client = null
        if (admission.finish(message != null)) emit(admission.phase, message)
        // Keep renderer mounted. Deactivate input without focusing, resizing windows or changing tmux.
        if (rendererReady && !disposed) web.evaluateJavascript("window.bobDeactivate()", null)
    }
    fun dispose() {
        if (disposed) return
        finish(); disposed = true
        sessionProp?.let(BobTerminalPrepared.sessions::remove)
        BobAppearance.removeListener(this); react.removeLifecycleEventListener(this)
        if (!rendererGone) {
            web.removeJavascriptInterface("BobTerminalInput"); web.stopLoading()
            removeView(web); web.destroy()
        }
    }
    // RN lays out the outer native view, not its non-React child. Explicitly size the WebView.
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        super.onMeasure(widthMeasureSpec, heightMeasureSpec)
        if (!rendererGone) web.measure(MeasureSpec.makeMeasureSpec(measuredWidth, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(measuredHeight, MeasureSpec.EXACTLY))
    }
    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        if (!rendererGone) web.layout(0, 0, right - left, bottom - top)
        maybeStart()
    }
    override fun requestLayout() {
        super.requestLayout()
        post { if (!disposed && width > 0 && height > 0) {
            measure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY))
            layout(left, top, right, bottom)
        } }
    }
    override fun onConfigurationChanged(newConfig: Configuration) { super.onConfigurationChanged(newConfig); applyAppearance() }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); post { maybeStart() } }
    override fun onDetachedFromWindow() { finish(); super.onDetachedFromWindow() }
    override fun onHostResume() { /* No re-admission or auto-reexec. */ }
    override fun onHostPause() { finish() }
    override fun onHostDestroy() { dispose() }
}

/** Exact packaged-resource allowlist. No path rewriting, wildcard fonts, URL params, or network fallback. */
internal object TerminalRendererAssets {
    private val resources = mapOf(
        "/index.html" to "terminal/index.html", "/terminal.js" to "terminal/terminal.js",
        "/terminal.css" to "terminal/terminal.css", "/vendor/xterm.js" to "terminal/vendor/xterm.js",
        "/vendor/xterm.css" to "terminal/vendor/xterm.css",
        "/fonts/NordwandMono-Regular.woff2" to "fonts/NordwandMono-Regular.woff2",
        "/fonts/NordwandMono-Bold.woff2" to "fonts/NordwandMono-Bold.woff2",
        "/fonts/NordwandMono-Italic.woff2" to "fonts/NordwandMono-Italic.woff2",
        "/fonts/NordwandMono-BoldItalic.woff2" to "fonts/NordwandMono-BoldItalic.woff2"
    )
    fun path(method: String?, scheme: String?, host: String?, port: Int?, path: String?, query: String?, fragment: String?, userInfo: String?): String? {
        if (method != "GET" || scheme != "https" || host != "terminal.bob.invalid" || port != -1 || query != null || fragment != null || userInfo != null) return null
        return resources[path]
    }
}
