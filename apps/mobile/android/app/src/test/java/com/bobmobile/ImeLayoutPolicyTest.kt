package com.bobmobile

import org.junit.Assert.assertEquals
import org.junit.Test

class ImeLayoutPolicyTest {
    @Test fun morphFractionTracksOpeningClosingReversalAndInitialVisibleInsets() {
        for (ime in listOf(0, 75, 225, 300, 180, 60, 0)) assertEquals(ime / 300.0, ImeLayoutPolicy.fraction(ime, 300, true), 0.00001)
        assertEquals(1.0, ImeLayoutPolicy.fraction(300, 0, true), 0.0)
        assertEquals(0.0, ImeLayoutPolicy.fraction(0, 0, false), 0.0)
        assertEquals(0.0, ImeLayoutPolicy.fraction(-1, 300, true), 0.0)
        assertEquals(1.0, ImeLayoutPolicy.fraction(Int.MAX_VALUE, 300, true), 0.0)
    }
    @Test fun edgeToEdgeKeyboardTracksActualProgressAndReversal() {
        for (ime in listOf(0, 20, 140, 300, 160, 20, 0)) assertEquals(ime, ImeLayoutPolicy.overlap(1000, 1000, 1000, ime))
    }
    @Test fun safeAreaIsAlreadyConsumedByHostBounds() {
        assertEquals(276, ImeLayoutPolicy.overlap(976, 976, 1000, 300))
        assertEquals(0, ImeLayoutPolicy.overlap(976, 976, 1000, 0))
    }
    @Test fun actualSystemResizeIsNotAppliedTwice() {
        assertEquals(0, ImeLayoutPolicy.overlap(700, 700, 1000, 300))
        assertEquals(100, ImeLayoutPolicy.overlap(800, 800, 1000, 300))
    }
    @Test fun boundsAreSafeForSmallSplitWindowsOrientationAndUntrustedIntegers() {
        assertEquals(200, ImeLayoutPolicy.overlap(600, 200, 600, 500))
        assertEquals(0, ImeLayoutPolicy.overlap(600, 0, 600, 500))
        assertEquals(0, ImeLayoutPolicy.overlap(600, 600, 600, -1))
        assertEquals(600, ImeLayoutPolicy.overlap(Int.MAX_VALUE, 600, 0, Int.MAX_VALUE))
    }
}
