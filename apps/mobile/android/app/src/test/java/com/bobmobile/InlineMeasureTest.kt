package com.bobmobile

import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test
import java.io.File

class InlineMeasureTest {
    @Test fun measurementAssetChecksViewportOverflow() {
        val source = File("src/main/assets/inline-measure.js").readText()
        assertTrue(source.contains("root.scrollHeight<=height+1"))
        assertTrue(source.contains("contentHeight>maxHeight"))
        assertTrue(source.contains("maxHeight=8192"))
        assertTrue(source.contains("element.scrollHeight>element.clientHeight+1"))
        assertTrue(source.contains("parent.postMessage({bobLayout:key,...value},'*')"))
        assertTrue(source.contains("viewportFits:"))
    }

    @Test fun inlineGesturesCanReachParentWithoutDisablingTapsOrFullScreenScroll() {
        val source = File("src/main/java/com/bobmobile/BobInteractive.kt").readText()
        assertTrue(source.contains("super.requestDisallowInterceptTouchEvent(if (inline) false else disallowIntercept)"))
        assertTrue(source.contains("if (inline) super.scrollTo(0, 0) else super.scrollTo(x, y)"))
        val overscroll = source.substringAfter("override fun overScrollBy(").substringBefore("}; web = view")
        assertTrue(overscroll.contains("if (inline) return false"))
        assertTrue(overscroll.contains("return super.overScrollBy("))
        assertFalse(source.contains("setOnTouchListener")) // no blanket touch consumption
    }

    @Test fun inlineWebViewLeavesLayoutKeySubstitutionToTheHost() {
        val source = File("src/main/java/com/bobmobile/BobInteractive.kt").readText()
        assertTrue(source.contains("context.assets.open(\"inline-measure.js\")"))
        assertTrue(source.contains("JSONObject.quote(inlineMeasure)"))
        // The native nonce grants bridge authority. Layout telemetry uses a
        // different, per-iframe key substituted by host.ts, never this nonce.
        assertFalse(source.contains("replace(\"__BOB_INLINE_LAYOUT_KEY__\""))
    }
}
