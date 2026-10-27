package com.bobmobile

import android.view.View
import android.view.ViewGroup
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Reports the exact soft-keyboard (IME) bottom inset.
 *
 * The app runs edge-to-edge on Android 15+, where the window is no longer resized for the
 * keyboard. Without this measurement the composer stays behind the keyboard, so the inset is
 * observed natively and applied by the React Native layout.
 */
class BobKeyboard(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    private var imeBottomDp = 0.0

    override fun getName() = "BobKeyboard"

    private fun publish(value: Double) {
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("BobKeyboardInset", Arguments.createMap().apply { putDouble("imeBottom", value) })
    }

    @ReactMethod fun enable(promise: Promise) {
        val activity = context.currentActivity
        if (activity == null) {
            promise.reject("unavailable", "No foreground activity")
            return
        }
        activity.runOnUiThread {
            try {
                val content: View = activity.findViewById(android.R.id.content) ?: activity.window.decorView
                // Observe the React root so the original insets keep flowing to its children.
                val root: View = if (content is ViewGroup && content.childCount > 0) content.getChildAt(0) else content
                ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
                    val ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
                    val density = context.resources.displayMetrics.density
                    val dp = if (density > 0f) (ime / density).toDouble() else 0.0
                    if (dp != imeBottomDp) {
                        imeBottomDp = dp
                        publish(dp)
                    }
                    // Unconsumed: children keep receiving the original insets.
                    insets
                }
                ViewCompat.requestApplyInsets(root)
                promise.resolve(imeBottomDp)
            } catch (e: Exception) {
                promise.reject("insets", "Unable to observe keyboard insets", e)
            }
        }
    }

    @ReactMethod fun currentInset(promise: Promise) = promise.resolve(imeBottomDp)
}
