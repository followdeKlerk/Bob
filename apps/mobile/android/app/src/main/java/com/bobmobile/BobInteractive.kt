package com.bobmobile

import android.content.Context
import android.view.View
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.os.Bundle
import android.webkit.*
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.net.HttpURLConnection
import java.net.URI
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.Semaphore

internal data class SurfaceSession(val endpoint: String, val identity: String, val token: String, val chat: Long, val id: String, val resource: JSONObject)
private object SurfaceSessions { val pending = ConcurrentHashMap<String, SurfaceSession>() }
private fun surfaceRequest(endpoint: String, identity: String, token: String, path: String, payload: JSONObject): JSONObject {
    val uri = URI(endpoint)
    require(uri.userInfo == null && uri.query == null && uri.fragment == null && (uri.path.isEmpty() || uri.path == "/"))
    require((uri.scheme == "https" && uri.host?.endsWith(".ts.net") == true) || (BuildConfig.DEBUG && uri.scheme == "http" && uri.host == "127.0.0.1" && uri.port in 1..65535)) { "Verified paired transport required" }
    val connection = URI(endpoint.trimEnd('/') + path).toURL().openConnection() as HttpURLConnection
    try {
        connection.instanceFollowRedirects = false; connection.connectTimeout = 15000; connection.readTimeout = 40000
        connection.requestMethod = "POST"; connection.doOutput = true
        connection.setRequestProperty("Authorization", "Bearer $token"); connection.setRequestProperty("x-bob-backend", identity)
        connection.setRequestProperty("Content-Type", "application/json")
        connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
        require(connection.responseCode in 200..299) { "Interactive request rejected (HTTP ${connection.responseCode}); do not automatically retry a tool action" }
        val output = java.io.ByteArrayOutputStream()
        connection.inputStream.use { input -> val buffer = ByteArray(8192)
            while (true) { val n = input.read(buffer); if (n < 0) break; require(output.size() + n <= 4194304) { "Interactive response too large" }; output.write(buffer, 0, n) }
        }
        return JSONObject(String(output.toByteArray(), Charsets.UTF_8))
    } finally { connection.disconnect() }
}
class BobInteractive(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "BobInteractive"
    @ReactMethod fun prepare(endpoint: String, identity: String, token: String, chat: Double, id: String, promise: Promise) {
        Thread {
            try {
                require(chat > 0 && chat % 1.0 == 0.0); UUID.fromString(id); UUID.fromString(identity)
                require(SurfaceSessions.pending.size < 8) { "Too many pending interactive surfaces" }
                val resource = surfaceRequest(endpoint, identity, token, "/v1/chats/${chat.toLong()}/ui/$id/open", JSONObject())
                require(resource.getString("id") == id && resource.getString("html").length <= 2097152)
                val handle = UUID.randomUUID().toString()
                SurfaceSessions.pending[handle] = SurfaceSession(endpoint, identity, token, chat.toLong(), id, resource)
                promise.resolve(handle)
            } catch (e: Exception) { promise.reject("interactive", e.message ?: "Unable to open content") }
        }.start()
    }
    @ReactMethod fun releasePrepared(handle: String) {
        val selected = SurfaceSessions.pending.remove(handle) ?: return
        Thread { try { surfaceRequest(selected.endpoint, selected.identity, selected.token, "/v1/chats/${selected.chat}/ui/${selected.id}/close", JSONObject().put("capability", selected.resource.getString("capability"))) } catch (_: Exception) {} }.start()
    }
    @ReactMethod fun open(endpoint: String, identity: String, token: String, chat: Double, id: String, promise: Promise) {
        Thread {
            try {
                require(chat > 0 && chat % 1.0 == 0.0); UUID.fromString(id); UUID.fromString(identity)
                val resource = surfaceRequest(endpoint, identity, token, "/v1/chats/${chat.toLong()}/ui/$id/open", JSONObject())
                require(resource.getString("id") == id && resource.getString("html").length <= 2097152)
                require(SurfaceSessions.pending.size < 8) { "Too many pending interactive surfaces" }
                val session = UUID.randomUUID().toString()
                SurfaceSessions.pending[session] = SurfaceSession(endpoint, identity, token, chat.toLong(), id, resource)
                context.startActivity(Intent(context, BobInteractiveActivity::class.java).putExtra("session", session).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                promise.resolve("Opened isolated surface")
            } catch (e: Exception) { promise.reject("interactive", e.message ?: "Unable to open interactive surface") }
        }.start()
    }
}
internal class BobSurfacePanel(context: Context, private val onClose: () -> Unit, private val inline: Boolean = false) : LinearLayout(context) {
    private var disposed = false
    private var approval: AlertDialog? = null
    private var session: SurfaceSession? = null
    private var web: WebView? = null
    private val nonce = UUID.randomUUID().toString() + UUID.randomUUID().toString()
    private val executor = Executors.newFixedThreadPool(2)
    private val requests = Semaphore(4)
    private lateinit var status: TextView
    fun show(selected: SurfaceSession) {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(0xff000000.toInt())
        val layout = this
        status = TextView(context).apply { setTextColor(0xfff4f4f5.toInt()); textSize = 15f; setTextIsSelectable(true); visibility = View.GONE }
        layout.addView(status)
        session = selected
        val start: () -> Unit = start@{
            if (disposed) return@start
            val view = WebView(context); web = view
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
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest) = WebResourceResponse("text/plain", "utf-8", 403, "Blocked", mapOf("Cache-Control" to "no-store"), ByteArrayInputStream("Network access denied".toByteArray()))
                override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean { layout.removeView(view); view.destroy(); web = null; status.visibility = View.VISIBLE; status.text = "Interactive content stopped. Reopen to try again; no tool action was retried."; return true }
            }
            view.webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest) { request.deny() }
                override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult): Boolean { result.cancel(); return true }
                override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult): Boolean { result.cancel(); return true }
                override fun onJsPrompt(view: WebView, url: String, message: String, defaultValue: String, result: JsPromptResult): Boolean { result.cancel(); return true }
            }
            view.addJavascriptInterface(Bridge(), "BobNative")
            layout.addView(view, LinearLayout.LayoutParams(-1, 0, 1f))
            val payload = JSONObject()
            for (key in listOf("kind", "title", "html", "input", "result", "allowedTools")) if (selected.resource.has(key)) payload.put(key, selected.resource.get(key))
            val bundle = context.assets.open("bob-host.js").bufferedReader().use { it.readText() }.replace("</script", "<\\/script")
            val safePayload = payload.toString().replace("<", "\\u003c")
            val html = """<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src about: data: blob:; img-src data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body{height:100%;margin:0;background:#000000;color:#f4f4f5;font:15px sans-serif}body{display:flex;flex-direction:column}#status{padding:8px}#status:empty{display:none}#surface{flex:1;min-height:0}</style></head><body><div id="status" role="status" aria-live="polite">Loading isolated content…</div><div id="surface"></div><script>$bundle
window.startBobSurface($safePayload,${JSONObject.quote(nonce)},${if (inline) "true" else "false"}).catch(e=>document.getElementById('status').textContent='Unavailable: '+e.message);</script></body></html>"""
            view.loadDataWithBaseURL("https://bob.invalid/", html, "text/html", "utf-8", null)
        }
        if (selected.resource.optString("kind") == "mcp") {
            val names = selected.resource.optJSONArray("allowedTools")?.toString() ?: "[]"
            approval = AlertDialog.Builder((context as? ThemedReactContext)?.currentActivity ?: context).setTitle("Allow this MCP App's scoped tools?")
                .setMessage("Only this conversation and configured MCP server are granted. Allowed tools: $names\nThe app can call these tools while open. No ambient host or network access is granted.")
                .setPositiveButton("Open with these tools") { _, _ -> start() }
                .setNegativeButton("Cancel") { _, _ -> dispose(); onClose() }.setOnCancelListener { dispose(); onClose() }.show()
        } else start()
    }
    private fun reply(id: String, value: JSONObject) {
        post { if (!disposed) web?.evaluateJavascript("window.__bobReply(${JSONObject.quote(id)},${value.toString().replace("<", "\\u003c")})", null) }
    }
    inner class Bridge {
        @JavascriptInterface fun request(raw: String, key: String) {
            // Android exposes JS interfaces to every frame. Only the trusted opaque-parent host knows this nonce.
            if (raw.length > 65536 || key.length != nonce.length || !MessageDigest.isEqual(key.toByteArray(), nonce.toByteArray())) return
            val selected = session ?: return
            val parsed = try { JSONObject(raw) } catch (_: Exception) { return }
            if (parsed.optString("method") == "overflow" && inline) {
                post {
                    if (!disposed) {
                        web?.visibility = View.INVISIBLE
                        val event = Arguments.createMap().apply {
                            putString("backendId", selected.identity); putDouble("conversationId", selected.chat.toDouble()); putString("id", selected.id)
                        }
                        (context as? ThemedReactContext)?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)?.emit("BobSurfaceOverflow", event)
                    }
                }
                return
            }
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
        disposed = true
        approval?.setOnCancelListener(null); approval?.dismiss(); approval = null
        web?.removeJavascriptInterface("BobNative"); web?.destroy(); web = null; executor.shutdownNow()
        val selected = session; session = null
        if (selected != null) Thread {
            try { surfaceRequest(selected.endpoint, selected.identity, selected.token, "/v1/chats/${selected.chat}/ui/${selected.id}/close", JSONObject().put("capability", selected.resource.getString("capability"))) } catch (_: Exception) { /* Capabilities also expire server-side. */ }
        }.start()

    }
}


class BobInteractiveActivity : Activity() {
    private var panel: BobSurfacePanel? = null
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val selected = SurfaceSessions.pending.remove(intent.getStringExtra("session"))
        if (selected == null) {
            setContentView(TextView(this).apply { text = "Content expired. Return to chat and reopen it." }); return
        }
        val surface = BobSurfacePanel(this, { finish() })
        panel = surface
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(surface) { view, insets ->
            val safe = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars() or androidx.core.view.WindowInsetsCompat.Type.displayCutout())
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom); insets
        }
        setContentView(surface)
        surface.show(selected)
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
        if (handle == null || host.tag == handle) return
        (host.getChildAt(0) as? BobSurfacePanel)?.dispose(); host.removeAllViews(); host.tag = handle
        val selected = SurfaceSessions.pending.remove(handle) ?: return
        val surface = BobSurfacePanel(host.context, {
            host.removeAllViews()
            host.addView(TextView(host.context).apply { text = "Opening cancelled. Expand to reopen."; setTextColor(0xffa1a1aa.toInt()) })
        }, true)
        host.addView(surface, LinearLayout.LayoutParams(-1, -1))
        surface.show(selected)
    }
    override fun onDropViewInstance(view: LinearLayout) {
        (view.getChildAt(0) as? BobSurfacePanel)?.dispose(); view.removeAllViews()
        super.onDropViewInstance(view)
    }
}
