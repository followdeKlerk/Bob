package com.bobmobile

import org.junit.Assert.*
import org.junit.Test

class InstalledAppVersionTest {
    @Test fun successfulInstalledMetadataIsCachedWithinOneProcess() {
        val cache = InstalledVersionCache()
        var queries = 0
        val installed = AppVersion("1.2.3", 123)
        assertEquals(installed, cache.get { queries++; installed })
        assertEquals(installed, cache.get { queries++; error("must not query again") })
        assertEquals(1, queries)
    }
    @Test fun failedLookupIsExplicitlyUnavailableAndDoesNotPoisonLaterReads() {
        val cache = InstalledVersionCache()
        assertEquals(AppVersion("unavailable", 0), cache.get { throw IllegalStateException("fixture") })
        assertEquals(AppVersion("2.0.0", 200), cache.get { AppVersion("2.0.0", 200) })
    }
    @Test fun crashSafePeekRecoversAfterAStartupFailureWithoutAnotherLookup() {
        val cache = InstalledVersionCache()
        var queries = 0
        assertEquals(AppVersion("unavailable", 0), cache.peek())
        cache.get { queries++; throw IllegalStateException("fixture") }
        assertEquals(0, cache.peek().code)
        val installed = cache.get { queries++; AppVersion("1.2.4", 124) }
        assertSame(installed, cache.peek())
        assertEquals(2, queries)
    }
    @Test fun invalidVersionIsNotCachedAsAnInstalledRelease() {
        val cache = InstalledVersionCache()
        for (code in listOf(0, -1)) assertEquals(AppVersion("unavailable", 0), cache.get { AppVersion("fixture", code) })
        assertEquals(AppVersion("fixture", 7), cache.get { AppVersion("fixture", 7) })
    }
    @Test fun newProcessReadsNewManifestInsteadOfRetainingPreviousInstalledVersion() {
        assertEquals(123, InstalledVersionCache().get { AppVersion("1.2.3", 123) }.code)
        assertEquals(124, InstalledVersionCache().get { AppVersion("1.2.4", 124) }.code)
    }
}
