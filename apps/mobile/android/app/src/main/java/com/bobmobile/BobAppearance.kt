package com.bobmobile

import android.app.AlertDialog
import android.app.Application
import android.content.ComponentCallbacks
import android.content.Context
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Color
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import java.util.WeakHashMap

/** App-owned chrome only. Never override configuration, recreate an Activity, or theme document content.
 * The local preference is a startup mirror; JS/AsyncStorage remains the settings authority. UI-thread only. */
internal object BobAppearance {
    data class Palette(val light: Boolean, val background: Int, val foreground: Int, val muted: Int, val accent: Int, val onAccent: Int) {
        val backgroundCss get() = "#%06x".format(background and 0xffffff)
        val foregroundCss get() = "#%06x".format(foreground and 0xffffff)
    }
    private val light = Palette(true, Color.parseColor("#f7f5f0"), Color.parseColor("#292720"), Color.parseColor("#655f54"), Color.parseColor("#302d27"), Color.parseColor("#fffdf8"))
    private val dark = Palette(false, Color.parseColor("#000000"), Color.parseColor("#e8e0d2"), Color.parseColor("#a1a1a1"), Color.parseColor("#e8e0d2"), Color.parseColor("#000000"))
    private enum class Role { BACKGROUND, TEXT, MUTED, BUTTON }
    // No value captures its weak key; closed Activities/panels must remain collectible.
    private val views = WeakHashMap<View, Set<Role>>()
    interface Listener { fun applyAppearance() }
    private val listeners = WeakHashMap<Listener, Unit>()
    private fun preferences(context: Context) = context.applicationContext.getSharedPreferences("bob-appearance", Context.MODE_PRIVATE)
    fun palette(context: Context): Palette {
        val mode = preferences(context).getString("appearance", "system")
        val systemDark = context.applicationContext.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
        return if (mode == "light" || (mode != "dark" && !systemDark)) light else dark
    }
    fun set(context: Context, mode: String) {
        require(mode == "light" || mode == "dark" || mode == "system") { "Unknown appearance" }
        preferences(context).edit().putString("appearance", mode).apply()
        refresh()
    }
    fun background(view: View) = track(view, Role.BACKGROUND)
    fun text(view: TextView, muted: Boolean = false) = track(view, if (muted) Role.MUTED else Role.TEXT)
    fun button(view: Button) = track(view, Role.BUTTON)
    private fun track(view: View, role: Role) { views[view] = (views[view] ?: emptySet()) + role; apply(view, role) }
    private fun apply(view: View, role: Role) {
        val colors = palette(view.context)
        when (role) {
            Role.BACKGROUND -> view.setBackgroundColor(colors.background)
            Role.TEXT -> (view as TextView).setTextColor(colors.foreground)
            Role.MUTED -> (view as TextView).setTextColor(colors.muted)
            Role.BUTTON -> (view as Button).apply {
                setTextColor(colors.onAccent)
                backgroundTintList = ColorStateList.valueOf(colors.accent)
            }
        }
    }
    fun addListener(listener: Listener) { listeners[listener] = Unit; listener.applyAppearance() }
    fun removeListener(listener: Listener) { listeners.remove(listener) }
    fun dialog(dialog: AlertDialog) {
        val window = dialog.window ?: return
        BobFullscreen.attach(window)
        background(window.decorView)
        // This is an app-owned approval dialog, not an arbitrary Activity or document tree.
        fun style(view: View) {
            when (view) { is Button -> button(view); is TextView -> text(view) }
            if (view is ViewGroup) for (index in 0 until view.childCount) style(view.getChildAt(index))
        }
        style(window.decorView)
        dialog.setOnDismissListener { BobFullscreen.detach(window) }
    }
    private fun refresh() {
        views.entries.toList().forEach { (view, roles) -> roles.forEach { apply(view, it) } }
        listeners.keys.toList().forEach { it.applyAppearance() }
        BobFullscreen.refreshAppearance()
    }
    fun install(application: Application) {
        application.registerComponentCallbacks(object : ComponentCallbacks {
            override fun onConfigurationChanged(newConfig: Configuration) { refresh() }
            override fun onLowMemory() {}
        })
    }
}
