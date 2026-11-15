package com.bobmobile

import android.os.SystemClock
import android.view.HapticFeedbackConstants
import android.view.Window
import com.facebook.react.common.LifecycleState
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import java.util.WeakHashMap

/** UI-thread-only view feedback. No vibrator permission, custom waveform,
 * background work, or flags that override the owner's Android touch setting. */
internal object BobHaptics {
    private val extraWindows = WeakHashMap<Window, Unit>()
    private var lastTick: Long? = null

    fun attach(window: Window) { extraWindows[window] = Unit }
    fun detach(window: Window) { extraWindows.remove(window) }
    fun clear() { extraWindows.clear(); lastTick = null }

    fun selection(context: ReactApplicationContext) {
        val requestedAt = SystemClock.elapsedRealtime()
        UiThreadUtil.runOnUiThread {
            try {
                val now = SystemClock.elapsedRealtime()
                if (context.lifecycleState != LifecycleState.RESUMED || now - requestedAt > 120) return@runOnUiThread
                if (lastTick?.let { now - it < 80 } == true) return@runOnUiThread
                val activity = context.currentActivity ?: return@runOnUiThread
                if (activity.isFinishing || activity.isDestroyed) return@runOnUiThread
                // RN Modal owns a Dialog window; the Activity loses focus while a
                // menu is open. Prefer its focused decor rather than dropping ticks.
                val decor = extraWindows.keys.firstOrNull {
                    it.decorView.isAttachedToWindow && it.decorView.hasWindowFocus()
                }?.decorView ?: activity.window?.decorView
                if (decor == null || !decor.isAttachedToWindow || !decor.hasWindowFocus()) return@runOnUiThread
                lastTick = now
                decor.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
            } catch (_: Exception) {
                // Unsupported feedback must not affect the selected action.
            }
        }
    }
}
