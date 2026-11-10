package com.bobmobile

import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class SurfacePreparationTest {
    @Test fun concurrentFetchingAndPublishedHandlesShareEightSlots() {
        val registry = SurfacePreparation<String>(8)
        val pool = Executors.newFixedThreadPool(24)
        val ready = CountDownLatch(24)
        val start = CountDownLatch(1)
        val admitted = AtomicInteger()
        val attempted = CountDownLatch(24)
        val finishFetch = CountDownLatch(1)
        try {
            val tasks = (0 until 24).map { n -> pool.submit {
                ready.countDown(); check(start.await(5, TimeUnit.SECONDS))
                val slot = registry.reserve()
                if (slot != null) admitted.incrementAndGet()
                attempted.countDown()
                if (slot != null) {
                    check(finishFetch.await(5, TimeUnit.SECONDS))
                    slot.publish("handle-$n", "capability-$n")
                }
            } }
            assertTrue(ready.await(5, TimeUnit.SECONDS)); start.countDown()
            assertTrue(attempted.await(5, TimeUnit.SECONDS))
            assertEquals(8, admitted.get()) // Rejected calls never enter synthetic fetch work.
            assertNull(registry.reserve())
            finishFetch.countDown(); tasks.forEach { it.get(5, TimeUnit.SECONDS) }
            assertNull(registry.reserve()) // Publishing does not relinquish the budget.
            assertEquals(8, (0 until 24).count { registry.take("handle-$it") != null })
            repeat(8) { assertNotNull(registry.reserve()) }
            assertNull(registry.reserve())
        } finally { finishFetch.countDown(); start.countDown(); pool.shutdownNow() }
    }

    @Test fun fetchFailureReleaseConsumeAndStartupFailureRecoverExactlyOnce() {
        val registry = SurfacePreparation<String>(1)
        val failedFetch = registry.reserve()!!
        try { throw IllegalStateException("fetch failed") } catch (_: IllegalStateException) { assertNull(failedFetch.cancel()) }
        assertNull(failedFetch.cancel())
        val released = registry.reserve()!!
        released.publish("release", "first")
        assertEquals("first", registry.take("release"))
        assertNull(registry.take("release")); assertNull(released.cancel())
        val consumed = registry.reserve()!!
        consumed.publish("consume", "second")
        assertEquals("second", registry.take("consume"))
        // A launch failure racing consumption cannot revoke/close the new owner's session.
        assertNull(consumed.cancel())
        val failedStartup = registry.reserve()!!
        failedStartup.publish("startup", "third")
        assertEquals("third", failedStartup.cancel())
        assertNull(registry.take("startup")); assertNull(failedStartup.cancel())
        assertNotNull(registry.reserve()); assertNull(registry.reserve())
    }

    @Test fun racingCleanupAndConsumptionHaveExactlyOneCapabilityOwner() {
        val registry = SurfacePreparation<String>(1)
        val pool = Executors.newFixedThreadPool(2)
        try {
            repeat(100) {
                val slot = registry.reserve()!!
                slot.publish("same", "capability")
                val go = CountDownLatch(1)
                val consume = pool.submit<String?> { go.await(); registry.take("same") }
                val cleanup = pool.submit<String?> { go.await(); slot.cancel() }
                go.countDown()
                assertEquals(1, listOf(consume.get(5, TimeUnit.SECONDS), cleanup.get(5, TimeUnit.SECONDS)).count { it != null })
                assertNull(slot.cancel())
            }
            val last = registry.reserve()!!
            assertNull(registry.reserve()); last.cancel()
        } finally { pool.shutdownNow() }
    }

    @Test fun successfulFontsAreBuiltOnceEvenForConcurrentMounts() {
        val cache = SurfaceFontCssCache()
        val reads = AtomicInteger()
        val pool = Executors.newFixedThreadPool(12)
        try {
            val results = (0 until 24).map { pool.submit<String> {
                cache.get { reads.addAndGet(12); SurfaceFontCssCache.Loaded("all twelve faces", true) }
            } }
            results.forEach { assertEquals("all twelve faces", it.get(5, TimeUnit.SECONDS)) }
            assertEquals(12, reads.get())
            assertEquals("all twelve faces", cache.get { error("must not rebuild") })
        } finally { pool.shutdownNow() }
    }

    @Test fun partialAndThrownFontFailuresNeverPoisonTheProcessCache() {
        val cache = SurfaceFontCssCache()
        assertEquals("eleven faces", cache.get { SurfaceFontCssCache.Loaded("eleven faces", false) })
        assertEquals("", cache.get { SurfaceFontCssCache.Loaded("", false) })
        assertThrows(IllegalStateException::class.java) { cache.get { error("loader failure") } }
        assertEquals("complete", cache.get { SurfaceFontCssCache.Loaded("complete", true) })
        assertEquals("complete", cache.get { error("must reuse success") })
    }

    /** Source contracts complement real JVM primitive tests, not Activity/WebView runtime tests. */
    @Test fun nativeEntryPointsAndAllConsumersUseTheTestedRegistry() {
        val source = File("src/main/java/com/bobmobile/BobInteractive.kt").readText()
        assertTrue(source.contains("private val surfaceSessions = SurfacePreparation<SurfaceSession>(8)"))
        assertTrue(source.contains("prepareSession(endpoint, identity, token, chat, id, promise, false)"))
        assertTrue(source.contains("prepareSession(endpoint, identity, token, chat, id, promise, true)"))
        val launch = source.substringAfter("private fun prepareSession(").substringBefore("internal class BobSurfacePanel")
        assertTrue(launch.indexOf("surfaceSessions.reserve()") < launch.indexOf("Thread {"))
        assertTrue(launch.indexOf("surfaceSessions.reserve()") < launch.indexOf("surfaceRequest("))
        assertTrue(launch.indexOf("selected = SurfaceSession(") < launch.indexOf("VisualActions.fromResource(resource)"))
        assertTrue(launch.contains("if (published) reservation.cancel() else { reservation.cancel(); selected }"))
        assertTrue(launch.contains("finally { if (!started) reservation.cancel() }"))
        assertEquals(3, Regex("surfaceSessions\\.take\\(").findAll(source).count())
        assertFalse(source.contains("pending.remove")); assertFalse(source.contains("pending.size"))
        assertTrue(source.contains("if (!handedOff) closeSurfaceSessionAsync(selected)"))
        val show = source.substringAfter("fun show(selected:")
        assertTrue(show.indexOf("session = selected") < show.indexOf("BobAppearance.addListener(this)"))
        assertTrue(show.contains("catch (_: Exception) { dispose(); onClose() }"))
    }

    @Test fun mountUsesSuccessfulOnlyProcessCacheAndPreservesFontAndIsolationContracts() {
        val source = File("src/main/java/com/bobmobile/BobInteractive.kt").readText()
        assertTrue(source.contains("private val surfaceFontCssCache = SurfaceFontCssCache()"))
        val fonts = source.substringAfter("private fun surfaceFontFaces").substringBefore("internal data class SurfaceSession")
        assertTrue(fonts.contains("surfaceFontCssCache.get {"))
        assertTrue(fonts.contains("SurfaceFontCssCache.Loaded(ui + mono, complete)"))
        assertEquals(2, Regex("catch \\(_: Exception\\) \\{ complete = false; \"\" }").findAll(fonts).count())
        assertEquals(8, Regex("Triple\\(R\\.font\\.nunito_").findAll(fonts).count())
        for (face in listOf("Regular", "Bold", "Italic", "BoldItalic")) assertTrue(fonts.contains("Triple(\"$face\""))
        assertTrue(fonts.contains("\"700 1000\"")); assertTrue(fonts.contains("\"500 900\""))
        assertTrue(source.contains("val fontFaceCss = surfaceFontFaces(context)"))
        assertTrue(source.contains("font-src data:; connect-src 'none'"))
        assertTrue(source.contains("document.getElementById('bob-font-faces').textContent"))
    }
}
