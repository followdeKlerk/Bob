package com.bobmobile

import android.app.Activity
import android.app.Application
import android.graphics.Color
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

/** Edge-to-edge with only the status bar hidden, not immersive navigation or kiosk mode.
 * Home/overview remain available without a reveal swipe. IME, permissions and external
 * activities are not hidden or intercepted. UI-thread only. */
internal object BobFullscreen {
    // Values must not strongly retain their weak Window key through a captured listener.
    private val listeners = WeakHashMap<Window, WeakReference<ViewTreeObserver.OnWindowFocusChangeListener>>()
    @Suppress("DEPRECATION") // Explicit transparency for Android versions before enforced edge-to-edge.
    fun apply(window: Window) {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.navigationBarColor = Color.TRANSPARENT
        if (Build.VERSION.SDK_INT >= 29) {
            window.isNavigationBarContrastEnforced = false
        }
        if (Build.VERSION.SDK_INT >= 28) {
            val mode = if (Build.VERSION.SDK_INT >= 30) WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                else WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            if (window.attributes.layoutInDisplayCutoutMode != mode) window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode = mode
            }
        }
        WindowCompat.getInsetsController(window, window.decorView).apply {
            // Do not use transient immersive bars: the first bottom gesture must navigate,
            // not just reveal the navigation bar. Also reset any previous hidden-nav state.
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_DEFAULT
            hide(WindowInsetsCompat.Type.statusBars())
            show(WindowInsetsCompat.Type.navigationBars())
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
