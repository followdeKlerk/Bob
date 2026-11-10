package com.bobmobile

import java.io.File
import org.junit.Assert.*
import org.junit.Test

class ImageGesturePolicyTest {
    private fun policy() = ImageGesturePolicy(10f).apply { enabled = true; down(100f, 200f, 1) }
    private fun ignoredUntilDown(p: ImageGesturePolicy) {
        assertFalse(p.holdsParent)
        p.move(500f, 200f, 1)
        assertFalse(p.holdsParent)
        assertNull(p.translation(100f))
        p.down(100f, 200f, 1)
        assertTrue(p.holdsParent)
    }

    @Test fun disabledByDefaultAndEnablingCannotAdmitAnOldStream() {
        val p = ImageGesturePolicy(10f)
        assertFalse(p.enabled)
        assertEquals(0, p.gestureKey)
        p.down(100f, 200f, 1)
        p.enabled = true
        ignoredUntilDown(p)
    }
    @Test fun downReservesImmediatelyAndSubSlopMovementDoesNotChooseAnAxis() {
        val p = policy()
        assertTrue(p.holdsParent)
        p.move(109f, 209f, 1)
        assertTrue(p.holdsParent)
        assertNull(p.translation(100f))
        p.move(110f, 200f, 1)
        assertEquals(10f, p.translation(100f))
    }
    @Test fun originalDiagonalRegressionKeepsAllHorizontalSignsReserved() {
        for (x in listOf(-1, 1)) for (y in listOf(-1, 1)) {
            val p = policy()
            p.move(100f + 30 * x, 200f + 20 * y, 1)
            assertTrue(p.holdsParent)
            assertEquals(30f * x, p.translation(100f))
            p.move(100f + 35 * x, 200f + 200 * y, 1)
            assertTrue(p.holdsParent) // Horizontal ownership cannot flip later.
            assertEquals(35f * x, p.translation(100f))
        }
    }
    @Test fun verticalAndAmbiguousDiagonalsYieldPermanentlyInBothDirections() {
        for (x in listOf(-1, 1)) for (y in listOf(-1, 1)) for (dx in listOf(0f, 20f, 24f)) {
            val p = policy()
            p.move(100f + dx * x, 200f + 20 * y, 1)
            assertFalse(p.holdsParent) // Includes exact 1.2 boundary, not predominantly horizontal.
            p.move(100f + 300 * x, 200f, 1)
            assertFalse(p.holdsParent)
            assertNull(p.translation(100f))
            p.down(100f, 200f, 1)
            p.move(130f, 200f, 1)
            assertTrue(p.holdsParent)
        }
    }
    @Test fun translationUsesOriginalGuardDownAndClampsAtBothGuardEdges() {
        val p = policy()
        p.move(150f, 200f, 1)
        assertEquals(50f, p.translation(80f))
        p.move(250f, 200f, 1)
        assertEquals(80f, p.translation(80f))
        p.move(-50f, 200f, 1)
        assertEquals(-80f, p.translation(80f))
        assertEquals(0f, p.translation(0f)!!, 0f)
    }
    @Test fun terminalAndLifecycleCancellationIgnoreTheRemainingOldStream() {
        // Native wiring below verifies that each of these triggers the same policy cancellation.
        for (reason in listOf("UP", "CANCEL", "POINTER_DOWN", "POINTER_UP", "focus", "detach", "drop")) {
            for (horizontal in listOf(false, true)) {
                val p = policy()
                if (horizontal) p.move(130f, 220f, 1)
                p.cancel()
                assertFalse(reason, p.holdsParent)
                ignoredUntilDown(p)
            }
        }
    }
    @Test fun disablingAndEpochChangesCancelButSameEpochDoesNot() {
        val p = policy()
        p.move(130f, 200f, 1)
        p.gestureKey = 0
        assertTrue(p.holdsParent)
        p.gestureKey = 1
        ignoredUntilDown(p)
        p.enabled = false
        p.enabled = true
        ignoredUntilDown(p)
        p.gestureKey = -1 // Numeric local epoch; no authority or ordering semantics.
        ignoredUntilDown(p)
    }
    @Test fun multiTouchCannotResumeWhenOnePointerRemains() {
        for (horizontal in listOf(false, true)) {
            val p = policy()
            if (horizontal) p.move(130f, 200f, 1)
            p.move(150f, 200f, 2)
            ignoredUntilDown(p)
            p.down(100f, 200f, 2)
            ignoredUntilDown(p)
        }
    }

    private val source get() = File("src/main/java/com/bobmobile/BobImageGesture.kt").readText()
    @Test fun nativeBoundaryWiresCancellationAndPreservesRnTouchDelivery() {
        val code = source
        assertTrue(code.contains("ReactViewGroup(react)"))
        assertTrue(code.contains("BobImageGestureManager : ReactViewManager()"))
        assertTrue(code.contains("scaledTouchSlop"))
        assertTrue(code.contains("policy.down(event.x, event.y, event.pointerCount)"))
        assertTrue(code.contains("policy.move(event.x, event.y, event.pointerCount)"))
        assertFalse(code.contains("rawX"))
        assertFalse(code.contains("NativeGestureUtil"))
        assertFalse(code.contains("override fun onInterceptTouchEvent"))
        assertFalse(code.contains("override fun onTouchEvent"))
        assertTrue(code.contains("super.requestDisallowInterceptTouchEvent(policy.holdsParent)"))
        assertTrue(code.indexOf("super.requestDisallowInterceptTouchEvent(policy.holdsParent)", code.indexOf("override fun dispatchTouchEvent")) < code.indexOf("super.dispatchTouchEvent(event)"))
        assertTrue(code.contains("ACTION_POINTER_DOWN, MotionEvent.ACTION_POINTER_UP, MotionEvent.ACTION_CANCEL -> release()"))
        assertTrue(code.contains("finally { if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) release() }"))
        assertTrue(code.contains("if (!hasWindowFocus) release()"))
        assertTrue(code.contains("if (!gainFocus) release()"))
        assertTrue(code.contains("onDetachedFromWindow() { release();"))
        assertTrue(code.contains("policy.enabled = value; if (!value) release()"))
        assertTrue(code.contains("policy.gestureKey != value"))
        assertTrue(code.contains("policy.gestureKey = value; release()"))
        assertTrue(code.contains("onDropViewInstance(view: ReactViewGroup) { (view as BobImageGestureView).release()"))
    }
    @Test fun nativeAnimatedDirectEventAndPackageAreRegisteredWithSafeDefaults() {
        val code = source
        for (prop in listOf("gestureEnabled", "trackDrag")) assertTrue(code.contains("@ReactProp(name = \"$prop\", defaultBoolean = false)"))
        assertTrue(code.contains("@ReactProp(name = \"gestureKey\", defaultInt = 0)"))
        assertTrue(code.contains("var trackDrag = false"))
        assertTrue(code.contains("getName() = \"BobImageGesture\""))
        assertTrue(code.contains("\"topImageDrag\", mapOf(\"registrationName\" to \"onImageDrag\")"))
        assertTrue(code.contains("Event<ImageDragEvent>(surface, view)"))
        assertTrue(code.contains("putDouble(\"translationX\""))
        assertTrue(code.contains("action == MotionEvent.ACTION_MOVE && trackDrag"))
        assertTrue(code.contains("policy.translation(width.toFloat())"))
        assertTrue(code.contains("UIManagerHelper.getEventDispatcher(react)?.dispatchEvent("))
        assertTrue(code.contains("UIManagerHelper.getSurfaceId(this), id, PixelUtil.toDIPFromPixel(delta)"))
        assertTrue(File("src/main/java/com/bobmobile/MainApplication.kt").readText().contains("add(BobImageGesturePackage())"))
    }
}
