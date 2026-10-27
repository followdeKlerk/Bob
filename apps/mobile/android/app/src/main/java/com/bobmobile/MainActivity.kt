package com.bobmobile
import android.content.Intent

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: android.os.Bundle?) {
    super.onCreate(savedInstanceState)
    AppDiagnostics.record(this, "activity.create")
  }
  override fun onResume() { super.onResume(); AppDiagnostics.record(this, "activity.resume") }
  override fun onPause() { AppDiagnostics.record(this, "activity.pause"); super.onPause() }
  override fun onStop() { AppDiagnostics.record(this, "activity.stop"); super.onStop() }
  override fun onDestroy() { AppDiagnostics.record(this, "activity.destroy"); super.onDestroy() }
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
