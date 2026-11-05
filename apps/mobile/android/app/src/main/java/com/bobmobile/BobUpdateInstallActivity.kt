package com.bobmobile

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.FileProvider
import java.io.File

/** Direct notification destination, not a service/broadcast notification trampoline. */
class BobUpdateInstallActivity : Activity() {
    private var resumed = false
    private var verified: File? = null
    private var launched = false
    private lateinit var message: TextView
    private lateinit var install: Button
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        message = TextView(this).apply { text = "Checking the downloaded Bob update…"; textSize = 18f }
        install = Button(this).apply { text = "Install"; isEnabled = false; setOnClickListener { openInstaller() } }
        setContentView(LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(32, 48, 32, 32); addView(message); addView(install) })
        val sha = intent.getStringExtra("sha") ?: ""
        Thread({
            try {
                require(Regex("^[a-f0-9]{64}$").matches(sha))
                val file = UpdateDownloads.installFile(this, sha)
                runOnUiThread {
                    if (!isFinishing && !isDestroyed) {
                        verified = file; install.isEnabled = true
                        message.text = "Update verified. Android will ask you to confirm installation."
                        if (resumed) openInstaller()
                    }
                }
            } catch (_: Exception) {
                runOnUiThread { message.text = "This update is unavailable, expired, already installed, or failed verification. Return to Bob to check for an update." }
            }
        }, "bob-update-install-check").start()
    }
    override fun onResume() { super.onResume(); resumed = true }
    override fun onPause() { resumed = false; super.onPause() }
    private fun openInstaller() {
        // No application-context launch: only this explicitly opened, resumed Activity may install.
        if (!resumed || isFinishing || isDestroyed || launched) return
        val file = verified ?: return
        try {
            if (Build.VERSION.SDK_INT >= 26 && !packageManager.canRequestPackageInstalls()) {
                message.text = "Allow updates from Bob in Android Settings, then return and tap Install."
                startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
                return
            }
            val uri = FileProvider.getUriForFile(this, "$packageName.files", file)
            startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
            launched = true
            message.text = "Approve installation in Android. If you cancel, return to Bob and tap Install again."
            finish()
        } catch (_: Exception) { message.text = "Android could not open the installer. Return to Bob and tap Install again." }
    }
}
