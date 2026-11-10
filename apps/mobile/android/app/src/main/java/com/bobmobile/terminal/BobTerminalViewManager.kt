package com.bobmobile

import com.facebook.react.bridge.ReadableMap
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

internal class BobTerminalViewManager : SimpleViewManager<BobTerminalView>() {
    override fun getName() = "BobTerminalView"
    override fun createViewInstance(context: ThemedReactContext) = BobTerminalView(context)
    @ReactProp(name = "session") fun session(view: BobTerminalView, value: String?) { view.sessionProp = value }
    @ReactProp(name = "active", defaultBoolean = false) fun active(view: BobTerminalView, value: Boolean) { view.activeProp = value }
    @ReactProp(name = "control") fun control(view: BobTerminalView, value: ReadableMap?) { view.controlProp = value }
    override fun onAfterUpdateTransaction(view: BobTerminalView) {
        super.onAfterUpdateTransaction(view)
        view.applyProps()
    }
    override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> = mutableMapOf(
        "topState" to mapOf("registrationName" to "onState")
    )
    override fun onDropViewInstance(view: BobTerminalView) { view.dispose(); super.onDropViewInstance(view) }
}
