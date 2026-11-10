package com.bobmobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Rect
import android.graphics.SurfaceTexture
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Gravity
import android.view.Surface
import android.view.TextureView
import android.view.View
import android.view.ViewTreeObserver
import android.widget.FrameLayout
import android.widget.SeekBar
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.common.LifecycleState
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.Event
import java.lang.ref.WeakReference
import java.net.URI

private data class MediaRequest(val uri: URI, val token: String, val identity: String, val size: Long,
    val sessionId: String, val video: Boolean, val position: Int, val paused: Boolean)

private class MediaPlaybackEvent(surface: Int, view: Int, private val name: String, private val sessionId: String,
    private val snapshot: MediaPlaybackSnapshot, private val received: Long, private val message: String? = null,
    private val completed: Boolean = false) : Event<MediaPlaybackEvent>(surface, view) {
    override fun getEventName() = name
    override fun getEventData() = Arguments.createMap().apply {
        putString("sessionId", sessionId); putInt("positionMs", if (completed) 0 else snapshot.position)
        putInt("durationMs", snapshot.duration); putBoolean("paused", completed || snapshot.paused)
        putBoolean("buffering", snapshot.phase in listOf("connecting", "loading", "seeking", "buffering"))
        putString("phase", if (completed) "ended" else snapshot.phase)
        putBoolean("videoReady", snapshot.videoReady); putDouble("receivedBytes", received.toDouble())
        if (message != null) putString("message", message)
    }
    override fun canCoalesce() = name == "topProgress"
}

/** Native surface + accessible seek control only. React owns all themed labels/buttons.
 * A source prop is admission, not proof of a visible/laid-out window or successful playback. */
internal class BobMediaView(private val react: ThemedReactContext) : FrameLayout(react), LifecycleEventListener {
    companion object { private var current = WeakReference<BobMediaView>(null) }
    private val main = Handler(Looper.getMainLooper())
    private val audio = react.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var controller: BobMediaSession? = null
    private var pending: MediaRequest? = null
    private var observedTree: ViewTreeObserver? = null
    private val scrollObserver = ViewTreeObserver.OnScrollChangedListener { maybeStart() }
    private val layoutObserver = ViewTreeObserver.OnGlobalLayoutListener { maybeStart() }
    private var focus: AudioFocusRequest? = null
    private var receiverRegistered = false
    private var disposed = false
    private var admitted = false
    private var hadWindowFocus = false
    private var sessionId = ""
    private var commandSequence = 0
    private var sourceRevision = 0
    private var snapshot = MediaPlaybackSnapshot()
    private var receivedBytes = 0L
    private var lastAdvanceAt = 0L
    private var dragging = false
    private var video = false
    private var surface: Surface? = null
    private var videoWidth = 0
    private var videoHeight = 0
    // TextureView rejects backgrounds. Paint letterboxing on a normal parent instead.
    private val videoFrame = FrameLayout(react).apply { setBackgroundColor(Color.BLACK) }
    private val picture = TextureView(react)
    private val seek = SeekBar(react).apply {
        max = 1000; contentDescription = "Playback position, loading"; minimumHeight = dp(48)
        isEnabled = false; setPadding(dp(12), 0, dp(12), 0)
    }
    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        if (change != AudioManager.AUDIOFOCUS_GAIN) main.post { if (admitted) finish(null) }
    }
    private val noisy = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) finish(null)
        }
    }
    private val timeout = Runnable { finish(controller?.failureMessage() ?: "Playback is not responding. Retry, or use Open / Save.") }
    private val visibilityCheck = object : Runnable {
        override fun run() {
            if (!admitted || disposed) return
            if (controller != null && !visibleForPlayback()) { finish(null); return }
            // This clock runs on the UI looper, independently of a stalled codec/binder read.
            if (snapshot.phase == "playing" && SystemClock.elapsedRealtime() - lastAdvanceAt >= 3000) {
                snapshot = snapshot.copy(phase = "buffering")
                main.removeCallbacks(timeout); main.postDelayed(timeout, 30000)
                emit("topProgress")
            }
            main.postDelayed(this, 500)
        }
    }
    init {
        react.addLifecycleEventListener(this)
        videoFrame.addView(picture, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        addView(videoFrame, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT).apply { bottomMargin = dp(48) })
        addView(seek, LayoutParams(LayoutParams.MATCH_PARENT, dp(48), Gravity.BOTTOM))
        videoFrame.visibility = View.GONE
        // Safe startup defaults; the same React palette then tints every seek state explicitly.
        val initialColors = BobAppearance.palette(react)
        colors(initialColors.foreground, initialColors.background, initialColors.muted)
        seek.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onStartTrackingTouch(bar: SeekBar) { dragging = true }
            override fun onStopTrackingTouch(bar: SeekBar) { dragging = false; seekTo(bar.progress) }
            override fun onProgressChanged(bar: SeekBar, progress: Int, fromUser: Boolean) {
                if (fromUser) {
                    bar.contentDescription = "Playback position ${time((snapshot.duration.toLong() * progress / 1000).toInt())} of ${time(snapshot.duration)}"
                    // Keyboard / TalkBack adjustment has no touch start/end callback.
                    if (!dragging) seekTo(progress)
                }
            }
        })
        picture.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
            override fun onSurfaceTextureAvailable(texture: SurfaceTexture, width: Int, height: Int) {
                surface = Surface(texture); controller?.surface(surface); resizeVideo(); maybeStart()
            }
            override fun onSurfaceTextureSizeChanged(texture: SurfaceTexture, width: Int, height: Int) { resizeVideo() }
            override fun onSurfaceTextureUpdated(texture: SurfaceTexture) {}
            override fun onSurfaceTextureDestroyed(texture: SurfaceTexture): Boolean {
                if (video && admitted) finish(null)
                surface?.release(); surface = null; return true
            }
        }
    }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun time(value: Int): String = "%d:%02d".format(java.util.Locale.ROOT, value / 60000, value / 1000 % 60)
    private fun visibleForPlayback(): Boolean {
        if (!isAttachedToWindow || width <= 0 || height <= 0 || windowVisibility != View.VISIBLE || !hasWindowFocus() || react.reactApplicationContext.lifecycleState != LifecycleState.RESUMED) return false
        var ancestor: View? = this
        while (ancestor != null) {
            if (ancestor.visibility != View.VISIBLE || ancestor.alpha <= 0.01f) return false
            ancestor = ancestor.parent as? View
        }
        return getGlobalVisibleRect(Rect())
    }
    private fun resizeVideo() {
        if (videoWidth <= 0 || videoHeight <= 0 || picture.width <= 0 || picture.height <= 0) return
        val scale = minOf(picture.width.toFloat() / videoWidth, picture.height.toFloat() / videoHeight)
        val matrix = android.graphics.Matrix()
        matrix.setScale(videoWidth * scale / picture.width, videoHeight * scale / picture.height, picture.width / 2f, picture.height / 2f)
        picture.setTransform(matrix)
    }
    fun colors(foreground: Int, background: Int, muted: Int) {
        setBackgroundColor(background)
        val tint = ColorStateList(arrayOf(intArrayOf(-android.R.attr.state_enabled), intArrayOf()), intArrayOf(muted, foreground))
        seek.thumbTintList = tint; seek.progressTintList = tint
        seek.progressBackgroundTintList = ColorStateList.valueOf(muted)
        seek.secondaryProgressTintList = ColorStateList.valueOf(muted)
    }
    fun sizing(value: ReadableMap?) {
        // The native surface contains no text. React text wraps naturally outside it.
        if (value == null) return
        val height = value.getDouble("seekHeight")
        if (!height.isFinite() || height < 48 || height > 160) return
        val pixels = dp(kotlin.math.ceil(height).toInt())
        seek.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, pixels, Gravity.BOTTOM)
        videoFrame.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT).apply { bottomMargin = pixels }
        requestLayout()
    }
    fun start(config: ReadableMap?) {
        if (config == null || disposed) return
        val revision = ++sourceRevision
        try {
            val id = MediaPlaybackPolicy.session(config.getString("sessionId") ?: error("session"))
            if (admitted && sessionId == id) return
            release()
            sessionId = id; admitted = true; commandSequence = 0; receivedBytes = 0
            hadWindowFocus = hasWindowFocus()
            val token = config.getString("token") ?: error("credential")
            val identity = config.getString("identity") ?: error("identity")
            MediaRangePolicy.credentials(token, identity)
            val request = MediaRequest(
                MediaRangePolicy.url(config.getString("endpoint") ?: error("endpoint"), config.getString("conversation") ?: error("chat"), config.getString("artifact") ?: error("artifact"), BuildConfig.DEBUG),
                token, identity, MediaRangePolicy.size(config.getDouble("size")), id, config.getBoolean("video"),
                MediaPlaybackPolicy.position(config.getDouble("initialPositionMs")), config.getBoolean("initialPaused")
            )
            snapshot = MediaPlaybackSnapshot(position = request.position, paused = request.paused)
            // ThemedReactContext delegates listeners, NOT getLifecycleState(): its inherited
            // state remains BEFORE_CREATE. Read the actual application's lifecycle instead.
            if (react.reactApplicationContext.lifecycleState != LifecycleState.RESUMED) {
                main.post { if (sourceRevision == revision) finish("Keep Bob open, then tap Play again.") }
                return
            }
            video = request.video; videoFrame.visibility = if (video) View.VISIBLE else View.GONE
            pending = request
            observePendingVisibility()
            main.removeCallbacks(timeout); main.postDelayed(timeout, 30000)
            requestLayout()
            // Fabric applies props before native attachment/layout. Never treat that transient
            // state as the owner hiding the player, nor lose the terminal event before mounting.
            main.post { if (admitted && sessionId == id) { emit("topProgress"); maybeStart() } }
        } catch (_: Exception) { main.post { if (sourceRevision == revision) finish("Cannot authorize this media source. Check the paired connection and retry.") } }
    }
    private fun observePendingVisibility() {
        if (pending == null || !isAttachedToWindow || observedTree != null) return
        viewTreeObserver.takeIf { it.isAlive }?.let {
            observedTree = it
            it.addOnScrollChangedListener(scrollObserver); it.addOnGlobalLayoutListener(layoutObserver)
        }
    }
    private fun stopObservingVisibility() {
        observedTree?.takeIf { it.isAlive }?.let {
            it.removeOnScrollChangedListener(scrollObserver); it.removeOnGlobalLayoutListener(layoutObserver)
        }
        observedTree = null
    }
    @Suppress("DEPRECATION")
    private fun maybeStart() {
        val request = pending ?: return
        if (disposed || !admitted || !visibleForPlayback() || (video && surface == null)) return
        pending = null; stopObservingVisibility()
        try {
            current.get()?.takeIf { it !== this }?.finish(null)
            current = WeakReference(this)
            val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MOVIE).build()
            val granted = if (Build.VERSION.SDK_INT >= 26) {
                focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN).setAudioAttributes(attributes)
                    .setOnAudioFocusChangeListener(focusListener, main).setAcceptsDelayedFocusGain(false).build()
                audio.requestAudioFocus(focus!!)
            } else audio.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
            if (granted != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { finish("Another app is using audio. Pause it, then retry."); return }
            if (Build.VERSION.SDK_INT >= 33) react.registerReceiver(noisy, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), Context.RECEIVER_NOT_EXPORTED)
            else react.registerReceiver(noisy, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY))
            receiverRegistered = true
            lateinit var running: BobMediaSession
            running = BobMediaSession(request.uri, request.token, request.identity, request.size, request.position, request.paused, attributes,
                state = { next -> main.post { if (controller === running && admitted) update(next) } },
                ended = { message, completed -> main.post { if (controller === running && admitted) finish(message, completed) } },
                dimensions = { width, height -> main.post { if (controller === running && admitted) { videoWidth = width; videoHeight = height; resizeVideo() } } },
                transfer = { count -> main.post { if (controller === running && admitted) {
                    receivedBytes = maxOf(receivedBytes, count)
                    if (snapshot.phase == "connecting" && count > 0) snapshot = snapshot.copy(phase = "loading")
                    emit("topProgress")
                } } })
            controller = running
            running.start(surface)
            main.removeCallbacks(visibilityCheck); main.postDelayed(visibilityCheck, 500)
        } catch (_: Exception) { finish("Cannot start playback. Check the paired connection and retry.") }
    }
    private fun update(next: MediaPlaybackSnapshot) {
        val now = SystemClock.elapsedRealtime()
        if (next.position != snapshot.position || snapshot.phase !in listOf("playing", "buffering")) lastAdvanceAt = now
        val measured = if (next.phase == "playing" && now - lastAdvanceAt >= 3000) next.copy(phase = "buffering") else next
        if (snapshot.phase != measured.phase) {
            main.removeCallbacks(timeout)
            if (measured.phase in listOf("connecting", "loading", "seeking", "buffering")) main.postDelayed(timeout, 30000)
        }
        snapshot = measured
        seek.isEnabled = measured.duration > 0 && measured.phase !in listOf("connecting", "loading", "seeking")
        if (!dragging) {
            seek.progress = if (measured.duration > 0) (measured.position.toLong() * 1000 / measured.duration).toInt().coerceIn(0, 1000) else 0
            seek.contentDescription = "Playback position ${time(measured.position)} of ${time(measured.duration)}"
        }
        emit("topProgress")
    }
    fun command(value: ReadableMap?) {
        if (value == null || !admitted || disposed) return
        try {
            if (value.getString("sessionId") != sessionId) return
            val sequence = MediaPlaybackPolicy.position(value.getDouble("sequence"))
            if (sequence <= commandSequence) return
            val action = value.getString("action") ?: return
            if (action !in listOf("play", "pause", "seek")) return
            val position = if (action == "seek") MediaPlaybackPolicy.position(value.getDouble("positionMs")) else 0
            commandSequence = sequence
            controller?.command(action, position)
        } catch (_: Exception) { /* Invalid/stale commands cannot acquire a source or start a session. */ }
    }
    private fun seekTo(progress: Int) {
        if (!admitted || !seek.isEnabled || snapshot.duration <= 0) return
        controller?.command("seek", (snapshot.duration.toLong() * progress / 1000).toInt())
    }
    private fun emit(name: String, message: String? = null, completed: Boolean = false) {
        if (!admitted || sessionId.isEmpty() || id == View.NO_ID || !react.hasActiveReactInstance()) return
        UIManagerHelper.getEventDispatcher(react)?.dispatchEvent(MediaPlaybackEvent(UIManagerHelper.getSurfaceId(this), id,
            name, sessionId, snapshot, receivedBytes, message, completed))
    }
    private fun finish(message: String?, completed: Boolean = false) {
        if (!admitted) return
        emit("topStopped", message, completed)
        admitted = false; release()
    }
    @Suppress("DEPRECATION")
    private fun release() {
        main.removeCallbacks(timeout); main.removeCallbacks(visibilityCheck)
        pending = null; stopObservingVisibility()
        controller?.close(); controller = null
        seek.isEnabled = false; dragging = false
        try {
            if (Build.VERSION.SDK_INT >= 26) focus?.let { audio.abandonAudioFocusRequest(it) }
            else audio.abandonAudioFocus(focusListener)
        } catch (_: Exception) {}
        focus = null
        if (receiverRegistered) { try { react.unregisterReceiver(noisy) } catch (_: Exception) {}; receiverRegistered = false }
        if (current.get() === this) current.clear()
    }
    fun dispose() {
        disposed = true; admitted = false; release()
        surface?.release(); surface = null
        react.removeLifecycleEventListener(this)
    }
    override fun requestLayout() {
        super.requestLayout()
        post { if (!disposed && width > 0 && height > 0) {
            measure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY))
            layout(left, top, right, bottom)
        } }
    }
    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) { super.onLayout(changed, left, top, right, bottom); maybeStart() }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); observePendingVisibility(); main.post { if (hasWindowFocus()) hadWindowFocus = true; maybeStart() } }
    override fun onDetachedFromWindow() { finish(null); super.onDetachedFromWindow() }
    override fun onWindowVisibilityChanged(visibility: Int) { super.onWindowVisibilityChanged(visibility); if (visibility != View.VISIBLE && admitted) finish(null) else if (visibility == View.VISIBLE) main.post { maybeStart() } }
    override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
        super.onWindowFocusChanged(hasWindowFocus)
        if (!hasWindowFocus && admitted && hadWindowFocus) finish(null)
        else if (hasWindowFocus) { hadWindowFocus = true; maybeStart() }
    }
    override fun onHostResume() { maybeStart() }
    override fun onHostPause() { finish(null) }
    override fun onHostDestroy() { finish(null) }
}
