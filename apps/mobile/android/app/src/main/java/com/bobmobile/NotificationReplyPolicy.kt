package com.bobmobile

import java.security.MessageDigest
import java.util.UUID

/** Pure policy: no OS state, text/credential logging, network or generated answers. */
internal object NotificationReplyPolicy {
    const val MAX_TEXT_UNITS = 200000 // Same UTF-16 limit as Message.parse.
    // Draft holds text twice (original input plus OutgoingMessage.message). Each
    // UTF-16 control unit may occupy six JSON bytes; leave room for item metadata.
    const val MAX_DRAFT_PLAINTEXT_BYTES = 4 * 1048576
    const val MAX_DRAFT_ENCODED_BYTES = 8 * 1048576
    const val MAX_ACTIONS = 32
    const val MAX_AGE_MS = 24 * 60 * 60 * 1000L
    const val ALLOW_GENERATED_REPLIES = false
    fun text(value: String): String = value.also {
        require(it.isNotBlank() && it.length <= MAX_TEXT_UNITS)
        // JSON/UTF-8 must round-trip the exact user input, not replace lone surrogates.
        var i = 0
        while (i < it.length) {
            val ch = it[i++]
            if (Character.isHighSurrogate(ch)) require(i < it.length && Character.isLowSurrogate(it[i++]))
            else require(!Character.isLowSurrogate(ch))
        }
    }
    fun fingerprint(identity: String, endpoint: String, token: String): String =
        MessageDigest.getInstance("SHA-256").digest("$identity\n$endpoint\n$token".toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it.toInt() and 255) }
    fun textFingerprint(value: String): String = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it.toInt() and 255) }
    fun completedInputNeedsFeedback(completedHash: String?, incoming: String?): Boolean =
        incoming != null && (completedHash.isNullOrEmpty() || completedHash != textFingerprint(incoming))
    // Direct input failures must remain visible; asynchronous status never revives
    // notifications for a viewed chat or a revoked/replaced pairing.
    fun publishStatus(viewed: Boolean, pairingCurrent: Boolean, inputFeedback: Boolean) = inputFeedback || (!viewed && pairingCurrent)
    fun statusTag(requestId: String, inputFeedback: Boolean) = if (inputFeedback) "reply-feedback:$requestId" else "reply-status:$requestId"
    fun isReplyStatusTag(tag: String?) = tag?.startsWith("reply-status:") == true || tag?.startsWith("reply-feedback:") == true
    fun requestId(existing: String?, completed: Boolean): String =
        if (existing != null && !completed) BobOutboxPolicy.identity(existing) else UUID.randomUUID().toString()
    fun current(expectedEpoch: String, epoch: String, expectedFingerprint: String, fingerprint: String,
                createdAt: Long, now: Long, retainedInput: Boolean = false): Boolean = expectedEpoch == epoch && expectedFingerprint == fingerprint &&
        (retainedInput || (now >= createdAt && now - createdAt <= MAX_AGE_MS))
    // First input wins. A duplicate broadcast can reconcile only that same request/text.
    fun accepts(savedText: String?, incomingText: String?): Boolean = savedText == null || incomingText == null || savedText == incomingText
    fun message(id: String, text: String): Map<String, Any> = linkedMapOf(
        "requestId" to BobOutboxPolicy.identity(id), "text" to text(text), "mode" to "steer", "allowSubagents" to true)
    fun item(identity: String, endpoint: String, name: String, chat: Long, id: String, text: String,
             createdAt: Long, localId: Long): Map<String, Any> {
        BobOutboxPolicy.identity(identity); BobOutboxPolicy.chat(chat.toDouble()); require(localId < 0)
        return linkedMapOf<String, Any>("id" to id, "scope" to "$identity:$chat",
            "backend" to linkedMapOf("backendId" to identity, "endpoint" to endpoint, "name" to name.take(100)),
            "chat" to chat, "createdAt" to createdAt, "localId" to localId,
            "files" to emptyList<Any>(), "message" to message(id, text), "notificationReply" to true)
    }
}
