package com.bobmobile

import org.junit.Assert.*
import org.junit.Test

/** Real ordering/replay coordinator with a fake durable store; no phone data or Android services. */
class PhoneToolsLedgerTest {
    private class Store : PhoneReceiptStore {
        val receipts = mutableMapOf<Pair<String, String>, Pair<String, String>>()
        val events = mutableListOf<String>()
        var failBegin = false; var failFinish = false
        override fun find(backend: String, id: String) = receipts[backend to id]
        override fun begin(backend: String, id: String, fingerprint: String, expires: Long, unknown: String) {
            events.add("begin")
            if (failBegin) throw IllegalStateException("disk full")
            check(!receipts.containsKey(backend to id)); receipts[backend to id] = fingerprint to unknown
        }
        override fun finish(backend: String, id: String, result: String) {
            events.add("finish")
            if (failFinish) throw IllegalStateException("disk full")
            receipts[backend to id] = receipts.getValue(backend to id).first to result
        }
    }
    private fun run(store: Store, backend: String = "backend", id: String = "id", fingerprint: String = "full-request-hash", expires: Long = 100, now: Long = 1, operation: () -> String): String =
        PhoneToolsLedger.run(store, backend, id, fingerprint, expires, now, "unknown", "mismatch", operation)

    @Test fun receiptIsCommittedBeforeEffectAndFinalBeforeReturn() {
        val store = Store()
        assertEquals("ok", run(store) {
            assertEquals("unknown", store.find("backend", "id")!!.second)
            store.events.add("effect"); "ok"
        })
        assertEquals(listOf("begin", "effect", "finish"), store.events)
        assertEquals("ok", store.find("backend", "id")!!.second)
    }
    @Test fun duplicateReturnsExactOriginalResultWithoutSecondEffect() {
        val store = Store(); var effects = 0
        val original = "{\"status\":\"launched\",\"data\":{\"token\":123}}"
        assertEquals(original, run(store) { effects++; original })
        repeat(3) { assertEquals(original, run(store) { effects++; "wrong" }) }
        assertEquals(1, effects)
    }
    @Test fun sameIdWithAnyChangedFingerprintCannotExecuteOrReplaceOriginal() {
        val store = Store(); run(store) { "ok" }
        assertEquals("mismatch", run(store, fingerprint = "different-expiry-or-parameter") { fail("Mismatch executed"); "bad" })
        assertEquals("ok", store.find("backend", "id")!!.second)
    }
    @Test fun identifiersAreBackendScoped() {
        val store = Store(); var effects = 0
        run(store, backend = "one") { effects++; "one" }; run(store, backend = "two") { effects++; "two" }
        assertEquals(2, effects)
        assertEquals("one", run(store, backend = "one") { "wrong" })
    }
    @Test fun crashAfterEffectLeavesUnknownReceiptAndNeverReexecutes() {
        val store = Store(); var effects = 0
        try { run(store) { effects++; throw AssertionError("simulated process death") }; fail("No crash") } catch (_: AssertionError) {}
        assertEquals("unknown", run(store) { effects++; "wrong" })
        assertEquals(1, effects)
        assertEquals(listOf("begin"), store.events)
    }
    @Test fun storageFailureBeforeReceiptPreventsEffect() {
        val store = Store().apply { failBegin = true }; var effects = 0
        try { run(store) { effects++; "ok" }; fail("No storage failure") } catch (_: IllegalStateException) {}
        assertEquals(0, effects); assertTrue(store.receipts.isEmpty())
    }
    @Test fun finalStorageFailureDoesNotReturnUnpersistedSuccessAndRetryStaysUnknown() {
        val store = Store().apply { failFinish = true }; var effects = 0
        try { run(store) { effects++; "ok" }; fail("Returned success without saving") } catch (_: IllegalStateException) {}
        assertEquals("unknown", run(store) { effects++; "wrong" }); assertEquals(1, effects)
    }
    @Test fun expiredRequestCannotReplayEvenIfItsReceiptWasPruned() {
        val store = Store(); var effects = 0
        run(store) { effects++; "ok" }; store.receipts.clear()
        for (now in listOf(100L, 101L)) {
            try { run(store, now = now) { effects++; "wrong" }; fail("Expired execution") } catch (_: IllegalArgumentException) {}
        }
        assertEquals(1, effects); assertEquals(listOf("begin", "finish"), store.events)
    }
    @Test fun readingReceiptNeverExecutesAndMissingReceiptStaysMissing() {
        val store = Store()
        assertNull(store.find("backend", "missing")); assertTrue(store.events.isEmpty())
        run(store) { "ok" }; val before = store.events.toList()
        assertEquals("ok", store.find("backend", "id")!!.second)
        assertEquals(before, store.events)
    }
}
