package com.bobmobile

/** Pure policy kept separate so retries and admission gates can be checked on the JVM. */
internal object BobOutboxPolicy {
    const val MAX_ATTEMPTS = 12
    const val MAX_AGE_MS = 24 * 60 * 60 * 1000L
    const val MAX_RECORDS = 128
    // Message accepts 200,000 UTF-16 units; escaped control characters can use
    // six JSON bytes each. Do not reject valid Unicode/escaped messages.
    const val MAX_MESSAGE_BYTES = 2 * 1048576
    const val MAX_ITEM_BYTES = 3 * 1048576
    private val uuid = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
    fun identity(value: String): String = value.also { require(uuid.matches(it)) }
    fun chat(value: Double): Long = value.also { require(it.isFinite() && it > 0 && it % 1.0 == 0.0 && it <= 9007199254740991.0) }.toLong()
    fun notificationBlocked(isNotificationReply: Boolean, snapshotValid: Boolean, chatBlocked: Boolean) =
        isNotificationReply && (!snapshotValid || chatBlocked)
    fun retryable(status: Int) = status == 408 || status == 425 || status == 429 || status in 500..599
    fun exhausted(attempts: Int, startedAt: Long, now: Long) = attempts >= MAX_ATTEMPTS || now - startedAt >= MAX_AGE_MS
    fun mayPost(hasAdmission: Boolean, responseHasAdmission: Boolean, responseAdmissionIsNull: Boolean) =
        !hasAdmission && responseHasAdmission && responseAdmissionIsNull
    fun blocks(earlierState: String, earlierOrder: Long, order: Long) = earlierState == "pending" && earlierOrder < order
}
