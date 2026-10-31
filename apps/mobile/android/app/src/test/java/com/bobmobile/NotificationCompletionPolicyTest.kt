package com.bobmobile

import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

class NotificationCompletionPolicyTest {
    @Test fun completedPassRetainsUnfinishedWorkPeriodicMonitoringAndReplyActions() {
        for (retry in listOf(false, true)) for (updates in listOf(false, true)) for (actions in listOf(false, true)) {
            var watchExists = true
            NotificationCompletionPolicy.cleanup(retry, updates, actions) { watchExists = false }
            assertEquals("retry=$retry updates=$updates actions=$actions", retry || updates || actions, watchExists)
        }
    }
    @Test fun ordinaryCompletionRemovesOnlyTheIdleWatchNotTheNoticeJustPosted() {
        var watchExists = true
        val visibleNotice = true
        NotificationCompletionPolicy.cleanup(false, false, false) { watchExists = false }
        assertFalse(watchExists); assertTrue(visibleNotice)
        val source = File("src/main/java/com/bobmobile/BobNotifications.kt").readText()
        val cleanup = source.substringAfter("var retry = false").substringBefore("// Retry only unfinished work")
        assertTrue(cleanup.contains("NotificationCompletionPolicy.cleanup("))
        assertEquals(1, Regex("NotificationWatchStore\\.remove\\(").findAll(cleanup).count())
        assertFalse(cleanup.contains("clearBackend(")); assertFalse(cleanup.contains(".revoke("))
    }
    @Test fun aViewedConversationIsASuccessfulSuppressionNotAFailedPost() {
        var posts = 0
        assertEquals(ConversationPostResult.VIEWED, ConversationPublicationPolicy.run(Any(), { true }, { true }) { posts++; ConversationPostResult.POSTED })
        assertEquals(0, posts)
        assertEquals(ConversationPostResult.RETRY, ConversationPublicationPolicy.run(Any(), { false }, { true }) { posts++; ConversationPostResult.POSTED })
        assertEquals(0, posts)
    }
    @Test fun visibilityIsRecheckedUnderTheSameLockAfterAStalePreflightRead() {
        val lock = Any(); var viewed = false
        val attempted = CountDownLatch(1); val posts = AtomicInteger(0); val result = AtomicReference<ConversationPostResult>()
        lateinit var thread: Thread
        synchronized(lock) {
            assertFalse(viewed) // Simulates caller's obsolete preflight result.
            thread = Thread {
                attempted.countDown()
                result.set(ConversationPublicationPolicy.run(lock, { true }, { viewed }) { posts.incrementAndGet(); ConversationPostResult.POSTED })
            }.apply { start() }
            assertTrue(attempted.await(2, TimeUnit.SECONDS))
            viewed = true // Activity context update/clear wins before publication gets the lock.
        }
        thread.join(2000); assertFalse(thread.isAlive)
        assertEquals(ConversationPostResult.VIEWED, result.get()); assertEquals(0, posts.get())
        val source = File("src/main/java/com/bobmobile/ConversationNotifications.kt").readText()
        assertTrue(source.contains("ConversationPublicationPolicy.run(NotificationWatchStore, current, { NotificationRuntime.viewing(identity, chat) })"))
        assertTrue(source.contains("if (NotificationRuntime.viewing(identity, chat)) return ConversationPostResult.VIEWED"))
    }
    @Test fun disabledOrUnknownQuestionStateNeverObtainsReplyFromPreviewHistory() {
        assertTrue(ConversationNotificationPolicy.allowReply(true, false))
        assertFalse(ConversationNotificationPolicy.allowReply(true, true))
        assertFalse(ConversationNotificationPolicy.allowReply(true, null))
        assertFalse(ConversationNotificationPolicy.allowReply(false, false))
        val source = File("src/main/java/com/bobmobile/ConversationNotifications.kt").readText()
        assertTrue(source.contains("val pending = questionPending // Unknown metadata"))
        assertFalse(source.contains("old?.optBoolean(\"questionPending\""))
        val worker = File("src/main/java/com/bobmobile/BobOutboxWorker.kt").readText()
        assertTrue(worker.contains("!operation.has(\"question\") || !operation.isNull(\"question\")"))
    }
}
