package com.bobmobile

import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.view.Surface
import java.net.URI
import java.util.concurrent.atomic.AtomicBoolean

internal data class MediaPlaybackSnapshot(
    val phase: String = "connecting", val position: Int = 0, val duration: Int = 0,
    val paused: Boolean = true, val videoReady: Boolean = false
)

/** All codec calls share one serial worker, never the UI thread. setDataSource can perform
 * synchronous extractor reads even when prepareAsync is used. Cancellation closes transport
 * immediately, without waiting for that worker or a codec release to finish. */
internal class BobMediaSession(
    uri: URI, token: String, identity: String, size: Long,
    private val initialPosition: Int, private val initialPaused: Boolean,
    private val attributes: AudioAttributes,
    private val state: (MediaPlaybackSnapshot) -> Unit,
    private val ended: (String?, Boolean) -> Unit,
    private val dimensions: (Int, Int) -> Unit,
    transfer: (Long) -> Unit
) : AutoCloseable {
    companion object {
        private val worker by lazy {
            Handler(HandlerThread("BobMediaCodec").apply { start() }.looper)
        }
    }
    private val closed = AtomicBoolean(false)
    private val transport = BobMediaTransport(uri, token, identity, size, transfer = { count, _ -> transfer(count) })
    private val source = BobMediaSource(transport)
    // The fields below belong exclusively to worker.
    private var media: MediaPlayer? = null
    private var prepared = false
    private var seekPending = false
    private var resumeSeek = false
    private var buffering = false
    private var videoReady = false
    private var desiredPaused = initialPaused
    private var lastPosition = initialPosition
    private var lastAdvance = 0L

    fun failureMessage(): String? = transport.failure?.message
    private fun publish(phase: String? = null) {
        if (closed.get()) return
        val selected = media
        val position = if (prepared && !resumeSeek) selected?.currentPosition?.coerceAtLeast(0) ?: lastPosition else lastPosition
        val duration = if (prepared) selected?.duration?.coerceAtLeast(0) ?: 0 else 0
        val playing = prepared && selected?.isPlaying == true
        state(MediaPlaybackSnapshot(phase ?: when {
            !prepared -> "loading"
            seekPending -> "seeking"
            buffering -> "buffering"
            playing -> "playing"
            else -> "paused"
        }, position, duration, if (!prepared || resumeSeek) desiredPaused else !playing, videoReady))
    }
    private val tick = object : Runnable {
        override fun run() {
            if (closed.get()) return
            try {
                val selected = media ?: return
                if (prepared) {
                    val position = selected.currentPosition.coerceAtLeast(0)
                    val now = SystemClock.elapsedRealtime()
                    if (position != lastPosition) { lastAdvance = now; if (!seekPending) buffering = false }
                    // MediaDataSource does not guarantee MEDIA_INFO_BUFFERING callbacks. A
                    // stopped playback clock is evidence of waiting, not successful streaming.
                    if (selected.isPlaying && !seekPending && now - lastAdvance >= 3000) buffering = true
                    if (!selected.isPlaying) lastAdvance = now
                    // A slow initial seek must retain the requested handoff point. Android
                    // can report the old clock until onSeekComplete acknowledges the target.
                    if (!resumeSeek) lastPosition = position
                    publish()
                }
            } catch (_: Exception) { fail("Playback stopped unexpectedly. Retry, or use Open / Save."); return }
            worker.postDelayed(this, 500)
        }
    }
    fun start(surface: Surface?) {
        worker.post {
            if (closed.get()) return@post
            try {
                val selected = MediaPlayer()
                media = selected
                selected.setAudioAttributes(attributes)
                selected.setOnPreparedListener {
                    if (closed.get() || media !== it) return@setOnPreparedListener
                    try {
                        prepared = true
                        val target = MediaPlaybackPolicy.seek(initialPosition, it.duration)
                        if (target > 0) { resumeSeek = true; seekPending = true; publish("seeking"); seekTo(it, target) }
                        else completePreparation(it)
                    } catch (_: Exception) { fail("Cannot start this media. Retry, or use Open / Save.") }
                }
                selected.setOnVideoSizeChangedListener { _, width, height -> if (!closed.get()) dimensions(width, height) }
                selected.setOnSeekCompleteListener {
                    if (!closed.get() && media === it) try {
                        seekPending = false; buffering = false; lastAdvance = SystemClock.elapsedRealtime()
                        if (resumeSeek) { resumeSeek = false; completePreparation(it) } else publish()
                    } catch (_: Exception) { fail("Cannot finish seeking. Retry, or use Open / Save.") }
                }
                selected.setOnInfoListener { _, what, _ ->
                    if (!closed.get()) try {
                        when (what) {
                            MediaPlayer.MEDIA_INFO_BUFFERING_START -> { buffering = true; publish() }
                            MediaPlayer.MEDIA_INFO_BUFFERING_END -> { buffering = false; lastAdvance = SystemClock.elapsedRealtime(); publish() }
                            MediaPlayer.MEDIA_INFO_VIDEO_RENDERING_START -> { videoReady = true; publish() }
                        }
                    } catch (_: Exception) { fail("Playback stopped unexpectedly. Retry, or use Open / Save.") }
                    false
                }
                selected.setOnCompletionListener { if (!closed.get()) finish(null, true) }
                selected.setOnErrorListener { _, _, _ ->
                    fail(failureMessage() ?: "This media could not be decoded. Try Open to use another player, or Save the file.")
                    true
                }
                publish("connecting")
                selected.setDataSource(source)
                if (closed.get()) { release(); return@post }
                selected.setSurface(surface)
                publish("loading")
                selected.prepareAsync()
                worker.postDelayed(tick, 500)
            } catch (_: Exception) { fail(failureMessage() ?: "Cannot open this media stream. Check the connection and retry.") }
        }
    }
    private fun completePreparation(selected: MediaPlayer) {
        if (closed.get() || media !== selected) return
        buffering = false; lastAdvance = SystemClock.elapsedRealtime()
        if (!desiredPaused) selected.start()
        publish()
    }
    fun surface(value: Surface?) {
        worker.post {
            if (!closed.get()) try { media?.setSurface(value) }
            catch (_: Exception) { fail("Video output is unavailable. Retry, or use Open / Save.") }
        }
    }
    fun command(action: String, position: Int = 0) {
        worker.post {
            if (closed.get()) return@post
            val selected = media ?: return@post
            try {
                when (action) {
                    "play", "pause" -> {
                        desiredPaused = action == "pause"
                        // Prepared-but-not-started is not a valid pause() state. Preserve
                        // intent during the initial seek, then apply it exactly once.
                        if (prepared && !resumeSeek) {
                            if (desiredPaused) { if (selected.isPlaying) selected.pause(); buffering = false }
                            else { selected.start(); lastAdvance = SystemClock.elapsedRealtime() }
                        }
                    }
                    "seek" -> {
                        if (!prepared || seekPending) return@post
                        seekPending = true; buffering = false
                        seekTo(selected, MediaPlaybackPolicy.seek(position, selected.duration))
                    }
                    else -> return@post
                }
                publish()
            } catch (_: Exception) { fail("Cannot change playback. Retry, or use Open / Save.") }
        }
    }
    private fun seekTo(selected: MediaPlayer, position: Int) {
        if (Build.VERSION.SDK_INT >= 26) selected.seekTo(position.toLong(), MediaPlayer.SEEK_CLOSEST)
        else selected.seekTo(position)
    }
    private fun fail(message: String) = finish(message, false)
    private fun finish(message: String?, completed: Boolean) {
        if (!closed.compareAndSet(false, true)) return
        transport.close(); ended(message, completed); release()
    }
    private fun release() {
        worker.removeCallbacks(tick)
        val selected = media; media = null; prepared = false
        try { selected?.release() } catch (_: Exception) {}
    }
    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        transport.close()
        worker.post { release() }
    }
}
