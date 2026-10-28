package com.bobmobile

import android.app.Activity
import android.os.Bundle
import android.widget.FrameLayout
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class InlineProbeActivity : Activity() {
    lateinit var container: FrameLayout
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        container = FrameLayout(this)
        ViewCompat.setOnApplyWindowInsetsListener(container) { view, insets ->
            val safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
            insets
        }
        setContentView(container)
    }
}
