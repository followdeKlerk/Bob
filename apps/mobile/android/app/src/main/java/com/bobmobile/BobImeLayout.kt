package com.bobmobile

import android.os.Build
import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.uimanager.PixelUtil
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.Event
import com.facebook.react.views.view.ReactViewGroup
import com.facebook.react.views.view.ReactViewManager

private class ImeProgressEvent(surface: Int, view: Int, private val overlap: Float, private val fraction: Double) : Event<ImeProgressEvent>(surface, view) {
    override fun getEventName() = "topImeProgress"
    override fun getEventData() = Arguments.createMap().apply { putDouble("overlap", overlap.toDouble()); putDouble("fraction", fraction) }
}

/** The unpadded host's screen bounds account for navigation safe area and any
 * actual system resize exactly once. No Activity flags or ancestor listeners
 * are changed. Progress goes directly to the UI worklet, not React state. */
internal class BobImeLayoutView(private val react: ThemedReactContext) : ReactViewGroup(react) {
    var imeActive = false
        set(value) { field = value; if (value) ViewCompat.requestApplyInsets(this) }
    private val animations = mutableSetOf<WindowInsetsAnimationCompat>()
    private val imeBounds = mutableMapOf<WindowInsetsAnimationCompat, Int>()
    private var latest: WindowInsetsCompat? = null
    init {
        ViewCompat.setOnApplyWindowInsetsListener(this) { _, insets ->
            latest = insets
            if (animations.isEmpty()) progress(insets)
            insets
        }
        ViewCompat.setWindowInsetsAnimationCallback(this, object : WindowInsetsAnimationCompat.Callback(DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
            override fun onPrepare(animation: WindowInsetsAnimationCompat) {
                if (animation.typeMask and WindowInsetsCompat.Type.ime() != 0) animations.add(animation)
            }
            override fun onStart(animation: WindowInsetsAnimationCompat, bounds: WindowInsetsAnimationCompat.BoundsCompat): WindowInsetsAnimationCompat.BoundsCompat {
                if (animation in animations) imeBounds[animation] = bounds.upperBound.bottom
                return bounds
            }
            override fun onProgress(insets: WindowInsetsCompat, runningAnimations: List<WindowInsetsAnimationCompat>): WindowInsetsCompat {
                progress(insets)
                return insets
            }
            override fun onEnd(animation: WindowInsetsAnimationCompat) {
                animations.remove(animation)
                imeBounds.remove(animation)
                if (animations.isEmpty()) latest?.let { progress(it) }
            }
        })
    }
    private fun progress(insets: WindowInsetsCompat) {
        if (!imeActive || windowVisibility != View.VISIBLE || height <= 0 || id == NO_ID || !react.hasActiveReactInstance()) return
        // Android 11+ is the supported IME-animation path; older releases retain
        // settled JS avoidance rather than guessing full-window geometry.
        if (Build.VERSION.SDK_INT < 30) return
        val activity = react.currentActivity ?: return
        val position = IntArray(2); getLocationOnScreen(position)
        val windowBottom = activity.windowManager.currentWindowMetrics.bounds.bottom
        val ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
        val overlap = ImeLayoutPolicy.overlap(position[1] + height, height, windowBottom, ime)
        val fraction = ImeLayoutPolicy.fraction(ime, imeBounds.values.maxOrNull() ?: 0, insets.isVisible(WindowInsetsCompat.Type.ime()))
        UIManagerHelper.getEventDispatcher(react)?.dispatchEvent(ImeProgressEvent(UIManagerHelper.getSurfaceId(this), id, PixelUtil.toDIPFromPixel(overlap.toFloat()), fraction))
    }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); ViewCompat.requestApplyInsets(this) }
    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        super.onLayout(changed, left, top, right, bottom)
        if (animations.isEmpty()) latest?.let { progress(it) }
    }
    override fun onWindowVisibilityChanged(visibility: Int) { super.onWindowVisibilityChanged(visibility); if (visibility == View.VISIBLE) ViewCompat.requestApplyInsets(this) }
    override fun onDetachedFromWindow() { animations.clear(); imeBounds.clear(); latest = null; super.onDetachedFromWindow() }
}

internal class BobImeLayoutManager : ReactViewManager() {
    override fun getName() = "BobImeLayout"
    override fun createViewInstance(context: ThemedReactContext) = BobImeLayoutView(context)
    @ReactProp(name = "imeActive", defaultBoolean = false)
    fun setImeActive(view: ReactViewGroup, value: Boolean) { (view as BobImeLayoutView).imeActive = value }
    override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> =
        (super.getExportedCustomDirectEventTypeConstants() ?: mutableMapOf()).apply {
            put("topImeProgress", mapOf("registrationName" to "onImeProgress"))
        }
}
