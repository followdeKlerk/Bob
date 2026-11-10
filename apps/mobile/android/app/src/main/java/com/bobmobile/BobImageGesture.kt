package com.bobmobile

import android.graphics.Rect
import android.view.MotionEvent
import android.view.ViewConfiguration
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.PixelUtil
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.ViewManager
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.Event
import com.facebook.react.views.view.ReactViewGroup
import com.facebook.react.views.view.ReactViewManager

private class ImageDragEvent(surface: Int, view: Int, private val translation: Float) : Event<ImageDragEvent>(surface, view) {
    override fun getEventName() = "topImageDrag"
    override fun getEventData() = Arguments.createMap().apply { putDouble("translationX", translation.toDouble()) }
}

internal class BobImageGestureView(private val react: ThemedReactContext) : ReactViewGroup(react) {
    val policy = ImageGesturePolicy(ViewConfiguration.get(react).scaledTouchSlop.toFloat())
    var trackDrag = false

    fun release() { policy.cancel(); super.requestDisallowInterceptTouchEvent(false) }

    // Descendants cannot release a pending/horizontal reservation, or re-lock a yielded stream.
    override fun requestDisallowInterceptTouchEvent(disallowIntercept: Boolean) {
        super.requestDisallowInterceptTouchEvent(policy.holdsParent)
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        val action = event.actionMasked
        when (action) {
            MotionEvent.ACTION_DOWN -> policy.down(event.x, event.y, event.pointerCount)
            MotionEvent.ACTION_MOVE -> {
                // Android batches MOVE samples. Classify the earliest intent,
                // not only the last point of a frame that has already bent.
                for (sample in 0 until event.historySize) {
                    policy.move(event.getHistoricalX(sample), event.getHistoricalY(sample), event.pointerCount)
                }
                policy.move(event.x, event.y, event.pointerCount)
            }
            MotionEvent.ACTION_POINTER_DOWN, MotionEvent.ACTION_POINTER_UP, MotionEvent.ACTION_CANCEL -> release()
        }
        // Before child dispatch/JS grant: the ScrollView must not see an unreserved first MOVE.
        super.requestDisallowInterceptTouchEvent(policy.holdsParent)
        if (action == MotionEvent.ACTION_MOVE && trackDrag && id != NO_ID && react.hasActiveReactInstance()) {
            policy.translation(width.toFloat())?.let { delta ->
                UIManagerHelper.getEventDispatcher(react)?.dispatchEvent(
                    ImageDragEvent(UIManagerHelper.getSurfaceId(this), id, PixelUtil.toDIPFromPixel(delta)))
            }
        }
        // Preserve RN touch delivery and the parent's JS responder; this view never claims a native gesture.
        return try { super.dispatchTouchEvent(event) }
        finally { if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) release() }
    }

    override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
        if (!hasWindowFocus) release()
        super.onWindowFocusChanged(hasWindowFocus)
    }
    override fun onFocusChanged(gainFocus: Boolean, direction: Int, previouslyFocusedRect: Rect?) {
        if (!gainFocus) release()
        super.onFocusChanged(gainFocus, direction, previouslyFocusedRect)
    }
    override fun onDetachedFromWindow() { release(); super.onDetachedFromWindow() }
}

internal class BobImageGestureManager : ReactViewManager() {
    override fun getName() = "BobImageGesture"
    override fun createViewInstance(context: ThemedReactContext) = BobImageGestureView(context)
    @ReactProp(name = "gestureEnabled", defaultBoolean = false)
    fun setGestureEnabled(view: ReactViewGroup, value: Boolean) {
        (view as BobImageGestureView).apply { policy.enabled = value; if (!value) release() }
    }
    @ReactProp(name = "trackDrag", defaultBoolean = false)
    fun setTrackDrag(view: ReactViewGroup, value: Boolean) { (view as BobImageGestureView).trackDrag = value }
    @ReactProp(name = "gestureKey", defaultInt = 0)
    fun setGestureKey(view: ReactViewGroup, value: Int) {
        (view as BobImageGestureView).apply { if (policy.gestureKey != value) { policy.gestureKey = value; release() } }
    }
    override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> =
        (super.getExportedCustomDirectEventTypeConstants() ?: mutableMapOf()).apply {
            put("topImageDrag", mapOf("registrationName" to "onImageDrag"))
        }
    override fun onDropViewInstance(view: ReactViewGroup) { (view as BobImageGestureView).release(); super.onDropViewInstance(view) }
}

class BobImageGesturePackage : ReactPackage {
    @Suppress("OVERRIDE_DEPRECATION")
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = emptyList()
    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = listOf(BobImageGestureManager())
}
