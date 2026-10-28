package com.bobmobile

import android.app.Application
import android.os.Bundle
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.shell.MainReactPackage
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.react.uimanager.ViewManager
import com.facebook.soloader.SoLoader
import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArrayList

/** Separate test APK only. Real Fabric, Hermes, production manager and RN row. */
class InlineProbeApplication : Application(), ReactApplication {
    override val reactHost: ReactHost by lazy { getDefaultReactHost(applicationContext, listOf(MainReactPackage(), InlineProbePackage()), useDevSupport = false) }
    override fun onCreate() { super.onCreate(); SoLoader.init(this, OpenSourceMergedSoMapping); DefaultNewArchitectureEntryPoint.load() }
}
class InlineReactProbeActivity : ReactActivity() {
    override fun getMainComponentName() = "InlineReactProbe"
    override fun createReactActivityDelegate(): ReactActivityDelegate = object : DefaultReactActivityDelegate(this, mainComponentName, true) {
        override fun getLaunchOptions() = Bundle().apply { putString("fixtures", intent.getStringExtra("fixtures")); putBoolean("inverted", intent.getBooleanExtra("inverted", false)) }
    }
}
internal object InlineProbeEvents { val values = CopyOnWriteArrayList<JSONObject>() }
private class InlineProbeModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "InlineProbe"
    @ReactMethod fun record(name: String, data: String) { if (InlineProbeEvents.values.size < 100) InlineProbeEvents.values.add(JSONObject().put("name", name).put("data", JSONObject(data))) }
}
private class InlineProbePackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(BobInteractive(context), InlineProbeModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = listOf(BobInlineSurfaceManager())
}
