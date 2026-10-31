package com.bobmobile

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Only queue barrier metadata, no content or credentials. A complete foreground
 * snapshot is required before notification-origin workers may transport a send. */
internal object NotificationReplyBarriers {
    private fun prefs(context: Context) = context.getSharedPreferences("bob-notification-reply-barriers-v1", Context.MODE_PRIVATE)
    @Synchronized fun replace(context: Context, identity: String, chats: List<Long>) {
        BobOutboxPolicy.identity(identity)
        require(chats.size <= 10000)
        chats.forEach { BobOutboxPolicy.chat(it.toDouble()) }
        val value = JSONObject().put("version", 1).put("chats", JSONArray(chats.distinct()))
        check(prefs(context).edit().putString(identity, value.toString()).commit())
    }
    @Synchronized fun blocked(context: Context, identity: String, chat: Long): Boolean = try {
        BobOutboxPolicy.identity(identity); BobOutboxPolicy.chat(chat.toDouble())
        val value = JSONObject(requireNotNull(prefs(context).getString(identity, null)))
        require(value.getInt("version") == 1)
        val list = value.getJSONArray("chats"); require(list.length() <= 10000)
        val chats = (0 until list.length()).map { require(list.get(it) is Number); BobOutboxPolicy.chat(list.getDouble(it)) }
        BobOutboxPolicy.notificationBlocked(true, true, chat in chats)
    } catch (_: Exception) { BobOutboxPolicy.notificationBlocked(true, false, false) }
    @Synchronized fun invalidate(context: Context, identity: String) {
        check(prefs(context).edit().remove(identity).commit())
    }
}
