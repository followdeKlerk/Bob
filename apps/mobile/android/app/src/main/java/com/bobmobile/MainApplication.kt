package com.bobmobile

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.modules.network.OkHttpClientProvider

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          add(BobPlatformPackage())
          add(BobOutboxPackage())
        },
    )
  }

  override fun onTrimMemory(level: Int) {
    RuntimeDiagnostics.pressure(this, level)
    super.onTrimMemory(level)
  }
  @Suppress("DEPRECATION")
  override fun onLowMemory() {
    RuntimeDiagnostics.pressure(this, 100)
    super.onLowMemory()
  }
  override fun onCreate() {
    super.onCreate()
    com.facebook.react.common.assets.ReactFontManager.getInstance().addCustomFont(this, "Nordwand Mono", R.font.nordwand_mono)
    CrashDiagnostics.install(this)
    BobFullscreen.install(this)
    // Pairing, authenticated fetch and SSE must never forward credentials through a redirect or replay a mutation.
    OkHttpClientProvider.setOkHttpClientFactory {
      OkHttpClientProvider.createClientBuilder().followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
        // Do not reuse server-expired idle sockets when automatic mutation retry is intentionally off.
        .connectionPool(okhttp3.ConnectionPool(0, 1, java.util.concurrent.TimeUnit.SECONDS))
        .eventListener(object : okhttp3.EventListener() {
          override fun callFailed(call: okhttp3.Call, ioe: java.io.IOException) {
            if (BuildConfig.DEBUG) android.util.Log.w("BobNetwork", "${ioe.javaClass.simpleName}: ${ioe.message?.take(200)}")
          }
        }).build()
    }
    loadReactNative(this)
  }
}
