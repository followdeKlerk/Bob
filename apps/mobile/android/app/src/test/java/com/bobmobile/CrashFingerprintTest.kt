package com.bobmobile

import org.junit.Assert.*
import org.junit.Test

class CrashFingerprintTest {
    private fun code() = StackTraceElement("com.facebook.react.SomeModule", "handleException", "/private/secrets/message.txt", 42)
    private fun sample(time: Long = 1000) = CrashFingerprint(time, 63, true, listOf(CrashCause("java.lang.IllegalStateException", listOf(CrashCodeFrame("com.bobmobile.MainActivity", "onResume", 14)))))

    @Test fun capturesCodeButNeverMessagesPathsUrlsThreadNamesOrSuppressedExceptions() {
        val inner = IllegalStateException("Bearer PRIVATE_TOKEN https://private.example/chat")
        inner.stackTrace = arrayOf(code())
        val outer = RuntimeException("PRIVATE_CHAT_TEXT", inner)
        outer.stackTrace = arrayOf(
            StackTraceElement("com.bobmobile.MainActivity", "onResume", "SECRET_FILE.txt", 14),
            StackTraceElement("com.bobmobile.MainActivity", "https://private.example/token", "PRIVATE_FILE", 15),
            StackTraceElement("private.chat.Message", "PRIVATE_CONTENT", "PRIVATE_FILE", 16)
        )
        outer.addSuppressed(IllegalArgumentException("SUPPRESSED_SECRET"))
        val captured = CrashFingerprints.capture(outer, 1000, 63, false)
        val serialized = CrashFingerprints.encode(listOf(captured))
        assertEquals(2, captured.causes.size)
        assertEquals("java.lang.RuntimeException", captured.causes[0].type)
        assertEquals(1, captured.causes[0].frames.size)
        assertTrue(serialized.contains("com.facebook.react.SomeModule\thandleException\t42"))
        for (privateValue in listOf("PRIVATE", "SECRET", "SUPPRESSED", "Bearer", "https://", "message.txt", "/private")) assertFalse(serialized.contains(privateValue))
        assertFalse(captured.mainThread)
    }
    @Test fun exceptionMessageAndToStringAreNeverInvoked() {
        val poison = object : RuntimeException() {
            override val message: String? get() = throw AssertionError("message must not be inspected")
            override fun toString(): String = throw AssertionError("toString must not be inspected")
        }
        poison.stackTrace = arrayOf(code())
        val captured = CrashFingerprints.capture(poison, 1000, 63, true)
        assertEquals(1, captured.causes.size)
        assertEquals(1, captured.causes[0].frames.size)
        assertTrue(CrashFingerprints.encode(listOf(captured)).isNotEmpty())
    }
    @Test fun causeCyclesAndLargeTracesAreBounded() {
        val cyclic = object : RuntimeException() { override val cause: Throwable get() = this }
        cyclic.stackTrace = Array(1000) { code() }
        val captured = CrashFingerprints.capture(cyclic, 1000, 63, true)
        assertEquals(1, captured.causes.size); assertEquals(24, captured.causes[0].frames.size)
        var chain: Throwable = IllegalStateException()
        repeat(20) { chain = RuntimeException("not retained", chain).apply { stackTrace = Array(1000) { code() } } }
        val bounded = CrashFingerprints.capture(chain, 1000, 63, true)
        assertEquals(4, bounded.causes.size); assertEquals(24, bounded.causes.sumOf { it.frames.size })
    }
    @Test fun previousCrashHandlerAlwaysReceivesTheIdenticalExceptionEvenIfStorageFails() {
        val fatal = IllegalStateException("PRIVATE" + "_TOKEN")
        val thread = Thread.currentThread(); var captures = 0; var delegated = 0
        val previous = Thread.UncaughtExceptionHandler { actualThread, actualError ->
            assertSame(thread, actualThread); assertSame(fatal, actualError); delegated++
        }
        val wrapper = CrashFingerprints.handler(previous) { _, _ -> captures++; throw OutOfMemoryError("diagnostic failure") }
        wrapper.uncaughtException(thread, fatal)
        wrapper.uncaughtException(thread, fatal)
        assertEquals(1, captures); assertEquals(2, delegated)
    }
    @Test fun diagnosticsDoNotSwallowTheOriginalHandlersTerminationOrFailure() {
        val original = IllegalStateException("ORIGINAL")
        val terminating = AssertionError("previous handler terminates")
        val wrapper = CrashFingerprints.handler(Thread.UncaughtExceptionHandler { _, error -> assertSame(original, error); throw terminating }) { _, _ -> }
        try { wrapper.uncaughtException(Thread.currentThread(), original); fail("must delegate") }
        catch (failure: AssertionError) { assertSame(terminating, failure) }
    }
    @Test fun strictCodecRoundTripsAndOnlyRetainsTheLastThreeCrashes() {
        val records = (1L..10L).map { sample(it) }
        val encoded = CrashFingerprints.encode(records)
        assertEquals(records.takeLast(3), CrashFingerprints.decode(encoded))
        assertTrue(encoded.length < CrashFingerprints.MAX_CHARS)
        assertEquals(emptyList<CrashFingerprint>(), CrashFingerprints.decode("x".repeat(CrashFingerprints.MAX_CHARS + 1)))
        assertEquals(emptyList<CrashFingerprint>(), CrashFingerprints.decode("PRIVATE_CONTENT"))
    }
    @Test fun malformedStoredFieldsCannotEscapeTheCodeOnlySchema() {
        val raw = "C\t1000\t63\t1\nE\tjava.lang.RuntimeException\nF\tcom.bobmobile.MainActivity\tonResume\t14\n" +
            "F\tprivate.user.Message\tPRIVATE_CHAT\t1\nF\tcom.bobmobile.MainActivity\thttps://private/token\t1\n" +
            "MESSAGE\tPRIVATE_TEXT\nE\tBearer PRIVATE_TOKEN\n"
        val records = CrashFingerprints.decode(raw)
        val encoded = CrashFingerprints.encode(records)
        assertFalse(encoded.contains("PRIVATE")); assertFalse(encoded.contains("https://"))
        assertEquals("other", records[0].causes.last().type)
        assertEquals(1, records[0].causes.sumOf { it.frames.size })
    }
    @Test fun encoderSanitizesConstructedValuesAndBoundsOutputBeforePersistence() {
        val injected = sample().copy(causes = listOf(CrashCause("java.lang.Error\nPRIVATE_MESSAGE", listOf(CrashCodeFrame("com.bobmobile.MainActivity", "Bearer PRIVATE_TOKEN", 1)))))
        assertFalse(CrashFingerprints.encode(listOf(injected)).contains("PRIVATE"))
        val huge = sample().copy(causes = List(100) { CrashCause("java.lang.Error", List(1000) { CrashCodeFrame("com.bobmobile.MainActivity", "onResume", 123) }) })
        val raw = CrashFingerprints.encode(List(100) { huge })
        val decoded = CrashFingerprints.decode(raw)
        assertEquals(3, decoded.size)
        assertTrue(raw.length < CrashFingerprints.MAX_CHARS)
        for (record in decoded) { assertEquals(4, record.causes.size); assertEquals(24, record.causes.sumOf { it.frames.size }) }
    }
}
