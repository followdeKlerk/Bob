package com.bobmobile

/** Notification presentation cache only; never transcript/read/delivery authority. */
internal data class ConversationNotice(val id: String, val text: String, val at: Long)
internal object ConversationNotificationPolicy {
    const val MAX_CONVERSATIONS = 8
    const val MAX_MESSAGES = 5
    const val MAX_TEXT = 1000
    fun tag(identity: String, chat: Long) = "conversation:$identity:$chat"
    fun title(value: String, chat: Long) = value.replace(Regex("[\\p{Cc}\\p{Cf}]"), " ").replace(Regex("\\s+"), " ").trim().take(160).ifBlank { "Conversation $chat" }
    fun append(previous: List<ConversationNotice>, event: ConversationNotice): List<ConversationNotice> =
        (previous.filter { it.id != event.id } + event.copy(id = event.id.take(256), text = event.text.take(MAX_TEXT), at = event.at.coerceAtLeast(0)))
            .takeLast(MAX_MESSAGES)
    fun allowReply(requested: Boolean, questionPending: Boolean?) = requested && questionPending == false
    fun changedPairing(oldEndpoint: String, oldToken: String, endpoint: String, token: String) =
        oldEndpoint.isNotBlank() && (oldEndpoint != endpoint || oldToken != token)
}
