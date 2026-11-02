package com.bobmobile

import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.net.URI
import java.net.URLDecoder

/** Pure policy tests; native View/Intent behavior requires a Robolectric/device harness. */
class VisualActionsTest {
    private fun navigate() = mapOf<String, Any?>("id" to "go", "label" to "Navigate", "type" to "navigate",
        "latitude" to 51.5, "longitude" to -0.12, "destinationName" to "Museum")
    private fun website() = mapOf<String, Any?>("id" to "site", "label" to "Visit", "type" to "open_url", "url" to "https://example.org/path?q=a%20b#anchor")
    private fun reject(value: Any?) { assertThrows(IllegalArgumentException::class.java) { VisualActions.validate(value) } }
    private fun rejectAction(value: Map<String, Any?>) = reject(listOf(value))

    @Test fun navigationUsesOnlyLocallyConstructedHttpsCoordinatesAndDrivingDefault() {
        val action = VisualActions.validate(listOf(navigate())).single()
        val uri = URI(action.url)
        assertEquals("https", uri.scheme); assertEquals("www.google.com", uri.host); assertEquals("/maps/dir/", uri.path)
        val query = uri.rawQuery.split('&').associate { it.substringBefore('=') to URLDecoder.decode(it.substringAfter('='), "UTF-8") }
        assertEquals(mapOf("api" to "1", "destination" to "51.5,-0.12", "travelmode" to "driving", "dir_action" to "navigate"), query)
        assertTrue(uri.rawQuery.contains("51.5%2C-0.12")); assertNull(uri.userInfo)
        assertEquals("Museum\n51.5, -0.12", action.caption)
        assertFalse(action.url.contains("Museum"))
    }
    @Test fun explicitTravelModesAndCoordinateBoundsAreAccepted() {
        for (mode in listOf("walking", "bicycling", "driving")) {
            val action = VisualActions.validate(listOf(navigate() + mapOf("travelMode" to mode, "latitude" to -90, "longitude" to 180))).single()
            assertTrue(action.url.contains("travelmode=$mode")); assertTrue(action.caption.contains("-90.0, 180.0"))
        }
        val unnamed = VisualActions.validate(listOf(navigate() - "destinationName")).single()
        assertEquals("51.5, -0.12", unnamed.caption)
    }
    @Test fun httpsDestinationCaptionAlwaysShowsRealHostNotTheLabel() {
        val action = VisualActions.validate(listOf(website() + ("label" to "Trusted bank"))).single()
        assertEquals("example.org", action.caption)
        assertEquals("https://example.org/path?q=a%20b#anchor", action.url)
        assertEquals("xn--bcher-kva.example", VisualActions.validate(listOf(website() + ("url" to "https://xn--bcher-kva.example/"))).single().caption)
    }
    @Test fun backendNormalizedUrlCorpusIsAcceptedWithoutChangingTargets() {
        // Shared with the TypeScript validator test: exercise its normalized
        // output, not a separate set of raw inputs with different parser rules.
        val rows = File("../../../../test/fixtures/visual-action-urls.tsv").readLines(Charsets.UTF_8).filter { it.isNotBlank() }
        assertTrue(rows.isNotEmpty())
        for (row in rows) {
            val expected = row.split('\t')[1]
            val action = VisualActions.validate(listOf(website() + ("url" to expected))).single()
            assertEquals(expected, action.url)
            assertNotNull(URI(action.url).host)
        }
    }
    @Test fun malformedArraysUnknownTypesAndDuplicatesFailClosedAsAWhole() {
        for (invalid in listOf(null, "[]", mapOf<String, Any>(), listOf(null), listOf("bad"), listOf(website(), website()), listOf(website(), navigate(), navigate()))) reject(invalid)
        reject(listOf(website(), navigate() + ("type" to "run_intent")))
        rejectAction(website() + ("extra" to "ignored?")); rejectAction(website() - "type")
        rejectAction(website() + ("id" to "-bad")); rejectAction(website() + ("id" to "a".repeat(41)))
        assertEquals(2, VisualActions.validate(listOf(website(), navigate())).size)
        assertTrue(VisualActions.validate(emptyList<Any>()).isEmpty())
    }
    @Test fun labelsAndNamesRejectBlankOverlongControlsAndInvisibleBidiText() {
        for (label in listOf("", " \t", "a".repeat(41), "a\nB", "a\u0085B", "a\u200bB", "a\u202eB", "a\u2060B", "a\ufeffB", "a\u061cB")) rejectAction(website() + ("label" to label))
        for (name in listOf(null, "", " ", "a".repeat(101), "a\u2066B")) rejectAction(navigate() + ("destinationName" to name))
        rejectAction(website() + ("label" to 3))
        assertEquals(40, VisualActions.validate(listOf(website() + ("label" to "a".repeat(40)))).single().label.length)
    }
    @Test fun nonNumericNonFiniteOutOfBoundsCoordinatesAndUnknownModesFailClosed() {
        for (latitude in listOf(null, "51.5", true, Double.NaN, Double.POSITIVE_INFINITY, -90.01, 90.01)) rejectAction(navigate() + ("latitude" to latitude))
        for (longitude in listOf(null, Double.NEGATIVE_INFINITY, -180.01, 180.01)) rejectAction(navigate() + ("longitude" to longitude))
        for (mode in listOf(null, "transit", "DRIVING", "driving&destination=evil")) rejectAction(navigate() + ("travelMode" to mode))
    }
    @Test fun unsafeUrlsAreNeverMadeIntoDestinations() {
        for (url in listOf("http://example.org", "javascript:alert(1)", "intent://example.org", "file:///tmp/test", "//example.org/a", "/relative", "https:example.org", "https:///path",
            "https://user:secret@example.org/", "https://user@example.org/", "https://example.org\\@evil.org/", "https://example.org/\n", "https://example.org/ a", "https://example.org/\u200b", "https://example.org:99999/", "https://example.org/" + "a".repeat(2048))) rejectAction(website() + ("url" to url))
        rejectAction(website() + ("url" to null)); rejectAction(website() + ("url" to 42))
    }
    @Test fun acceptedDestinationsAreAnImmutableSnapshotNotALiveMapLookup() {
        val raw = navigate().toMutableMap()
        val actions = VisualActions.validate(listOf(raw))
        val original = actions.single()
        raw["latitude"] = 0; raw["longitude"] = 0; raw["label"] = "Changed"
        assertEquals(original, actions.single()); assertTrue(actions.single().url.contains("51.5%2C-0.12"))
        assertThrows(UnsupportedOperationException::class.java) { (actions as MutableList<VisualAction>).clear() }
    }
    @Test fun footerAloneMustLeaveRoomForAtLeastOneCssDpOfHtml() {
        // The measurement pass can make this decision before any HTML report.
        assertNull(VisualActions.inlineHeight(1, 16384, 2f)) // footer is exactly 8192 CSS dp
        assertNull(VisualActions.inlineHeight(1, 16386, 2f)) // footer exceeds the entire emergency budget
        assertNull(VisualActions.inlineHeight(1, 16383, 2f)) // round up, never clip
        assertEquals(8192, VisualActions.inlineHeight(1, 16382, 2f))
        assertEquals(1, VisualActions.inlineHeight(1, 0, 2f)) // no-actions compatibility
    }
    @Test fun naturalHtmlAndMeasuredFooterIncludingFontScaleGrowBeyondLoadingHeight() {
        assertEquals(770, VisualActions.inlineHeight(650, 240, 2f))
        assertEquals(1320, VisualActions.inlineHeight(1200, 240, 2f))
        assertEquals(1440, VisualActions.inlineHeight(1200, 480, 2f)) // larger font scale
        assertEquals(8192, VisualActions.inlineHeight(8072, 240, 2f))
        assertEquals(8192, VisualActions.inlineHeight(8072, 239, 2f)) // round up, never clip
        assertNull(VisualActions.inlineHeight(8073, 240, 2f))
        assertNull(VisualActions.inlineHeight(8072, 480, 2f))
        assertEquals(8192, VisualActions.inlineHeight(8192, 0, 3f)) // old visual, no footer
        assertEquals(420, VisualActions.inlineHeight(420, 0, 3f))
        assertEquals(1, VisualActions.inlineHeight(1, 0, 1f))
        assertNull(VisualActions.inlineHeight(8193, 0, 1f)); assertNull(VisualActions.inlineHeight(0, 0, 1f))
        assertNull(VisualActions.inlineHeight(10, -1, 1f)); assertNull(VisualActions.inlineHeight(10, 10, 0f))
        assertNull(VisualActions.inlineHeight(10, 10, Float.NaN)); assertNull(VisualActions.inlineHeight(10, 10, Float.POSITIVE_INFINITY))
        assertNull(VisualActions.inlineHeight(10, Int.MAX_VALUE, Float.MIN_VALUE)) // cannot wrap around the guard
    }
}
