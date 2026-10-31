package com.bobmobile

/** A completed polling pass is not pairing revocation and must not cancel its delivered notice. */
internal object NotificationCompletionPolicy {
    fun cleanup(retry: Boolean, updates: Boolean, replyActions: Boolean, removeWatch: () -> Unit) {
        if (!retry && !updates && !replyActions) {
            removeWatch()
        }
    }
}
