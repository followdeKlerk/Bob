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
    data class Target(val source: String, val chat: Long)
    fun targets(value: String): List<Target>? {
        if (value.length !in 1..1024) return null
        val parts = value.split(',')
        if (parts.size !in 1..32 || parts.toSet().size != parts.size) return null
        return parts.map { part ->
            val pair = part.split(':')
            if (pair.size != 2 || pair[0] !in channels || !Regex("0|[1-9][0-9]{0,15}").matches(pair[1])) return null
            val chat = pair[1].toLongOrNull() ?: return null
            if (chat !in 0..9007199254740991L || pair[0] == "update" && chat != 0L) return null
            Target(pair[0], chat)
        }
    }
    fun accepts(data: Map<String, String>, sender: String?, expectedSender: String, hasNotification: Boolean, pairedBackends: Set<String>): Boolean {
        if (hasNotification || sender != expectedSender || data.keys !in listOf(setOf("type", "backendId", "sources"), setOf("type", "backendId", "sources", "context")) ||
            data["type"] != "bob_attention" || data["backendId"] !in pairedBackends) return false
        val sources = sources(data.getValue("sources")) ?: return false
        return data["context"]?.let { value -> targets(value)?.let { rows -> rows.map { it.source }.toSet() == sources } } ?: !data.containsKey("context")
    }
    fun label(value: String, limit: Int): String = value.replace(Regex("[\\p{Cc}\\p{Cf}]"), " ").replace(Regex("\\s+"), " ").trim().take(limit)
    fun tag(identity: String, chat: Long, updates: Boolean) = "$TAG:$identity:" + if (chat > 0) chat.toString() else if (updates) "updates" else "sessions"
    fun migrate(tag: String?, channel: String?, remoteInput: Boolean, inputHistory: Boolean): Boolean =
        tag != TAG && tag?.startsWith("$TAG:") != true && !NotificationReplyPolicy.isReplyStatusTag(tag) && !remoteInput && !inputHistory &&
            (tag?.startsWith("conversation:") == true || channel in setOf("bob-updates", "bob-schedules", CHANNEL, "bob-completions-quiet"))
}
