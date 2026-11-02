package com.bobmobile

import org.junit.Assert.*
import org.junit.Test
import java.io.File

/** Source contracts supplement policy tests in this project's JUnit-only Android setup.
 * These deliberately do not claim View dispatch/Activity launch or Robolectric coverage. */
class VisualActionWiringTest {
    private val source get() = File("src/main/java/com/bobmobile/BobInteractive.kt").readText()
    @Test fun onlyNativeClickLaunchesAndDoesNotUseInputIntentExtrasOrPackageTargeting() {
        val panel = source.substringAfter("internal class BobSurfacePanel")
        assertEquals(1, Regex("context\\.startActivity\\(intent\\)").findAll(panel).count())
        assertEquals(1, Regex("launchAction\\(action, this\\)").findAll(panel).count())
        assertTrue(panel.contains("setOnClickListener { launchAction(action, this) }"))
        val launch = panel.substringAfter("private fun launchAction(").substringBefore("private fun createActionFooter")
        assertTrue(launch.contains("Intent(Intent.ACTION_VIEW, Uri.parse(action.url))"))
        for (forbidden in listOf("putExtra", "setPackage", "setComponent", "surfaceRequest", "retry", "AlertDialog")) assertFalse(forbidden, launch.contains(forbidden))
        assertTrue(launch.contains("catch (_: ActivityNotFoundException)")); assertTrue(launch.contains("Nothing was opened."))
    }
    @Test fun webPayloadDoesNotContainActionsAndBridgeCannotLaunch() {
        val payload = source.substringAfter("val payload = JSONObject()\n            for (key").substringBefore("val bundle =")
        assertFalse(payload.contains("actions")); assertFalse(payload.contains("caption"))
        val bridge = source.substringAfter("inner class Bridge").substringBefore("fun dispose()")
        assertFalse(bridge.contains("launchAction")); assertFalse(bridge.contains("startActivity"))
        assertTrue(bridge.contains("if (disposed || raw.length"))
        assertTrue(bridge.contains("selected.resource.optString(\"kind\") != \"mcp\" || parsed.optString(\"method\") != \"callTool\""))
        assertTrue(source.contains("override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true"))
        assertTrue(source.contains("blockNetworkLoads = true")); assertTrue(source.contains("allowContentAccess = false"))
        assertTrue(source.contains("view.addJavascriptInterface(Bridge(), \"BobNative\")"))
    }
    @Test fun clickRechecksAttachedFocusedVisibleCurrentBackendAndDisposal() {
        val active = source.substringAfter("private fun isSurfaceActive()").substringBefore("private fun canRefreshData")
        for (guard in listOf("disposed", "!isAttachedToWindow", "windowVisibility != View.VISIBLE", "!hasWindowFocus()", "ancestor.visibility != View.VISIBLE", "ancestor.alpha <= 0.01f", "getGlobalVisibleRect")) assertTrue(guard, active.contains(guard))
        val launch = source.substringAfter("private fun launchAction(").substringBefore("private fun createActionFooter")
        for (guard in listOf("session ?: return", "!isSurfaceActive()", "inlineOverflow", "NotificationRuntime.visibleBackend != selected.identity", "NotificationRuntime.visibleChat != selected.chat", "!button.isShown", "!button.getGlobalVisibleRect")) assertTrue(guard, launch.contains(guard))
        assertTrue(source.contains("MotionEvent.FLAG_WINDOW_IS_OBSCURED or MotionEvent.FLAG_WINDOW_IS_PARTIALLY_OBSCURED"))
        assertTrue(source.contains("filterTouchesWhenObscured = true"))
        val dispose = source.substringAfter("fun dispose()").substringBefore("class BobInteractiveActivity")
        assertTrue(dispose.contains("disposed = true")); assertTrue(dispose.contains("actionFooter?.visibility = View.GONE"))
        val manager = source.substringAfter("fun setSession(")
        assertTrue(manager.indexOf("?.dispose()") < manager.indexOf("if (handle == null) return"))
    }
    @Test fun liveUpdatesNeverRebuildButtonsAndLegacyVisualsHaveNoFooter() {
        val data = source.substringAfter("internal fun acceptVisualData(").substringBefore("// Reject both fully")
        for (forbidden in listOf("actions", "createActionFooter", "launchAction", "removeView")) assertFalse(forbidden, data.contains(forbidden))
        assertTrue(source.contains("if (actions.isEmpty()) return null"))
        assertTrue(source.contains("val actions = try { VisualActions.fromResource(selected.resource) }"))
        assertTrue(source.contains("if (disposed || session != null) return"))
        assertTrue(source.contains("minHeight = (48 * resources.displayMetrics.density).toInt()"))
        assertTrue(source.contains("textSize = 16f; isAllCaps = false"))
        assertTrue(source.contains("text = \"Destination: \${action.caption}\""))
    }
    @Test fun buttonsExplicitlyWrapAndOversizedFooterPromotesBeforeHtmlIsKnown() {
        val button = source.substringAfter("val button = Button(context)").substringBefore("content.addView(button")
        assertTrue(button.contains("setSingleLine(false)"))
        assertTrue(button.contains("maxLines = Int.MAX_VALUE"))
        assertTrue(button.contains("ellipsize = null"))
        assertTrue(button.contains("setHorizontallyScrolling(false)"))
        val measure = source.substringAfter("override fun onMeasure(").substringBefore("private fun updateInlineSize()")
        assertTrue(measure.contains("inline && availableWidth > 0 && VisualActions.inlineHeight(1, measured, resources.displayMetrics.density) == null"))
        assertFalse(measure.contains("htmlInlineHeight"))
        // Synchronous fallback hides controls during measurement, not after the HTML timeout.
        assertTrue(measure.contains("{\n                showInlineOverflow()\n            } else"))
        assertTrue(measure.indexOf("showInlineOverflow()") < measure.indexOf("super.onMeasure("))
        val overflow = source.substringAfter("private fun showInlineOverflow(").substringBefore("fun show(selected:")
        assertTrue(overflow.contains("actionFooter?.visibility = View.GONE"))
        assertTrue(overflow.contains("emit(\"BobSurfaceOverflow\")"))
    }
    @Test fun nativeBridgeAndApprovedDiagnosticsUseTheSameEmergencyLimit() {
        assertEquals(8192, VisualActions.MAX_INLINE_HEIGHT)
        assertTrue(source.contains("height > VisualActions.MAX_INLINE_HEIGHT"))
        val diagnostics = File("src/main/java/com/bobmobile/ApprovedDiagnostics.kt").readText()
        assertTrue(diagnostics.contains("requested.coerceIn(0, VisualActions.MAX_INLINE_HEIGHT)"))
    }
    @Test fun inlineTotalCombinesHtmlWithUnconstrainedNativeFooterMeasurement() {
        assertTrue(source.contains("content.measure(View.MeasureSpec.makeMeasureSpec(availableWidth, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED))"))
        assertTrue(source.contains("VisualActions.inlineHeight(htmlInlineHeight, footerPixels, resources.displayMetrics.density)"))
        assertTrue(source.contains("if (total == null) { showInlineOverflow(); return }"))
        assertTrue(source.contains("it.putInt(\"height\", total)"))
        assertTrue(source.contains("actionFooter?.visibility = View.GONE"))
        assertTrue(source.contains("pauseData(); dataEnabled = false"))
    }
}
