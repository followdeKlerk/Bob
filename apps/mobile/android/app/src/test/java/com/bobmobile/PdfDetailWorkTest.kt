package com.bobmobile

import org.junit.Assert.*
import org.junit.Test

class PdfDetailWorkTest {
    private fun viewport() = PdfViewport(12f).apply {
        configure(1440, 2560, 612, 792)
        restore(4f, 0f, 0f)
    }
    private fun key(v: PdfViewport, page: Int = 0, generation: Long = 1) =
        PdfRasterKey(page, generation, PdfViewport.raster(v.visible(), v.scale, PdfViewport.DETAIL_PIXELS))

    /** Synthetic renderer: exercises real geometry, key equality and queue admission, not Android rasterization. */
    private class Work(private val deduplicate: Boolean = true) {
        private val queue = LatestPdfWork<PdfRasterKey>()
        var published: PdfRasterKey? = null
        var renders = 0; private set
        var rasterBytes = 0L; private set
        fun offer(key: PdfRasterKey) = queue.offer(key, skipIfIdle = deduplicate && published == key)
        fun take(): PdfRasterKey = requireNotNull(queue.take()).also {
            renders++
            rasterBytes += it.plan.width.toLong() * it.plan.height * 4
        }
        fun complete(key: PdfRasterKey, publish: Boolean = true): Boolean {
            if (publish) published = key
            return queue.complete()
        }
        fun refine(key: PdfRasterKey, publish: Boolean = true) {
            if (offer(key)) assertFalse(complete(take(), publish))
        }
    }

    @Test fun settledStationaryCancelAndEdgeClampedRefinementsDoNoMoreRasterWork() {
        val v = viewport(); val initial = key(v)
        val before = Work(deduplicate = false); val after = Work()
        fun refine() {
            val candidate = key(v)
            assertEquals(initial, candidate)
            before.refine(candidate); after.refine(candidate)
        }
        refine()
        repeat(1000) {
            refine() // Stationary gesture: no geometry mutation.
            v.pan(0f, 0f); refine() // Cancel without a transform.
            v.pan(80f, 90f); refine() // Outward movement at the top-left clamp.
        }
        assertEquals(3001, before.renders)
        assertEquals(1, after.renders)
        val bytes = initial.plan.width.toLong() * initial.plan.height * 4
        assertEquals(3001 * bytes, before.rasterBytes)
        assertEquals(bytes, after.rasterBytes)
        println("PDF synthetic settled refinements: before=${before.renders}, after=${after.renders}, bytesPerRaster=$bytes, avoidedRasterBytes=${before.rasterBytes - after.rasterBytes}")
    }

    @Test fun failuresAndUnpublishedResultsRemainRetryable() {
        val a = key(viewport()); val work = Work()
        repeat(2) { work.refine(a, publish = false); assertNull(work.published) }
        work.refine(a)
        assertEquals(3, work.renders)
        work.refine(a); assertEquals(3, work.renders)

        val b = a.copy(plan = a.plan.copy(scale = a.plan.scale * 0.9f))
        work.refine(b, publish = false) // Failed refinement keeps readable A.
        assertEquals(a, work.published)
        work.refine(b); work.refine(b)
        assertEquals(5, work.renders); assertEquals(b, work.published)
        work.published = null // Detail dropped when the base alone suffices (fit).
        work.refine(b)
        assertEquals(6, work.renders)
    }

    @Test fun actualPanZoomResizePageAndGenerationChangesStillRender() {
        val v = viewport(); val work = Work()
        var previous = key(v)
        work.refine(previous)
        fun changed(candidate: PdfRasterKey) {
            assertNotEquals(previous, candidate)
            val count = work.renders
            work.refine(candidate); work.refine(candidate)
            assertEquals(count + 1, work.renders)
            previous = candidate
        }
        v.pan(-80f, -90f); changed(key(v))
        v.zoomAt(5f, 720f, 1280f); changed(key(v))
        v.configure(2560, 1440, 612, 792); changed(key(v))
        changed(key(v, page = 1, generation = 2))
        changed(previous.copy(generation = 3)) // Reopen the same page with identical geometry.
        assertEquals(6, work.renders)
    }

    @Test fun exactKeyIncludesEveryRasterFieldNotJustBitmapDimensions() {
        val a = key(viewport()); val p = a.plan
        val changes = listOf(
            a.copy(page = a.page + 1), a.copy(generation = a.generation + 1),
            a.copy(plan = p.copy(region = p.region.copy(left = p.region.left + 1f))),
            a.copy(plan = p.copy(region = p.region.copy(top = p.region.top + 1f))),
            a.copy(plan = p.copy(region = p.region.copy(right = p.region.right + 1f))),
            a.copy(plan = p.copy(region = p.region.copy(bottom = p.region.bottom + 1f))),
            a.copy(plan = p.copy(scale = p.scale * 0.9f)),
            a.copy(plan = p.copy(width = p.width + 1)), a.copy(plan = p.copy(height = p.height + 1))
        )
        for (changed in changes) {
            val work = Work(); work.refine(a); work.refine(changed)
            assertEquals(2, work.renders); assertEquals(changed, work.published)
        }
        val work = Work(); work.refine(a); work.refine(a.copy(plan = p.copy(region = p.region.copy())))
        assertEquals(1, work.renders) // Structural equality, not object identity.
    }

    @Test fun returningToPublishedTileReplacesPendingWorkBehindAnotherRunningTile() {
        val a = key(viewport()); val b = a.copy(plan = a.plan.copy(scale = a.plan.scale * 0.9f))
        val c = a.copy(plan = a.plan.copy(scale = a.plan.scale * 0.8f))
        val work = Work(); work.refine(a)
        assertTrue(work.offer(b)); val running = work.take()
        assertFalse(work.offer(c))
        assertFalse(work.offer(a)) // Must replace C, NOT disappear just because A is displayed.
        assertTrue(work.complete(running))
        assertEquals(b, work.published)
        val next = work.take(); assertEquals(a, next)
        assertFalse(work.complete(next)); work.refine(a)
        assertEquals(3, work.renders); assertEquals(a, work.published)
    }

    @Test fun returningToPublishedTileAlsoReplacesNotYetStartedWork() {
        val a = key(viewport()); val b = a.copy(plan = a.plan.copy(scale = a.plan.scale * 0.9f))
        val work = Work(); work.refine(a)
        assertTrue(work.offer(b)) // Worker has been scheduled but has not taken B yet.
        assertFalse(work.offer(a))
        val next = work.take(); assertEquals(a, next)
        assertFalse(work.complete(next)); work.refine(a)
        assertEquals(2, work.renders); assertEquals(a, work.published)
    }

    @Test fun pendingNewGenerationSurvivesRejectedOldResultWithIdenticalGeometry() {
        val a = key(viewport()); val old = a.copy(plan = a.plan.copy(scale = a.plan.scale * 0.9f))
        val newer = old.copy(generation = old.generation + 1)
        val work = Work(); work.refine(a)
        assertTrue(work.offer(old)); val running = work.take()
        assertFalse(work.offer(newer))
        assertTrue(work.complete(running, publish = false)) // View's generation guard rejects it.
        val next = work.take(); assertEquals(newer, next)
        assertFalse(work.complete(next)); work.refine(newer)
        assertEquals(3, work.renders); assertEquals(newer, work.published)
    }
}
