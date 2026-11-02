package com.bobmobile

/** Generic wake-up hints are never chat/delivery authority. */
internal object AttentionNotificationPolicy {
    const val TAG = "bob-attention"
    const val ID = 0
    const val CHANNEL = "bob-attention"
    const val BODY = "Bob needs your attention"
    private val channels = mapOf("reply" to "bob-completions-quiet", "question" to CHANNEL, "schedule" to "bob-schedules", "update" to "bob-updates")
    fun sources(value: String): Set<String>? {
        val parts = value.split(',')
        return parts.toSet().takeIf { parts.size in 1..channels.size && it.size == parts.size && it.all(channels::containsKey) }
    }
    fun anyEnabled(sources: Set<String>, replies: Boolean, channelEnabled: (String) -> Boolean): Boolean =
        sources.any { source -> channels[source]?.let { (source != "reply" || replies) && channelEnabled(it) } == true }
    fun accepts(data: Map<String, String>, sender: String?, expectedSender: String, hasNotification: Boolean, pairedBackends: Set<String>) =
        !hasNotification && sender == expectedSender && data.keys == setOf("type", "backendId", "sources") &&
            data["type"] == "bob_attention" && data["backendId"] in pairedBackends && sources(data.getValue("sources")) != null
    fun migrate(tag: String?, channel: String?, remoteInput: Boolean, inputHistory: Boolean): Boolean =
        tag != TAG && !NotificationReplyPolicy.isReplyStatusTag(tag) && !remoteInput && !inputHistory &&
            (tag?.startsWith("conversation:") == true || channel in setOf("bob-updates", "bob-schedules", CHANNEL, "bob-completions-quiet"))
}
