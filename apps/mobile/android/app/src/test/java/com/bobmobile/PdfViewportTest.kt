package com.bobmobile

import org.junit.Assert.*
import org.junit.Test
import kotlin.random.Random

class PdfViewportTest {
    private fun viewport() = PdfViewport(12f).apply { configure(360, 640, 612, 792) }
    @Test fun fitCentersPaperAndRetainsMargins() {
        val v = viewport()
        assertEquals(1f, v.zoom, 0f); assertEquals(12f, v.left, 0.001f); assertEquals(348f, v.right, 0.001f)
        assertEquals(640f, v.top + v.bottom, 0.001f)
        assertTrue(v.atLeft); assertTrue(v.atRight)
        v.pan(200f, -900f); assertEquals(12f, v.left, 0.001f); assertEquals(640f, v.top + v.bottom, 0.001f)
    }
    @Test fun pinchPreservesTheDocumentPointUnderItsFocus() {
        val v = viewport(); v.zoomAt(2f, 180f, 320f)
        val px = (240f - v.left) / v.scale; val py = (420f - v.top) / v.scale
        v.zoomAt(3.5f, 240f, 420f)
        assertEquals(px, (240f - v.left) / v.scale, 0.001f); assertEquals(py, (420f - v.top) / v.scale, 0.001f)
    }
    @Test fun panningStopsAtPageEdgesAndZoomIsBounded() {
        val v = viewport(); v.zoomAt(900f, 180f, 320f); assertEquals(6f, v.zoom, 0f)
        v.pan(1e8f, 1e8f); assertEquals(12f, v.left, 0f); assertEquals(12f, v.top, 0f); assertTrue(v.atLeft); assertFalse(v.atRight)
        v.pan(-1e8f, -1e8f); assertEquals(348f, v.right, 0.001f); assertEquals(628f, v.bottom, 0.001f); assertTrue(v.atRight); assertFalse(v.atLeft)
        v.zoomAt(-10f, 180f, 320f); assertEquals(1f, v.zoom, 0f)
    }
    @Test fun resizeAndStateRestorePreserveZoomAndDocumentCenter() {
        val v = viewport(); v.restore(3f, 0.52f, 0.48f)
        v.configure(600, 360, 612, 792)
        assertEquals(3f, v.zoom, 0f); assertEquals(0.52f, v.centerX, 0.0001f); assertEquals(0.48f, v.centerY, 0.0001f)
        val restored = viewport(); restored.restore(v.zoom, v.centerX, v.centerY)
        assertEquals(v.zoom, restored.zoom, 0f); assertEquals(v.centerX, restored.centerX, 0.0001f); assertEquals(v.centerY, restored.centerY, 0.0001f)
        restored.configure(360, 640, 792, 612, preserve = false); assertEquals(1f, restored.zoom, 0f)
    }
    @Test fun invalidRestoredAndGestureNumbersNeverPoisonGeometry() {
        val v = viewport(); v.restore(Float.NaN, Float.POSITIVE_INFINITY, Float.NEGATIVE_INFINITY)
        assertEquals(1f, v.zoom, 0f); assertEquals(0.5f, v.centerX, 0.001f)
        v.zoomAt(Float.NaN, 180f, 320f); v.pan(Float.NaN, Float.POSITIVE_INFINITY)
        assertTrue(v.left.isFinite()); assertTrue(v.top.isFinite()); assertEquals(1f, v.zoom, 0f)
    }
    @Test fun visibleRegionOnlyContainsDocumentPoints() {
        val v = viewport(); v.restore(6f, 0.9f, 0.1f)
        val r = v.visible(); assertTrue(r.left >= 0); assertTrue(r.top >= 0); assertTrue(r.right <= 612); assertTrue(r.bottom <= 792)
        assertTrue(r.width > 0); assertTrue(r.height > 0); assertTrue(r.width < 612); assertTrue(r.height < 792)
    }
    @Test fun portraitLandscapeAndHugePagesHaveStrictRasterBudgets() {
        val random = Random(73)
        repeat(1500) {
            val w = random.nextInt(1, 1_000_001).toFloat(); val h = random.nextInt(1, 1_000_001).toFloat()
            for (limit in listOf(PdfViewport.BASE_PIXELS, PdfViewport.DETAIL_PIXELS)) {
                val plan = PdfViewport.raster(PdfRect(0f, 0f, w, h), random.nextDouble(0.0001, 500.0).toFloat(), limit)
                assertTrue(plan.width in 1..3072); assertTrue(plan.height in 1..3072)
                assertTrue(plan.width.toLong() * plan.height <= limit); assertTrue(plan.scale.isFinite() && plan.scale > 0)
                assertTrue(plan.region.width > 0 && plan.region.height > 0)
            }
        }
    }
    @Test fun zoomedTileRendersAtScreenResolutionRatherThanStretchingBasePixels() {
        val v = viewport(); val base = PdfViewport.raster(PdfRect(0f, 0f, 612f, 792f), v.scale, PdfViewport.BASE_PIXELS)
        v.zoomAt(4f, 180f, 320f)
        val tile = PdfViewport.raster(v.visible(), v.scale, PdfViewport.DETAIL_PIXELS)
        assertEquals(v.scale, tile.scale, 0.0001f); assertTrue(tile.scale > base.scale * 3.9f)
        assertTrue(tile.width <= 361); assertTrue(tile.height <= 641)
        assertEquals(tile.region.left * tile.scale, v.visible().left * tile.scale, 0.0001f)
    }
    @Test fun horizontalSwipesRespectDirectionDistanceAndInitialEdgeEligibility() {
        assertEquals(1, PdfViewport.swipe(-90f, 8f, 48f, true, true, false))
        assertEquals(-1, PdfViewport.swipe(90f, -8f, 48f, true, true, false))
        assertEquals(0, PdfViewport.swipe(-47f, 0f, 48f, true, true, false))
        assertEquals(0, PdfViewport.swipe(-90f, 100f, 48f, true, true, false))
        assertEquals(0, PdfViewport.swipe(-200f, 0f, 48f, false, false, false))
        assertEquals(1, PdfViewport.swipe(-200f, 0f, 48f, false, true, false))
    }
    @Test fun anyMultiTouchGestureBlocksPageTurnsEvenAfterAPointerLifts() {
        assertEquals(0, PdfViewport.swipe(-250f, 0f, 48f, true, true, true))
        assertEquals(0, PdfViewport.swipe(250f, 0f, 48f, true, true, true))
    }
    @Test fun latestWorkKeepsOneRunningAndOnlyTheNewestPendingRequest() {
        val queue = LatestPdfWork<Int>(); assertTrue(queue.offer(0)); assertEquals(0, queue.take())
        for (i in 1..1000) assertFalse(queue.offer(i))
        assertTrue(queue.complete()); assertEquals(1000, queue.take()); assertFalse(queue.complete())
        assertTrue(queue.offer(1001)); assertEquals(1001, queue.take()); assertFalse(queue.complete())
    }
    @Test fun closeDiscardsPendingWorkAndRejectsAnyFutureScheduling() {
        val queue = LatestPdfWork<String>(); assertTrue(queue.offer("running")); assertEquals("running", queue.take())
        assertFalse(queue.offer("pending")); queue.close()
        assertNull(queue.take()); assertFalse(queue.complete()); assertFalse(queue.offer("late")); assertNull(queue.take())
    }
}
