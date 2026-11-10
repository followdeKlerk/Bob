package com.bobmobile

import android.graphics.Color
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManager
import com.facebook.react.uimanager.annotations.ReactProp

internal class BobMediaManager : SimpleViewManager<BobMediaView>() {
    override fun getName() = "BobInlineMedia"
    override fun createViewInstance(context: ThemedReactContext) = BobMediaView(context)
    @ReactProp(name = "source") fun source(view: BobMediaView, value: ReadableMap?) { view.start(value) }
    @ReactProp(name = "sizing") fun sizing(view: BobMediaView, value: ReadableMap?) { view.sizing(value) }
    @ReactProp(name = "control") fun control(view: BobMediaView, value: ReadableMap?) { view.command(value) }
    @ReactProp(name = "palette") fun palette(view: BobMediaView, value: ReadableMap?) {
        if (value != null) try { view.colors(Color.parseColor(value.getString("foreground")), Color.parseColor(value.getString("background")), Color.parseColor(value.getString("muted"))) } catch (_: Exception) {}
    }
    override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> = mutableMapOf(
        "topStopped" to mapOf("registrationName" to "onStopped"),
        "topProgress" to mapOf("registrationName" to "onProgress"),
    )
    override fun onDropViewInstance(view: BobMediaView) { view.dispose(); super.onDropViewInstance(view) }
}

class BobMediaPackage : ReactPackage {
    @Suppress("OVERRIDE_DEPRECATION")
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = emptyList()
    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = listOf(BobMediaManager())
}
