package com.bobmobile

import android.app.Activity
import android.app.Application
import android.os.Build
import android.os.Bundle
import android.view.ViewTreeObserver
import android.view.Window
import android.view.WindowManager
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.lang.ref.WeakReference
import java.util.WeakHashMap

/** Immersive, not kiosk mode. Edge swipes reveal transient Android bars; IME,
 * permissions and external activities are not hidden or intercepted. UI-thread only. */
internal object BobFullscreen {
    // Values must not strongly retain their weak Window key through a captured listener.
    private val listeners = WeakHashMap<Window, WeakReference<ViewTreeObserver.OnWindowFocusChangeListener>>()
    fun apply(window: Window) {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        if (Build.VERSION.SDK_INT >= 28) {
            val mode = if (Build.VERSION.SDK_INT >= 30) WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                else WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            if (window.attributes.layoutInDisplayCutoutMode != mode) window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode = mode
            }
        }
        WindowCompat.getInsetsController(window, window.decorView).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.systemBars())
        }
    }
    fun attach(window: Window) {
        if (!listeners.containsKey(window)) {
            val listener = ViewTreeObserver.OnWindowFocusChangeListener { focused -> if (focused) apply(window) }
            listeners[window] = WeakReference(listener)
            window.decorView.viewTreeObserver.addOnWindowFocusChangeListener(listener)
        }
        apply(window)
    }
    fun detach(window: Window) {
        val listener = listeners.remove(window)?.get() ?: return
        val observer = window.decorView.viewTreeObserver
        if (observer.isAlive) observer.removeOnWindowFocusChangeListener(listener)
    }
    fun install(application: Application) {
        application.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) { attach(activity.window) }
            override fun onActivityResumed(activity: Activity) { attach(activity.window) }
            override fun onActivityDestroyed(activity: Activity) { detach(activity.window) }
            override fun onActivityStarted(activity: Activity) {}
            override fun onActivityPaused(activity: Activity) {}
            override fun onActivityStopped(activity: Activity) {}
            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
        })
    }
}
