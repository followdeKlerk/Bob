package com.bobmobile

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.work.Worker
import androidx.work.WorkerParameters
import okhttp3.Call
import okhttp3.ConnectionPool
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

/** OS-owned, bounded reconciliation. No activity, React runtime, foreground service,
 * plaintext WorkManager payload, redirects, implicit mutation replay or TLS bypass. */
@androidx.annotation.Keep
class BobOutboxWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    @Volatile private var activeCall: Call? = null
    override fun onStopped() { activeCall?.cancel(); super.onStopped() }
    override fun doWork(): Result {
        val id = inputData.getString("requestId") ?: return Result.failure()
        try { BobOutboxPolicy.identity(id) } catch (_: Exception) { return Result.failure() }
        return synchronized(BobOutboxRuntime.lock(id)) {
            if (isStopped) return@synchronized Result.success()
            val value = try { BobOutboxStore.read(applicationContext, id) } catch (_: Exception) { return@synchronized Result.failure() }
                ?: return@synchronized Result.success()
            if (!BobOutboxRuntime.needsWork(value)) return@synchronized Result.success()
            synchronized(BobOutboxRuntime.chatLock(value.getString("backendId"), value.getLong("chat"))) {
                try { deliver(value) }
                catch (_: Exception) {
                    // A storage failure must never erase an uncertain send or be reported
                    // as a successful handoff. Startup recovery can reschedule this record.
                    Result.failure()
                }
            }
        }
    }
    private fun deliver(value: JSONObject): Result {
        if (isStopped) return Result.success()
        if (value.getString("state") == "pending") {
            notificationGate(value)?.let { return it }
            val blocked = BobOutboxStore.all(applicationContext).any {
                it.getString("backendId") == value.getString("backendId") && it.getLong("chat") == value.getLong("chat") &&
                    BobOutboxPolicy.blocks(it.getString("state"), it.getLong("order"), value.getLong("order"))
            }
            if (blocked) return Result.retry() // Waiting for FIFO is not a network attempt.
        }
        if (value.getString("state") == "admitted" && !value.optBoolean("watchAttempted")) watch(value)
        if (value.optJSONObject("admission")?.has("entry") == true) return Result.success()
        val now = System.currentTimeMillis()
        if (BobOutboxPolicy.exhausted(value.optInt("attempts"), value.getLong("startedAt"), now)) {
            return stop(value, "Background retry limit reached; reconcile or retry this same request", true)
        }
        if (now < value.optLong("notBefore", 0)) return Result.retry()
        value.put("attempts", value.optInt("attempts") + 1)
        BobOutboxStore.write(applicationContext, value)
        try {
            val identity = BobOutboxPolicy.identity(value.getString("backendId"))
            val id = BobOutboxPolicy.identity(value.getString("requestId"))
            val chat = BobOutboxPolicy.chat(value.getDouble("chat"))
            val origin = PhoneLocationPolicy.endpoint(value.getString("endpoint"), BuildConfig.DEBUG)
            require(value.getString("credential").matches(Regex("[A-Za-z0-9_-]{32,128}")))
            val operation = request(value, "$origin/v1/chats/$chat/operations/$id")
            var admission = operation.optJSONObject("admission")
            if (admission != null) validateAdmission(admission)
            else if (BobOutboxPolicy.mayPost(value.has("admission"), operation.has("admission"), operation.isNull("admission"))) {
                if (isStopped) return Result.success()
                notificationGate(value)?.let { return it }
                if (value.optBoolean("notificationReply") && (!operation.has("question") || !operation.isNull("question"))) {
                    return stop(value, "A question needs your answer or its state is unknown. Open Bob before retrying this reply.", false)
                }
                // Persist uncertainty BEFORE the mutation: process death after a server
                // commit still leaves the next worker obligated to GET this same UUID.
                value.put("uncertain", true)
                BobOutboxStore.write(applicationContext, value)
                admission = request(value, "$origin/v1/chats/$chat/messages", value.getString("messageJson"))
                validateAdmission(admission)
            } else if (!value.has("admission")) {
                throw java.io.IOException("Invalid reconciliation response")
            }
            if (admission != null) {
                value.put("state", "admitted").put("admission", admission).put("uncertain", false)
                value.remove("error"); value.remove("retryable"); value.remove("notBefore")
                BobOutboxStore.write(applicationContext, value) // Receipt precedes notifications.
                BobNotificationReply.reportOutbox(applicationContext, value)
                if (!value.optBoolean("watchAttempted")) watch(value)
                if (admission.has("entry")) return Result.success()
            }
            // An admission without an entry is already accepted. Only poll; never repost.
            return Result.retry()
        } catch (error: OutboxHttpError) {
            if (!BobOutboxPolicy.retryable(error.status)) {
                val message = when (error.status) {
                    401, 403, 409 -> "Pairing unavailable or backend identity changed; reconcile before retrying"
                    in 300..399 -> "Paired transport refused a redirect"
                    else -> "Backend refused this request (HTTP ${error.status})"
                }
                return stop(value, message, false)
            }
            error.retryAt?.let { value.put("notBefore", it) }
            value.put("error", "Backend temporarily unavailable; background reconciliation scheduled")
        } catch (_: Exception) {
            value.put("error", "Delivery not confirmed; background reconciliation scheduled")
        }
        if (BobOutboxPolicy.exhausted(value.optInt("attempts"), value.getLong("startedAt"), System.currentTimeMillis())) {
            return stop(value, "Background retry limit reached; reconcile or retry this same request", true)
        }
        BobOutboxStore.write(applicationContext, value)
        BobNotificationReply.reportOutbox(applicationContext, value)
        return if (isStopped) Result.success() else Result.retry()
    }
    private fun notificationGate(value: JSONObject): Result? {
        if (!value.optBoolean("notificationReply")) return null
        if (!BobNotificationReply.pairingCurrent(applicationContext, value)) {
            return stop(value, "Reply pairing changed or was revoked; open Bob to reconcile before retrying", false)
        }
        if (NotificationReplyBarriers.blocked(applicationContext, value.getString("backendId"), value.getLong("chat"))) {
            value.put("error", "Waiting for earlier foreground sends or attachment queue reconciliation")
            BobOutboxStore.write(applicationContext, value)
            return Result.retry() // No transport and no network-attempt budget consumed.
        }
        return null
    }
    private fun stop(value: JSONObject, message: String, retryable: Boolean): Result {
        // 'rejected' means native automation stopped, NOT proof that an uncertain POST
        // was rejected by the server. The explicit uncertain flag preserves that fact.
        if (value.has("admission")) value.put("state", "admitted").put("pollStopped", true)
        else value.put("state", "rejected")
        value.put("error", message).put("retryable", retryable)
        BobOutboxStore.write(applicationContext, value)
        BobNotificationReply.reportOutbox(applicationContext, value)
        return Result.success() // Terminal failure must not block later chat sends.
    }
    private fun validateAdmission(value: JSONObject) {
        require(value.opt("status") is String && value.getString("status").isNotBlank())
        if (value.has("entry")) {
            require(value.get("entry") is Number)
            BobOutboxPolicy.chat(value.getDouble("entry"))
        }
    }
    private fun request(value: JSONObject, url: String, body: String? = null): JSONObject {
        if (isStopped) throw java.io.InterruptedIOException()
        val request = Request.Builder().url(url).header("Authorization", "Bearer " + value.getString("credential"))
            .header("x-bob-backend", value.getString("backendId")).header("Accept", "application/json")
        if (body != null) request.post(body.toRequestBody("application/json; charset=utf-8".toMediaType()))
        val call = client.newCall(request.build()); activeCall = call
        try {
            if (isStopped) { call.cancel(); throw java.io.InterruptedIOException() }
            call.execute().use { response ->
                if (!response.isSuccessful) throw OutboxHttpError(response.code, retryAt(response.header("Retry-After")))
                require(if (body == null) response.code == 200 else response.code in 200..299)
                val input = requireNotNull(response.body).byteStream()
                val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(8192)
                while (true) {
                    val n = input.read(buffer); if (n < 0) break
                    require(output.size() + n <= 2097152); output.write(buffer, 0, n)
                }
                return JSONObject(output.toString("UTF-8"))
            }
        } finally { activeCall = null }
    }
    private fun retryAt(header: String?): Long? {
        if (header == null) return null
        val now = System.currentTimeMillis()
        val seconds = header.toDoubleOrNull()
        if (seconds != null && seconds.isFinite() && seconds >= 0) return now + (seconds * 1000).coerceAtMost(BobOutboxPolicy.MAX_AGE_MS.toDouble()).toLong()
        return try { java.text.SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss z", java.util.Locale.US).parse(header)?.time?.coerceIn(now, now + BobOutboxPolicy.MAX_AGE_MS) }
        catch (_: Exception) { null }
    }
    private fun watch(value: JSONObject) {
        try {
            val context = applicationContext
            val manager = context.getSystemService(NotificationManager::class.java)
            if (manager.areNotificationsEnabled() && (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)) {
                val identity = value.getString("backendId"); val chat = value.getLong("chat"); val request = value.getString("requestId")
                val key = "$identity:$chat:$request"
                synchronized(NotificationWatchStore) {
                    val existing = NotificationWatchStore.read(context, identity)
                    // An old accepted send keeps its original receipt identity, but must
                    // never revert the phone's newer pairing to watch that old receipt.
                    if (existing != null && ConversationNotificationPolicy.changedPairing(existing.optString("endpoint"), existing.optString("token"), value.getString("endpoint"), value.getString("credential"))) return@synchronized
                    if (!context.getSharedPreferences("bob-notification-receipts", Context.MODE_PRIVATE).getStringSet("settled", emptySet())!!.contains(key)) {
                        NotificationWatchStore.update(context, identity) { config ->
                            val work = config.optJSONObject("work") ?: JSONObject()
                            require(work.has(key) || work.length() < 32)
                            work.put(key, JSONObject().put("chat", chat).put("request", request))
                            config.put("endpoint", value.getString("endpoint")).put("token", value.getString("credential"))
                                .put("revision", UUID.randomUUID().toString()).put("work", work)
                        }
                        scheduleNotificationCheck(context, identity)
                    }
                }
            }
        } catch (_: Exception) { /* Notifications are best effort, never message authority. */ }
        value.put("watchAttempted", true)
        BobOutboxStore.write(applicationContext, value)
    }
    companion object {
        // Same narrow origin policy and standard platform TLS as BobFiles/notifications;
        // explicit OkHttp replay/redirect prohibitions match MainApplication's transport.
        private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
            .retryOnConnectionFailure(false).connectionPool(ConnectionPool(0, 1, TimeUnit.SECONDS))
            .connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS)
            .writeTimeout(15, TimeUnit.SECONDS).callTimeout(25, TimeUnit.SECONDS).build()
    }
}
private class OutboxHttpError(val status: Int, val retryAt: Long?) : Exception()
