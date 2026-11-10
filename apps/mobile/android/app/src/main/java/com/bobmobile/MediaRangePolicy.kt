package com.bobmobile

import java.net.URI

/** Same paired transport as BobFiles, narrowed to one conversation artifact. No query authority. */
internal object MediaRangePolicy {
    const val CHUNK_BYTES = 256 * 1024
    // Header/index plus interleaved audio/video reads must coexist. Still at most 1 MiB,
    // with no read-ahead, whole-file request or persistent playback cache.
    const val CACHE_CHUNKS = 4
    fun url(endpoint: String, conversation: String, artifact: String, debug: Boolean): URI {
        val base = URI(endpoint)
        require(base.userInfo == null && base.fragment == null && base.rawQuery == null)
        require(base.rawPath == "" || base.rawPath == "/")
        require((base.scheme == "https" && base.host?.endsWith(".ts.net") == true) ||
            (debug && base.scheme == "http" && base.host == "127.0.0.1" && base.port in 1..65535)) { "Verified paired transport required" }
        require(Regex("^[1-9][0-9]{0,15}$").matches(conversation) && conversation.toLong() <= 9007199254740991L)
        require(Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$").matches(artifact))
        return URI("${endpoint.trimEnd('/')}/v1/chats/$conversation/artifacts/$artifact")
    }
    fun credentials(token: String, identity: String) {
        require(token.isNotBlank() && token.length <= 8192 && token.none { it.code <= 32 || it.code >= 127 })
        require(identity.isNotBlank() && identity.length <= 128 && identity.none { it.code <= 32 || it.code >= 127 })
    }
    fun size(size: Double): Long {
        require(size.isFinite() && size % 1.0 == 0.0 && size > 0 && size <= 1073741824)
        return size.toLong()
    }
    fun response(status: Int, contentRange: String?, length: Long, start: Long, end: Long, size: Long) {
        require(status == 206) { "Media range rejected" } // Includes redirects: credentials are never forwarded.
        require(contentRange == "bytes $start-$end/$size" && length == end - start + 1) { "Invalid media range response" }
    }
}
