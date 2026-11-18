package com.bobmobile
import android.content.Intent

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {
  // RN AlertFragment inflates its accessible title in this Activity theme separately
  // from its AppCompat dialog context. Keep both palettes paired without recreation.
  private val alertAppearance = object : BobAppearance.Listener {
    override fun applyAppearance() {
      theme.applyStyle(if (BobAppearance.palette(this@MainActivity).light) R.style.BobAlertOwner_Light else R.style.BobAlertOwner_Dark, true)
    }
  }
  override fun onCreate(savedInstanceState: android.os.Bundle?) {
    alertAppearance.applyAppearance()
    super.onCreate(savedInstanceState)
    BobAppearance.addListener(alertAppearance)
    AppDiagnostics.record(this, "activity.create")
  }
  override fun onResume() {
    synchronized(NotificationWatchStore) {
      NotificationRuntime.appVisible = true
      AttentionNotifications.clear(this)
      AttentionNotifications.migrate(this)
    }
    super.onResume(); AppDiagnostics.record(this, "activity.resume")
  }
  override fun onPause() { synchronized(NotificationWatchStore) { NotificationRuntime.appVisible = false }; AppDiagnostics.record(this, "activity.pause"); super.onPause() }
  override fun onStop() { AppDiagnostics.record(this, "activity.stop"); super.onStop() }
  override fun onDestroy() { BobAppearance.removeListener(alertAppearance); AppDiagnostics.record(this, "activity.destroy"); super.onDestroy() }
  override fun onUserLeaveHint() { AppDiagnostics.record(this, "activity.user-leave"); super.onUserLeaveHint() }
  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    AppDiagnostics.record(this, if (hasFocus) "activity.focus-gained" else "activity.focus-lost")
  }
  @Suppress("DEPRECATION")
  override fun onBackPressed() {
    AppDiagnostics.record(this, "activity.back")
    // Preserve React Native's Back dispatch, but never fall through to Android's
    // root-task finish/minimize if JS is not ready or has no registered listener.
    if (!reactActivityDelegate.onBackPressed()) AppDiagnostics.record(this, "activity.back-no-js-ignored")
  }
  override fun invokeDefaultOnBackPressed() {
    AppDiagnostics.record(this, "activity.default-back-ignored")
  }
  override fun onNewIntent(intent: Intent) { setIntent(intent); super.onNewIntent(intent) }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "BobMobile"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
