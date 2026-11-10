package com.bobmobile

import org.junit.Assert.*
import org.junit.Test
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class TerminalInputQueueTest {
    @Test fun inputOrderAndClose() {
        val values = Collections.synchronizedList(mutableListOf<Int>())
        val done = CountDownLatch(3)
        val queue = TerminalInputQueue({ values.add(it[0].toInt()); done.countDown() }, { fail("Writer failed") })
        try {
            assertTrue(queue.offer(byteArrayOf(1)))
            assertTrue(queue.offer(byteArrayOf(2)))
            assertTrue(queue.offer(byteArrayOf(3)))
            assertTrue(done.await(2, TimeUnit.SECONDS))
            assertEquals(listOf(1, 2, 3), values.toList())
        } finally { queue.close() }
        assertFalse(queue.offer(byteArrayOf(4)))
    }
    @Test fun byteBoundIncludesBlockedWriteAndRejectsWithoutThreadsOrRetry() {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val queue = TerminalInputQueue({ entered.countDown(); release.await() }, {}, maxBytes = 4, maxItems = 2)
        try {
            assertTrue(queue.offer(byteArrayOf(1, 2, 3)))
            assertTrue(entered.await(2, TimeUnit.SECONDS))
            assertFalse(queue.offer(byteArrayOf(4, 5)))
            assertTrue(queue.offer(byteArrayOf(4)))
            assertFalse(queue.offer(byteArrayOf(5)))
        } finally { queue.close(); release.countDown() }
    }
    @Test fun failedSinkClosesTheWriter() {
        val failed = CountDownLatch(1)
        val queue = TerminalInputQueue({ throw IllegalStateException("test") }, { failed.countDown() })
        assertTrue(queue.offer(byteArrayOf(1)))
        assertTrue(failed.await(2, TimeUnit.SECONDS))
        assertFalse(queue.offer(byteArrayOf(2)))
        queue.close()
    }
}
