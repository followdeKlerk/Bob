package com.bobmobile

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.net.URLEncoder
import java.util.Collections
import kotlin.math.ceil

/** Native-only snapshot of a saved visual's destinations. Never passed to the WebView. */
internal data class VisualAction(val id: String, val label: String, val url: String, val caption: String)

internal object VisualActions {
    // CSS dp, including the measured native footer. Keep JS policy in sync.
    const val MAX_INLINE_HEIGHT = 8192
    private val idPattern = Regex("[A-Za-z0-9][A-Za-z0-9_-]{0,39}")
    private val commonKeys = setOf("id", "label", "type")
    private fun forbiddenTextChar(c: Char) = Character.isISOControl(c) ||
        c == '\u061c' || c in '\u200b'..'\u200f' || c in '\u202a'..'\u202e' || c in '\u2060'..'\u206f' || c == '\ufeff'
    private fun text(value: Any?, max: Int): String {
        require(value is String && value.isNotBlank() && value.length <= max && value.none(::forbiddenTextChar)) { "Invalid visual action text" }
        return value
    }
    private fun coordinate(value: Any?, bound: Double): Double {
        require(value is Number) { "Invalid visual action coordinate" }
        return value.toDouble().also { require(it.isFinite() && it in -bound..bound) { "Invalid visual action coordinate" } }
    }

    /** Absence is compatible with old visuals. Present null/non-arrays and MCP actions fail closed. */
    fun fromResource(resource: JSONObject): List<VisualAction> {
        if (!resource.has("actions")) return emptyList()
        require(resource.optString("kind") == "visual") { "Only visuals support native actions" }
        val array = resource.opt("actions")
        require(array is JSONArray && array.length() <= 2) { "Invalid visual actions" }
        val values = (0 until array.length()).map { index ->
            val item = array.opt(index)
            require(item is JSONObject) { "Invalid visual action" }
            item.keys().asSequence().associateWith { item.opt(it) }
        }
        return validate(values)
    }

    /** Pure validation also permits JVM policy coverage without an Android JSON runtime. */
    internal fun validate(value: Any?): List<VisualAction> {
        require(value is List<*> && value.size <= 2) { "Invalid visual actions" }
        val ids = mutableSetOf<String>()
        val actions = value.map { raw ->
            require(raw is Map<*, *>) { "Invalid visual action" }
            val id = raw["id"]
            require(id is String && idPattern.matches(id) && ids.add(id)) { "Invalid or duplicate visual action ID" }
            val label = text(raw["label"], 40)
            when (raw["type"]) {
                "navigate" -> {
                    require(raw.keys.all { it in commonKeys + setOf("latitude", "longitude", "destinationName", "travelMode") })
                    val latitude = coordinate(raw["latitude"], 90.0)
                    val longitude = coordinate(raw["longitude"], 180.0)
                    val name = if (raw.containsKey("destinationName")) text(raw["destinationName"], 100) else null
                    val mode = if (raw.containsKey("travelMode")) raw["travelMode"] else "driving"
                    require(mode in listOf("driving", "walking", "bicycling")) { "Invalid visual travel mode" }
                    val destination = "$latitude,$longitude"
                    val url = "https://www.google.com/maps/dir/?api=1&destination=" +
                        URLEncoder.encode(destination, "UTF-8") + "&travelmode=$mode&dir_action=navigate"
                    VisualAction(id, label, url, listOfNotNull(name, "$latitude, $longitude").joinToString("\n"))
                }
                "open_url" -> {
                    require(raw.keys.all { it in commonKeys + "url" })
                    val url = raw["url"]
                    require(url is String && url.length <= 2048 && url.none { forbiddenTextChar(it) || it.isWhitespace() || it == '\\' }) { "Invalid visual URL" }
                    val uri = try { URI(url) } catch (_: Exception) { throw IllegalArgumentException("Invalid visual URL") }
                    require(uri.isAbsolute && uri.scheme.equals("https", ignoreCase = true) && !uri.host.isNullOrEmpty() &&
                        uri.rawUserInfo == null && uri.port in -1..65535) { "Only credential-free HTTPS destinations are allowed" }
                    VisualAction(id, label, uri.toASCIIString(), uri.host)
                }
                else -> throw IllegalArgumentException("Unknown visual action type")
            }
        }
        return Collections.unmodifiableList(actions)
    }

    /** HTML reports CSS dp; native footer is measured in physical pixels, including font scale. */
    internal fun inlineHeight(htmlHeight: Int, footerPixels: Int, density: Float): Int? {
        if (htmlHeight !in 1..MAX_INLINE_HEIGHT || footerPixels < 0 || !density.isFinite() || density <= 0) return null
        val total = htmlHeight + ceil(footerPixels / density.toDouble())
        return total.takeIf { it.isFinite() && it in 1.0..MAX_INLINE_HEIGHT.toDouble() }?.toInt()
    }
}
