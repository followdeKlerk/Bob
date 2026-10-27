package com.bobmobile

import java.io.File

/** Keep the transport allowlist narrow while allowing idempotent upload receipts. */
internal object AttachmentTransportPolicy {
    private val uuid = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
    fun acceptsQuery(path: String, query: String?): Boolean = query == null ||
        (Regex("^/v1/chats/[1-9][0-9]*/artifacts$").matches(path) && Regex("^uploadId=$uuid$").matches(query))

    fun draftCandidates(filesDir: File, cacheDir: File, id: String): List<File> {
        require(Regex("^$uuid$").matches(id)) { "Invalid attachment identity" }
        // New attachments are durable app files, not OS-evictable cache. Keep
        // accepting exact old cache URIs so an upgrade does not break the queue.
        return listOf(filesDir, cacheDir).map { base ->
            val directory = File(base, "bob-drafts").canonicalFile
            File(directory, id).canonicalFile.also { require(it.parentFile == directory) }
        }
    }
}
