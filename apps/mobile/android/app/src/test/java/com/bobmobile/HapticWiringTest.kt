package com.bobmobile

import java.io.File
import org.junit.Assert.*
import org.junit.Test

/** Structural guardrails, not a measurement of device motor intensity. */
class HapticWiringTest {
    private val code get() = File("src/main/java/com/bobmobile/BobHaptics.kt").readText()
    @Test fun subtlePlatformFeedbackNeverOverridesUserSettingsOrRequestsVibratorPermission() {
        assertTrue(code.contains("performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)"))
        assertFalse(code.contains("FLAG_IGNORE"))
        assertFalse(code.contains("Vibrator"))
        assertFalse(File("src/main/AndroidManifest.xml").readText().contains("android.permission.VIBRATE"))
        assertTrue(code.contains("UiThreadUtil.runOnUiThread"))
        assertTrue(code.contains("LifecycleState.RESUMED"))
        assertTrue(code.contains("hasWindowFocus()"))
        assertTrue(code.contains("isAttachedToWindow"))
        assertTrue(code.contains("now - requestedAt > 120"))
        assertTrue(code.contains("now - it < 80"))
    }
    @Test fun nativeBridgeHandlesModalFocusAndCleansUpExtraWindows() {
        val platform = File("src/main/java/com/bobmobile/BobPlatform.kt").readText()
        assertTrue(platform.contains("@ReactMethod fun selectionHaptic() { BobHaptics.selection(context) }"))
        assertTrue(platform.contains("BobHaptics.attach(window)"))
        assertTrue(platform.contains("BobHaptics.detach(window)"))
        assertTrue(platform.contains("BobHaptics.clear()"))
        assertTrue(code.contains("WeakHashMap<Window, Unit>()"))
    }
}
