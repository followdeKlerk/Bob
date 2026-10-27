package com.bobmobile

import org.junit.Assert.*
import org.junit.Test

class DiagnosticPolicyTest {
    @Test fun metadataMustBeFiniteBoundedIntegers() {
        assertEquals(42L, DiagnosticPolicy.number(42.0, 100))
        for (value in listOf(-1.0, 1.5, Double.NaN, Double.POSITIVE_INFINITY, 101.0)) assertNull(DiagnosticPolicy.number(value, 100))
        assertTrue(DiagnosticPolicy.coordinate(1, 0)); assertFalse(DiagnosticPolicy.coordinate(0, 0))
        assertFalse(DiagnosticPolicy.coordinate(1, 100_000_001))
        assertFalse(DiagnosticPolicy.types.contains("private message")); assertFalse(DiagnosticPolicy.sources.contains("https://secret"))
    }
    @Test fun rollingWindowsStayBoundedAndRetainNewestSamples() {
        var samples = emptyList<Int>()
        for (i in 0 until 10000) samples = DiagnosticPolicy.append(samples, i, DiagnosticPolicy.SAMPLE_LIMIT)
        assertEquals(48, samples.size); assertEquals(9999, samples.last()); assertEquals(9952, samples.first())
        assertEquals(8, DiagnosticPolicy.CRITICAL_LIMIT); assertEquals(3, DiagnosticPolicy.FAULT_LIMIT)
    }
}
