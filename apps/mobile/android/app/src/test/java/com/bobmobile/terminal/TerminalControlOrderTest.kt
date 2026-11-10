package com.bobmobile

import org.junit.Assert.*
import org.junit.Test
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class TerminalControlOrderTest {
    @Test fun delayedCopyCompletesClipboardUpdateBeforeFollowingPasteCanReadIt() {
        val order = TerminalControlOrder()
        var clipboard = "old clipboard"
        val copy = order.admit(1.0, "copy")!!
        val delayedCopy = {
            if (order.isPending(copy)) {
                clipboard = "new selection"
                assertTrue(order.complete(copy))
            }
        }
        assertEquals(1.0, order.commandSequence, 0.0)
        assertEquals(-1.0, order.completedSequence, 0.0)
        assertNull(order.admit(2.0, "paste"))
        val unrelatedCtrlEvent = TerminalStateSnapshot("session", "running", null, false, order.completedSequence)
        assertNull(unrelatedCtrlEvent.acknowledged)
        assertEquals("old clipboard", clipboard)
        delayedCopy()
        assertEquals(1.0, order.completedSequence, 0.0)
        val paste = order.admit(2.0, "paste")!!
        assertEquals("new selection", clipboard)
        assertTrue(order.complete(paste))
        assertEquals(2.0, order.completedSequence, 0.0)
        assertNull(unrelatedCtrlEvent.acknowledged)
    }

    @Test fun delayedPasteBytesEnterOrderedWriterBeforeTabIsAdmitted() {
        val order = TerminalControlOrder()
        val written = Collections.synchronizedList(mutableListOf<String>())
        val done = CountDownLatch(2)
        val writer = TerminalInputQueue({ written.add(String(it, Charsets.UTF_8)); done.countDown() }, { fail("Unexpected writer failure") })
        try {
            val paste = order.admit(1.0, "paste")!!
            val delayedPasteInput = {
                if (order.isPending(paste)) {
                    assertTrue(writer.offer("\u001b[200~paste\u001b[201~".toByteArray()))
                    assertTrue(order.complete(paste))
                }
            }
            assertNull(order.admit(2.0, "input"))
            assertEquals(-1.0, order.completedSequence, 0.0)
            delayedPasteInput()
            val tab = order.admit(2.0, "input")!!
            assertTrue(writer.offer("\t".toByteArray()))
            assertTrue(order.complete(tab))
            assertTrue(done.await(2, TimeUnit.SECONDS))
            assertEquals(listOf("\u001b[200~paste\u001b[201~", "\t"), written.toList())
        } finally { writer.close() }
    }

    @Test fun delayedPasteCannotBeMutatedByFollowingCtrlOrAckedByUnrelatedState() {
        val order = TerminalControlOrder()
        val first = order.admit(1.0, "input")!!
        order.complete(first)
        val paste = order.admit(2.0, "paste")!!
        var ctrl = false
        var pasted = ""
        val delayedPasteInput = {
            if (order.isPending(paste)) {
                pasted = if (ctrl) "\u0001" else "a"
                assertTrue(order.complete(paste))
            }
        }
        // Native rejects an early later command, rather than mutating state while paste is pending.
        order.admit(3.0, "ctrl")?.let { ctrl = true; order.complete(it) }
        assertFalse(ctrl)
        val state = TerminalStateSnapshot("session", "running", null, ctrl, order.completedSequence)
        assertEquals(1.0, state.acknowledged!!, 0.0)
        delayedPasteInput()
        val control = order.admit(3.0, "ctrl")!!
        ctrl = true
        order.complete(control)
        assertTrue(ctrl)
        assertEquals("a", pasted)
        assertEquals(3.0, order.completedSequence, 0.0)
        assertEquals(1.0, state.acknowledged!!, 0.0)
    }

    @Test fun lateCopyPasteAndKeyboardCallbacksCannotCompleteAfterCloseOrNewAdmission() {
        for (action in listOf("copy", "paste", "keyboard")) {
            val order = TerminalControlOrder()
            val old = order.admit(1.0, action)!!
            order.revoke()
            assertFalse(order.isPending(old))
            assertFalse(order.complete(old))
            order.reset()
            val fresh = order.admit(1.0, action)!! // Same sequence, different native ticket/admission.
            assertFalse(order.complete(old))
            assertEquals(-1.0, order.completedSequence, 0.0)
            assertTrue(order.complete(fresh))
            assertFalse(order.complete(fresh))
        }
    }

    @Test fun invalidDuplicateAndPendingSequencesNeverAdvanceCompletionOrAdmission() {
        val order = TerminalControlOrder()
        for (number in listOf(-1.0, Double.NaN, Double.POSITIVE_INFINITY, 1.5, 9007199254740992.0))
            assertNull(order.admit(number, "input"))
        val zero = order.admit(0.0, "copy")!!
        assertNull(order.admit(1.0, "input"))
        assertEquals(0.0, order.commandSequence, 0.0)
        assertEquals(-1.0, order.completedSequence, 0.0)
        assertTrue(order.complete(zero))
        assertNull(order.admit(0.0, "copy"))
        assertEquals(0.0, order.completedSequence, 0.0)
    }

    @Test fun failedWriterAdmissionDoesNotCompletePaste() {
        val order = TerminalControlOrder()
        val paste = order.admit(1.0, "paste")!!
        val writer = TerminalInputQueue({}, {}, maxBytes = 1)
        try {
            if (writer.offer(byteArrayOf(1, 2))) order.complete(paste)
            assertEquals(-1.0, order.completedSequence, 0.0)
            order.revoke()
            assertFalse(order.complete(paste))
        } finally { writer.close() }
    }
}
