package com.bobmobile

internal enum class ConversationPostResult { POSTED, VIEWED, RETRY }

/** Context transitions and publication share this lock; a stale preflight visibility read is insufficient. */
internal object ConversationPublicationPolicy {
    inline fun run(lock: Any, current: () -> Boolean, viewed: () -> Boolean, post: () -> ConversationPostResult): ConversationPostResult =
        synchronized(lock) {
            when {
                !current() -> ConversationPostResult.RETRY
                viewed() -> ConversationPostResult.VIEWED
                else -> post()
            }
        }
}
