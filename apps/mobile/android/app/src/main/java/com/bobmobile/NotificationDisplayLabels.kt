package com.bobmobile

import android.content.Context
import org.json.JSONObject

/** Phone-local display hints only. No credentials, pairing or delivery authority. */
internal object NotificationDisplayLabels : EncryptedNotificationStore("notification-display-labels-v1") {
    fun workstation(context: Context, identity: String): String = try {
        read(context, identity)?.optString("label")?.takeIf { it.isNotBlank() } ?: "Workstation ${identity.take(4)}"
    } catch (_: Exception) { "Workstation ${identity.take(4)}" }
    fun session(context: Context, identity: String, chat: Long): String = try {
        read(context, identity)?.optJSONObject("sessions")?.optString(chat.toString())?.takeIf { it.isNotBlank() } ?: "Session #$chat"
    } catch (_: Exception) { "Session #$chat" }
    fun sessions(context: Context, identity: String, labels: List<Pair<Long, String>>) {
        update(context, identity) { value ->
            val prior = value.optJSONObject("sessions") ?: JSONObject()
            val merged = linkedMapOf<String, String>()
            prior.keys().forEach { key -> merged[key] = prior.optString(key) }
            labels.forEach { (id, title) ->
                if (title.isNotBlank()) { merged.remove(id.toString()); merged[id.toString()] = title }
            }
            value.put("sessions", JSONObject(merged.entries.toList().takeLast(128).associate { it.key to it.value }))
        }
    }
}
