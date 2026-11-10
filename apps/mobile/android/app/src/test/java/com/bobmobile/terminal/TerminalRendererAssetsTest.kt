package com.bobmobile

import org.junit.Assert.*
import org.junit.Test

class TerminalRendererAssetsTest {
    private fun path(path: String, method: String = "GET", scheme: String = "https", host: String = "terminal.bob.invalid", port: Int = -1,
        query: String? = null, fragment: String? = null, userInfo: String? = null) =
        TerminalRendererAssets.path(method, scheme, host, port, path, query, fragment, userInfo)
    @Test fun onlyExactRendererAndBundledNordwandFacesAreAllowed() {
        assertEquals("terminal/index.html", path("/index.html"))
        assertEquals("terminal/vendor/xterm.js", path("/vendor/xterm.js"))
        for (face in listOf("Regular", "Bold", "Italic", "BoldItalic")) {
            assertEquals("fonts/NordwandMono-$face.woff2", path("/fonts/NordwandMono-$face.woff2"))
        }
        for (resource in listOf("/fonts/other.woff2", "/fonts/../index.html", "/%69ndex.html", "/vendor/XTERM-LICENSE", "/legal/mosh-corresponding-source.tar", "//index.html")) {
            assertNull(path(resource))
        }
    }
    @Test fun deniesNetworkAlternateOriginsParamsAndNonGetMethods() {
        assertNull(path("/index.html", method = "POST"))
        assertNull(path("/index.html", scheme = "file"))
        assertNull(path("/index.html", host = "example.com"))
        assertNull(path("/index.html", host = "terminal.bob.invalid.example.com"))
        assertNull(path("/index.html", port = 443))
        assertNull(path("/index.html", query = ""))
        assertNull(path("/index.html", fragment = "test"))
        assertNull(path("/index.html", userInfo = "owner"))
    }
}
