package com.bobmobile

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.graphics.Bitmap
import android.os.Bundle
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.webkit.WebView
import android.widget.FrameLayout
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.io.File
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.roundToInt

/** Real production BobSurfacePanel, WebView, loadDataWithBaseURL, opaque iframe,
 * measurement asset and native JS bridge. No production backend, pairing, Metro
 * or owner data; live-data scenarios use an isolated test-only loopback fixture.
 * The separate RN test covers the final BobSurfaceOverflow -> title row placement.
 */
class InlineSurfaceInstrumentation : Instrumentation() {
    private lateinit var activity: InlineProbeActivity
    private lateinit var panel: BobSurfacePanel
    private lateinit var web: WebView
    private var only: String? = null
    private val results = JSONArray()
    override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); only = arguments?.getString("case"); start() }
    override fun onStart() {
        try {
            activity = startActivitySync(Intent(targetContext, InlineProbeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as InlineProbeActivity
            scenario("compact") {
                open(fixture())
                awaitFit()
                Thread.sleep(3500) // Must still be visible after the old fallback deadline.
                assertFit()
                val probe = snapshot().getJSONObject("probe")
                check(probe.getInt("width") == 313 && probe.getInt("height") in 100..160) { "Card did not shrink to natural height: $probe" }
                check(probe.getInt("scrollWidth") <= 313 && probe.getInt("scrollHeight") == probe.getInt("height")) { "Internal scrolling: $probe" }
                val location = IntArray(2)
                runOnMainSync { web.getLocationOnScreen(location) }
                val density = activity.resources.displayMetrics.density
                // A painted green pixel proves that this is not just a transparent/black fit report.
                val screenshot = uiAutomation.takeScreenshot() ?: error("Screenshot unavailable")
                val pixel = screenshot.getPixel(location[0] + (8 * density).roundToInt(), location[1] + (8 * density).roundToInt()) and 0xffffff
                check(pixel == 0x176b45) { "Content not painted: pixel=${pixel.toString(16)}, ${snapshot()}" }
                File(targetContext.filesDir, "inline-compact.png").outputStream().use { screenshot.compress(Bitmap.CompressFormat.PNG, 100, it) }
                screenshot.recycle()
                tapButton()
                await("inline button click") { snapshot().optJSONObject("probe")?.optInt("clicks") == 1 }
                assertFit()
                // Mimic a virtualized list temporarily detaching a measured native row.
                runOnMainSync { activity.container.removeView(panel) }
                Thread.sleep(400)
                runOnMainSync { activity.container.addView(panel) }
                Thread.sleep(600)
                assertFit()
            }
            scenario("exact-viewport") { open(fixture("body{height:420px}")); awaitFit(); Thread.sleep(3500); assertFit(); check(snapshot().getInt("height") == 420) }
            scenario("grow-shrink") {
                open(fixture(script = "setTimeout(()=>document.body.style.height='320px',1000);setTimeout(()=>document.body.style.height='180px',2400)"))
                awaitFit()
                await("grow to 320 CSS px") { snapshot().getInt("height") == 320 && snapshot().optString("opacity") == "1" }
                await("shrink to 180 CSS px") { snapshot().getInt("height") == 180 && snapshot().optString("opacity") == "1" }
                assertFit()
            }
            scenario("overflow") { open(fixture("body{height:650px}")); awaitFullView() }
            scenario("nested-overflow") { open(fixture(extra = "<div style='height:30px;overflow:auto'><div style='height:150px'>Too tall</div></div>")); awaitFullView() }
            scenario("grows-after-fit") {
                open(fixture(script = "setTimeout(()=>document.body.style.height='650px',1500)"))
                awaitFit(); awaitFullView()
            }
            scenario("missing-measurement") {
                open("<body><script>requestAnimationFrame=()=>0;setInterval=()=>0;</script>No report</body>")
                Thread.sleep(500)
                check(snapshot().getBoolean("nativeVisible")) { "Fallback fired before timeout" }
                awaitFullView()
                check(snapshot().optString("reason") == "measurement-timeout") { "Wrong fallback reason: ${snapshot()}" }
            }
            scenario("missing-resize-ack") {
                open(fixture(), acknowledgeResize = false); awaitFullView()
                check(snapshot().optString("reason") == "measurement-timeout")
            }
            scenario("live-data") {
                val id = UUID.randomUUID().toString()
                VisualDataFixture(id).use { data ->
                    open(liveFixture(), source = data)
                    awaitFit(); await("initial saved data") { snapshot().getJSONObject("probe").optInt("revision") == 1 }
                    val compactHeight = snapshot().getInt("height")
                    tapButton(); await("local click") { snapshot().getJSONObject("probe").optInt("clicks") == 1 }
                    data.advance(2, "Live update", 110)
                    await("HTTP live data and growth") { val s = snapshot(); s.getJSONObject("probe").optInt("revision") == 2 && s.getInt("height") > compactHeight && s.optString("opacity") == "1" }
                    var probe = snapshot().getJSONObject("probe")
                    check(probe.getString("text") == "Live update" && probe.getInt("clicks") == 1 && probe.getString("input") == "local edit" && probe.getInt("mounts") == 1) { "Reload/reset during data update: $probe" }
                    data.advance(3, "Smaller", 0)
                    await("HTTP data shrink") { val s = snapshot(); s.getJSONObject("probe").optInt("revision") == 3 && s.getInt("height") == compactHeight && s.optString("opacity") == "1" }
                    data.advance(2, "Stale", 200)
                    Thread.sleep(2400); probe = snapshot().getJSONObject("probe")
                    check(probe.getInt("revision") == 3 && probe.getString("text") == "Smaller") { "Stale response applied: $probe" }
                    runOnMainSync { activity.container.removeView(panel) }
                    Thread.sleep(400); val pausedReads = data.reads.get(); Thread.sleep(2400)
                    check(data.reads.get() == pausedReads) { "Detached surface continued polling" }
                    data.advance(4, "Reconnected", 60)
                    runOnMainSync { activity.container.addView(panel) }
                    await("reconnect catches latest data") { snapshot().getJSONObject("probe").optInt("revision") == 4 && snapshot().optString("opacity") == "1" }
                    check(snapshot().getJSONObject("probe").getInt("clicks") == 1)
                    runOnMainSync { activity.container.alpha = 0f }
                    Thread.sleep(400); val hiddenReads = data.reads.get(); Thread.sleep(2400)
                    check(data.reads.get() == hiddenReads) { "Opacity-hidden chat continued polling" }
                    data.advance(5, "Visible again", 0)
                    runOnMainSync { activity.container.alpha = 1f }
                    await("visible chat catches up") { snapshot().getJSONObject("probe").optInt("revision") == 5 && snapshot().optString("opacity") == "1" }
                    assertFit()
                }
            }
            scenario("fullscreen-data") {
                VisualDataFixture(UUID.randomUUID().toString()).use { data ->
                    open(liveFixture(), source = data, inline = false)
                    await("fullscreen initial data") { snapshot().optJSONObject("probe")?.optInt("revision") == 1 }
                    data.advance(2, "Fullscreen update", 650)
                    await("fullscreen live data") { snapshot().getJSONObject("probe").optInt("revision") == 2 }
                    check(snapshot().getBoolean("nativeVisible") && snapshot().optString("visibility") != "hidden")
                }
            }
            scenario("reported-examples") {
                val examples = JSONArray(context.assets.open("examples.json").bufferedReader().use { it.readText() })
                for (index in 0 until examples.length()) {
                    val example = examples.getJSONObject(index)
                    val probe = "<script>setInterval(()=>parent.postMessage({inlineProbe:true,name:'${example.getString("name")}',width:innerWidth,height:innerHeight,elements:[document.documentElement,document.body,...document.body.querySelectorAll('*')].filter(e=>e.getClientRects().length).map(e=>({tag:e.tagName,id:e.id,rect:e.getBoundingClientRect().toJSON(),client:[e.clientWidth,e.clientHeight],scroll:[e.scrollWidth,e.scrollHeight]}))},'*'),100);</script>"
                    open(example.getString("html") + probe, initialData = example.optJSONObject("visualData"))
                    awaitFit(); Thread.sleep(3500); assertFit()
                }
            }
            scenario("approved-report") {
                for (index in 0 until 70) ApprovedDiagnostics.record(activity, "resize", 821, 477, 182)
                ApprovedDiagnostics.record(activity, "https://private.invalid/token", 1, 1)
                val report = JSONObject(ApprovedDiagnostics.report(activity))
                check(report.getInt("schema") == 1 && report.getJSONArray("inline").length() == 64)
                check(!report.toString().contains("private.invalid") && !report.has("deviceModel") && !report.has("crashes") && !report.has("runtime"))
                check(report.getString("webViewVersion") != "unavailable")
                for (index in 0 until report.getJSONArray("inline").length()) check(report.getJSONArray("inline").getJSONObject(index).length() == 5)
            }
            if (only == null || only == "react-scroll") reactScenario(false)
            if (only == null || only == "react-inverted") reactScenario(true)
            finish(Activity.RESULT_OK, Bundle().apply { putString("stream", "\nINLINE_WEBVIEW_RESULTS=$results\n") })
        } catch (error: Throwable) {
            finish(Activity.RESULT_CANCELED, Bundle().apply { putString("stream", "\nINLINE_WEBVIEW_FAILED: ${error.stackTraceToString()}\nResults=$results\n") })
        } finally {
            if (::activity.isInitialized) runOnMainSync { if (::panel.isInitialized) panel.dispose(); activity.finish() }
        }
    }
    private fun reactScenario(inverted: Boolean) {
        val examples = JSONArray(context.assets.open("examples.json").bufferedReader().use { it.readText() })
        val servers = mutableListOf<VisualDataFixture>()
        val props = JSONArray()
        val backend = UUID.randomUUID().toString()
        var reactActivity: InlineReactProbeActivity? = null
        InlineProbeEvents.values.clear()
        try {
            for (i in 0 until examples.length()) {
                val example = examples.getJSONObject(i)
                val server = VisualDataFixture(UUID.randomUUID().toString(), example.getString("html"), example.optJSONObject("visualData")); servers.add(server)
                props.put(JSONObject().put("backend", JSONObject().put("backendId", backend).put("endpoint", server.endpoint))
                    .put("surface", JSONObject().put("id", server.id).put("conversationId", 1).put("kind", "visual").put("presentation", "inline").put("title", example.getString("name"))))
            }
            reactActivity = startActivitySync(Intent(targetContext, InlineReactProbeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("fixtures", props.toString()).putExtra("inverted", inverted)) as InlineReactProbeActivity
            val states = JSONArray()
            val deadline = SystemClock.uptimeMillis() + 20000
            var ready = false
            while (SystemClock.uptimeMillis() < deadline) {
                check(InlineProbeEvents.values.none { it.optString("name") == "BobSurfaceOverflow" }) { "Real RN row fell back: ${InlineProbeEvents.values}; last states=$states" }
                val views = mutableListOf<WebView>()
                runOnMainSync { collectWebViews(reactActivity.window.decorView, views) }
                while (states.length() > 0) states.remove(0)
                for (view in views) {
                    val latch = CountDownLatch(1); var value: String? = null
                    runOnMainSync { view.evaluateJavascript("JSON.stringify({opacity:document.querySelector('iframe')?.style.opacity,reason:document.querySelector('iframe')?.dataset.bobLayoutReason,width:innerWidth,height:innerHeight})") { value = JSONTokener(it).nextValue() as? String; latch.countDown() } }
                    check(latch.await(3, TimeUnit.SECONDS)) { "RN WebView not responsive; events=${InlineProbeEvents.values}" }
                    val state = JSONObject(value ?: "{}")
                    runOnMainSync { state.put("nativeHeight", view.height).put("nativeWidth", view.width) }
                    states.put(state)
                }
                if (states.length() == examples.length() && (0 until states.length()).all { states.getJSONObject(it).optString("opacity") == "1" }) { ready = true; break }
                Thread.sleep(100)
            }
            check(ready) { "Real RN rows never fitted: states=$states, events=${InlineProbeEvents.values}" }
            Thread.sleep(3500)
            check(InlineProbeEvents.values.none { it.optString("name") == "BobSurfaceOverflow" }) { "Real RN rows later fell back: ${InlineProbeEvents.values}" }
            results.put(JSONObject().put("case", if (inverted) "react-inverted" else "react-scroll").put("states", states).put("events", JSONArray(InlineProbeEvents.values)))
        } finally {
            reactActivity?.let { runOnMainSync { it.finish() } }
            servers.forEach { it.close() }
        }
    }
    private fun collectWebViews(view: View, target: MutableList<WebView>) {
        if (view is WebView) target.add(view)
        if (view is android.view.ViewGroup) for (i in 0 until view.childCount) collectWebViews(view.getChildAt(i), target)
    }
    private fun scenario(name: String, check: () -> Unit) {
        if (only != null && only != name) return
        check()
        results.put(JSONObject().put("case", name).put("snapshot", snapshot()))
    }
    private fun tapButton() {
        // JS fit telemetry precedes Android's next composited frame. Wait for
        // WebView's real visual-state barrier before injecting a physical tap.
        val painted = CountDownLatch(1)
        runOnMainSync { web.postVisualStateCallback(1, object : WebView.VisualStateCallback() { override fun onComplete(id: Long) { painted.countDown() } }) }
        check(painted.await(5, TimeUnit.SECONDS)) { "WebView did not reach a drawable state" }
        waitForIdleSync()
        uiAutomation.takeScreenshot()?.let { image -> File(targetContext.filesDir, "inline-before-tap.png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }; image.recycle() }
        val location = IntArray(2); runOnMainSync { web.getLocationOnScreen(location) }
        val density = activity.resources.displayMetrics.density
        val x = location[0] + 80 * density; val y = location[1] + 80 * density; val time = SystemClock.uptimeMillis()
        sendPointerSync(MotionEvent.obtain(time, time, MotionEvent.ACTION_DOWN, x, y, 0))
        sendPointerSync(MotionEvent.obtain(time, time + 60, MotionEvent.ACTION_UP, x, y, 0))
    }
    private fun liveFixture() = fixture(extra = "<input id='local' style='width:100%' value='initial'><p id='live'>Waiting</p><div id='extra'></div>", script = "window.mounts=(window.mounts||0)+1;bobVisual.subscribe(({data})=>{if(data){document.getElementById('live').textContent=data.text;document.getElementById('extra').style.height=data.height+'px';}})")
    private fun fixture(css: String = "", extra: String = "", script: String = "") = """
        <!doctype html><html><head><style>*{box-sizing:border-box}body{margin:0;padding:16px;background:#176b45;color:white;font:16px sans-serif}p{margin:0}button{display:block;margin-top:16px;height:48px;padding:8px 16px;font:inherit}$css</style></head>
        <body><p>Compact inline check</p><button onclick="window.clicks=(window.clicks||0)+1;this.textContent='Clicked';if(document.getElementById('local'))document.getElementById('local').value='local edit'">Tap to test</button>$extra
        <script>setInterval(()=>parent.postMessage({inlineProbe:true,width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,clicks:window.clicks||0,revision:window.bobVisual?.current?.revision,text:document.getElementById('live')?.textContent,input:document.getElementById('local')?.value,mounts:window.mounts},'*'),100);$script</script></body></html>
    """.trimIndent()
    private fun open(html: String, acknowledgeResize: Boolean = true, source: VisualDataFixture? = null, inline: Boolean = true, initialData: JSONObject? = null) {
        runOnMainSync {
            if (::panel.isInitialized) panel.dispose()
            activity.container.removeAllViews()
            val density = activity.resources.displayMetrics.density
            panel = BobSurfacePanel(activity, {}, inline, "test-mount") { height ->
                if (acknowledgeResize) panel.layoutParams = panel.layoutParams.apply { this.height = (height * density).toInt() }
            }
            activity.container.addView(panel, FrameLayout.LayoutParams((313 * density).toInt(), (420 * density).toInt()))
            val id = source?.id ?: UUID.randomUUID().toString()
            val resource = JSONObject().put("id", id).put("kind", "visual").put("title", "Inline regression")
                .put("html", html).put("allowedTools", JSONArray()).put("capability", "test-only")
            if (source != null) resource.put("visualData", source.snapshot())
            if (initialData != null) resource.put("visualData", JSONObject(initialData.toString()).put("id", id).put("conversationId", 1))
            panel.show(SurfaceSession(source?.endpoint ?: "invalid://test-only", "test-only", "no-credentials", 1, id, resource))
            web = (0 until panel.childCount).map { panel.getChildAt(it) }.filterIsInstance<WebView>().single()
        }
        await("host load") { eval("typeof window.startBobSurface==='function'") == true }
        eval("window.addEventListener('message',e=>{if(e.data?.inlineProbe)window.__inlineProbe=e.data});true")
    }
    private fun eval(source: String): Any? {
        val latch = CountDownLatch(1); var result: Any? = null
        runOnMainSync { web.evaluateJavascript(source) { result = JSONTokener(it).nextValue(); latch.countDown() } }
        check(latch.await(5, TimeUnit.SECONDS)) { "WebView JS did not respond" }
        return result
    }
    private fun snapshot(): JSONObject {
        val json = eval("JSON.stringify((()=>{const f=document.querySelector('iframe');return {opacity:f?.style.opacity,visibility:f?.style.visibility,reason:f?.dataset.bobLayoutReason,status:document.querySelector('#status')?.textContent,width:innerWidth,height:innerHeight,probe:window.__inlineProbe}})())") as? String ?: "{}"
        val snapshot = JSONObject(json)
        runOnMainSync { snapshot.put("nativeVisible", web.visibility == View.VISIBLE).put("nativeWidth", web.width).put("nativeHeight", web.height) }
        return snapshot
    }
    private fun assertFit() {
        val state = snapshot()
        check(state.getBoolean("nativeVisible") && state.optString("opacity") == "1" && state.optString("visibility") != "hidden" && state.optString("status").isEmpty()) { "Fitting visual hidden: $state" }
    }
    private fun awaitFit() = await("fit report") { val s = snapshot(); s.optString("opacity") == "1" && s.optJSONObject("probe") != null }
    private fun awaitFullView() = await("native full-view promotion") { val s = snapshot(); !s.getBoolean("nativeVisible") && s.optString("visibility") == "hidden" }
    private fun await(label: String, condition: () -> Boolean) {
        val end = SystemClock.uptimeMillis() + 8000
        while (SystemClock.uptimeMillis() < end) { if (condition()) return; Thread.sleep(100) }
        error("Timed out waiting for $label: ${if (::web.isInitialized) snapshot() else "no WebView"}")
    }
}
