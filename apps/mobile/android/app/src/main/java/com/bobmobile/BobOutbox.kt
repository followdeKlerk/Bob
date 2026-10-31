package com.bobmobile

import android.content.Context
import android.os.Build
import androidx.work.*
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.lang.ref.WeakReference
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

internal object BobOutboxRuntime {
    val io = Executors.newSingleThreadExecutor()
    @Volatile private var react = WeakReference<ReactApplicationContext>(null)
    @Synchronized fun bind(context: ReactApplicationContext) { react = WeakReference(context) }
    @Synchronized fun unbind(context: ReactApplicationContext) { if (react.get() === context) react.clear() }
    fun changed() {
        val context = react.get() ?: return
        if (!context.hasActiveReactInstance()) return
        try {
            context.runOnJSQueueThread {
                try {
                    if (context.hasActiveReactInstance()) context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                        .emit("BobOutboxChanged", null) // No content, credentials, endpoint or pairing fingerprint.
                } catch (_: Exception) { /* Resume recovery is the fallback. */ }
            }
        } catch (_: Exception) { /* Never start React to announce native work. */ }
    }
    private val locks = Array(64) { Any() }
    private val chatLocks = Array(64) { Any() }
    fun lock(id: String) = locks[(id.hashCode() and Int.MAX_VALUE) % locks.size]
    fun chatLock(identity: String, chat: Long) = chatLocks[("$identity:$chat".hashCode() and Int.MAX_VALUE) % chatLocks.size]
    fun workName(id: String) = "bob-outbox:$id"
    fun schedule(context: Context, id: String) {
        val builder = OneTimeWorkRequestBuilder<BobOutboxWorker>()
            .setInputData(Data.Builder().putString("requestId", id).build())
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
        // On older Android expedited work requires a foreground service. Do not start one.
        if (Build.VERSION.SDK_INT >= 31) builder.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
        WorkManager.getInstance(context).enqueueUniqueWork(workName(id), ExistingWorkPolicy.KEEP, builder.build()).result.get()
    }
    fun needsWork(value: JSONObject) = value.getString("state") == "pending" ||
        (value.getString("state") == "admitted" && (!value.getJSONObject("admission").has("entry") || !value.optBoolean("watchAttempted")) && !value.optBoolean("pollStopped"))
    fun recover(context: Context) {
        // A crash between encrypted persistence and the WorkManager transaction must not
        // strand an intent. KEEP also preserves the retry schedule of an existing worker.
        for (id in BobOutboxStore.ids(context)) try {
            synchronized(lock(id)) { BobOutboxStore.read(context, id)?.let { if (needsWork(it)) schedule(context, id) } }
        } catch (_: Exception) { /* Surface unreadable data via list/status; never log secrets. */ }
    }
    /** Shared native persistence + scheduling barrier. Call on io, never the main thread. */
    fun enqueue(context: Context, endpoint: String, backendId: String, credential: String, chat: Double, requestId: String,
                messageJson: String, filesJson: String, itemJson: String, retry: Boolean, notificationPairing: Pair<String, String>? = null): String {
        val origin: String
        val chatId: Long
        val message: JSONObject
        try {
            // Reject before any native persistence: the existing JS attachment pipeline
            // owns staging/upload/cleanup and can safely retain this unsupported send.
            require(filesJson.length <= BobOutboxPolicy.MAX_ITEM_BYTES)
            if (JSONArray(filesJson).length() != 0) throw OutboxInputError("outbox_files_unsupported", "Attachments require the foreground upload queue")
            origin = PhoneLocationPolicy.endpoint(endpoint, BuildConfig.DEBUG)
            BobOutboxPolicy.identity(backendId); BobOutboxPolicy.identity(requestId)
            require(credential.matches(Regex("[A-Za-z0-9_-]{32,128}")))
            chatId = BobOutboxPolicy.chat(chat)
            require(messageJson.toByteArray(Charsets.UTF_8).size <= BobOutboxPolicy.MAX_MESSAGE_BYTES)
            require(itemJson.toByteArray(Charsets.UTF_8).size <= BobOutboxPolicy.MAX_ITEM_BYTES)
            message = JSONObject(messageJson)
            require(message.getString("requestId") == requestId)
            val item = JSONObject(itemJson)
            require(item.getString("id") == requestId && item.getDouble("chat") == chat)
            require(item.getJSONObject("backend").getString("backendId") == backendId)
            require(item.getJSONArray("files").length() == 0)
            require(canonical(item.getJSONObject("message")) == canonical(message))
        } catch (error: OutboxInputError) { throw error }
        catch (_: Exception) { throw OutboxInputError("outbox_invalid", "Invalid native outbox request") }
        return synchronized(BobOutboxRuntime.lock(requestId)) {
            var value = BobOutboxStore.read(context, requestId)
            if (value != null) {
                // Credentials identify the paired device whose request-id namespace the
                // server uses. Never silently move an uncertain send to another pairing.
                if (value.getString("backendId") != backendId || value.getLong("chat") != chatId ||
                    value.getString("credential") != credential || canonical(JSONObject(value.getString("messageJson"))) != canonical(message)) {
                    throw OutboxInputError("outbox_conflict", "Request identity is already bound to a different send or pairing")
                }
                if (retry && (value.getString("state") == "rejected" || value.optBoolean("pollStopped"))) {
                    WorkManager.getInstance(context).cancelUniqueWork(BobOutboxRuntime.workName(requestId)).result.get()
                    value.put("state", if (value.has("admission")) "admitted" else "pending").put("attempts", 0).put("startedAt", System.currentTimeMillis())
                        .put("endpoint", origin).put("notBefore", 0)
                    value.remove("error"); value.remove("retryable"); value.remove("pollStopped")
                    BobOutboxStore.write(context, value)
                }
            } else synchronized(BobOutboxStore) {
                if (JSONObject(itemJson).optBoolean("notificationReply") && notificationPairing == null) {
                    throw OutboxInputError("outbox_reply_receipt", "Native reply receipt unavailable; reconcile this request before retrying")
                }
                val records = BobOutboxStore.all(context)
                if (records.size >= BobOutboxPolicy.MAX_RECORDS) throw OutboxInputError("outbox_full", "Native outbox is full; retain existing receipts until reflected in the transcript")
                value = JSONObject().put("requestId", requestId).put("backendId", backendId).put("endpoint", origin)
                    .put("credential", credential).put("chat", chatId).put("messageJson", messageJson).put("itemJson", itemJson)
                    .put("state", "pending").put("attempts", 0).put("startedAt", System.currentTimeMillis())
                    .put("order", (records.maxOfOrNull { it.getLong("order") } ?: 0L) + 1L)
                if (notificationPairing != null) value!!.put("notificationReply", true)
                    .put("replyEpoch", notificationPairing.first).put("replyFingerprint", notificationPairing.second)
                BobOutboxStore.write(context, value!!)
            }
            val saved = value!!
            if (notificationPairing != null) changed()
            if (BobOutboxRuntime.needsWork(saved)) BobOutboxRuntime.schedule(context, requestId)
            BobOutboxRuntime.status(saved)
        }
    }
    fun status(value: JSONObject): String = JSONObject().put("state", value.getString("state")).apply {
        value.optJSONObject("admission")?.let { put("admission", it) }
        if (value.has("error")) put("error", value.getString("error"))
        if (value.has("retryable")) put("retryable", value.getBoolean("retryable"))
        if (value.optBoolean("uncertain")) put("uncertain", true)
    }.toString()
}

/** Promise resolution is a disk + WorkManager write barrier, not server admission. */
class BobOutbox(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "BobOutbox"
    override fun initialize() {
        super.initialize(); BobOutboxRuntime.bind(context)
        BobOutboxRuntime.io.execute { BobOutboxRuntime.recover(context) }
    }
    override fun invalidate() { BobOutboxRuntime.unbind(context); super.invalidate() }
    private fun task(promise: Promise, action: () -> Any?) {
        BobOutboxRuntime.io.execute {
            try { promise.resolve(action()) }
            catch (error: OutboxInputError) { promise.reject(error.code, error.message) }
            catch (_: Exception) { promise.reject("outbox_storage", "Native outbox unavailable; reconcile this request identity before retrying") }
        }
    }
    @ReactMethod fun enqueue(endpoint: String, backendId: String, credential: String, chat: Double, requestId: String,
                             messageJson: String, filesJson: String, itemJson: String, retry: Boolean, promise: Promise) = task(promise) {
        BobOutboxRuntime.enqueue(context, endpoint, backendId, credential, chat, requestId, messageJson, filesJson, itemJson, retry)
    }
    /** Complete per-backend snapshot. Missing/malformed snapshots fail closed. */
    @ReactMethod fun setNotificationReplyBarriers(backendId: String, chats: ReadableArray, promise: Promise) = task(promise) {
        BobOutboxPolicy.identity(backendId)
        try {
            require(chats.size() <= 10000)
            val ids = (0 until chats.size()).map { BobOutboxPolicy.chat(chats.getDouble(it)) }
            NotificationReplyBarriers.replace(context, backendId, ids)
        } catch (_: Exception) {
            NotificationReplyBarriers.invalidate(context, backendId)
            throw OutboxInputError("outbox_barriers", "Unable to persist notification reply barriers; background replies remain blocked")
        }
        BobOutboxRuntime.recover(context)
        true
    }
    @ReactMethod fun status(requestId: String, promise: Promise) = task(promise) {
        BobOutboxPolicy.identity(requestId)
        synchronized(BobOutboxRuntime.lock(requestId)) { BobOutboxStore.read(context, requestId)?.let { BobOutboxRuntime.status(it) } }
    }
    @ReactMethod fun list(promise: Promise) = task(promise) {
        Arguments.createArray().apply { BobOutboxStore.all(context).forEach { pushString(it.getString("itemJson")) } }
    }
    @ReactMethod fun remove(requestId: String, promise: Promise) = task(promise) {
        BobOutboxPolicy.identity(requestId)
        synchronized(BobOutboxRuntime.lock(requestId)) {
            WorkManager.getInstance(context).cancelUniqueWork(BobOutboxRuntime.workName(requestId)).result.get()
            BobOutboxStore.remove(context, requestId)
            context.getSystemService(android.app.NotificationManager::class.java).cancel("reply-status:$requestId", 0)
            true
        }
    }
}

private class OutboxInputError(val code: String, message: String) : Exception(message)
private fun canonical(value: Any?): String = when (value) {
    is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(",", "{", "}") { JSONObject.quote(it) + ":" + canonical(value.get(it)) }
    is JSONArray -> (0 until value.length()).joinToString(",", "[", "]") { canonical(value.get(it)) }
    else -> JSONArray().put(value).toString().removeSurrounding("[", "]")
}
class BobOutboxPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(BobOutbox(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
