package com.bobmobile

import android.content.Context
import androidx.work.*
import com.google.android.gms.tasks.Tasks
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import okhttp3.ConnectionPool
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

/** Independent of transient polling watches and RemoteInput drafts. No tokens in
 * WorkManager Data or logs. Keychain remains the foreground pairing authority. */
internal object BobPushStore : EncryptedNotificationStore("push-registrations-encrypted-v1")
internal object BobPush {
    fun activate(context: Context, identity: String, endpoint: String, credential: String) {
        if (!BuildConfig.BOB_PUSH_CONFIGURED) return
        synchronized(BobPushStore) {
            val prior = BobPushStore.read(context, identity)
            val changed = prior == null || !prior.optBoolean("paired") || ConversationNotificationPolicy.changedPairing(prior.optString("endpoint"), prior.optString("token"), endpoint, credential)
            BobPushStore.update(context, identity) {
                it.put("endpoint", endpoint).put("token", credential).put("paired", true)
                if (changed) it.put("revision", UUID.randomUUID().toString()).put("registered", false)
            }
            schedule(context, identity)
        }
    }
    fun schedule(context: Context, identity: String) {
        if (!BuildConfig.BOB_PUSH_CONFIGURED) return
        val request = OneTimeWorkRequestBuilder<BobPushRegistrationWorker>()
            .setInputData(Data.Builder().putString("identity", identity).build())
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
        // Do not cancel an in-flight HTTP mutation and race its replacement. Each
        // worker reads the latest encrypted pairing/token when its turn begins.
        WorkManager.getInstance(context).enqueueUniqueWork("bob-push:$identity", ExistingWorkPolicy.APPEND_OR_REPLACE, request)
    }
    fun refresh(context: Context) {
        if (!BuildConfig.BOB_PUSH_CONFIGURED) return
        // The SDK durably owns the current FCM token. Workers obtain its latest
        // value instead of racing callbacks with an obsolete plaintext copy.
        try { BobPushStore.identities(context).forEach { schedule(context, it) } } catch (_: Exception) {}
    }
    fun retainPaired(context: Context, identities: Set<String>) {
        synchronized(NotificationWatchStore) {
            synchronized(BobPushStore) {
                for (identity in BobPushStore.identities(context).filter { it !in identities }) {
                    BobPushStore.update(context, identity) {
                        it.put("paired", false).put("registered", false).put("revision", UUID.randomUUID().toString())
                    }
                    AttentionNotifications.clear(context)
                    schedule(context, identity) // Offline DELETE never grants local display permission.
                }
            }
        }
    }
    fun registered(context: Context): Set<String> = try {
        if (!BuildConfig.BOB_PUSH_CONFIGURED) emptySet() else BobPushStore.identities(context).filter { identity ->
            BobPushStore.read(context, identity)?.let { it.optBoolean("registered") && it.optBoolean("paired") } == true
        }.toSet()
    } catch (_: Exception) { emptySet() }

}

/** FCM data-only callback: no backend reads, content parsing, React startup or
 * blocking registration before rendering. Unknown/notification payloads ignored. */
class BobMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) { BobPush.refresh(applicationContext) }
    override fun onMessageReceived(message: RemoteMessage) {
        if (!BuildConfig.BOB_PUSH_CONFIGURED) return
        if (!AttentionNotificationPolicy.accepts(message.data, message.from, getString(R.string.gcm_defaultSenderId), message.notification != null, BobPush.registered(applicationContext))) return
        val identity = message.data.getValue("backendId")
        val sources = AttentionNotificationPolicy.sources(message.data.getValue("sources")) ?: return
        AttentionNotifications.post(applicationContext, { identity in BobPush.registered(applicationContext) }, sources = sources)
    }
}

/** Idempotent registration is safe to retry after ambiguous network failure. Uses
 * the same clean Tailscale origin, pinned backend UUID, platform TLS and explicit
 * redirect/replay prohibitions as the existing native paired transports. */
class BobPushRegistrationWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    @Volatile private var activeCall: okhttp3.Call? = null
    override fun onStopped() { activeCall?.cancel(); super.onStopped() }
    override fun doWork(): Result {
        if (!BuildConfig.BOB_PUSH_CONFIGURED) return Result.success()
        val identity = inputData.getString("identity") ?: return Result.failure()
        val value = BobPushStore.read(applicationContext, identity) ?: return Result.success()
        val revision = value.optString("revision")
        fun current() = !isStopped && BobPushStore.read(applicationContext, identity)?.optString("revision") == revision
        // Bound each registration cycle; later activation/token refresh can start
        // another one without an old failed prerequisite blocking the chain.
        fun retry() = if (isStopped || runAttemptCount >= 4) Result.success() else Result.retry()
        try {
            UUID.fromString(identity)
            val endpoint = PhoneLocationPolicy.endpoint(value.getString("endpoint"), BuildConfig.DEBUG)
            val credential = value.getString("token"); require(credential.matches(Regex("[A-Za-z0-9_-]{32,128}")))
            val enabled = value.optBoolean("paired") && AttentionNotifications.enabled(applicationContext)
            val token = if (enabled) Tasks.await(FirebaseMessaging.getInstance().token, 20, TimeUnit.SECONDS) else null
            if (!current()) return Result.success()
            val request = Request.Builder().url("$endpoint/v1/push/register")
                .header("Authorization", "Bearer $credential").header("x-bob-backend", identity).header("Accept", "application/json")
            if (token != null) request.post(JSONObject().put("token", token).toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
            else request.delete()
            val call = client.newCall(request.build()); activeCall = call
            if (!current()) { call.cancel(); return Result.success() }
            call.execute().use { response ->
                if (response.code in listOf(401, 403, 409)) {
                    BobPushStore.ifCurrent(applicationContext, identity, revision) { BobPushStore.update(applicationContext, identity) { it.put("registered", false) } }
                    return Result.success() // Fresh pairing/activation is required; never spin on revoked credentials.
                }
                if (response.code == 404 || response.code == 405) return Result.success() // Old backend; retry on activation/refresh.
                if (response.code == 429 || response.code >= 500) return retry()
                if (!response.isSuccessful) return Result.failure()
                if (token != null) {
                    val body = response.body ?: return retry()
                    val bytes = body.byteStream().use { input ->
                        val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(1024)
                        while (true) { val n = input.read(buffer); if (n < 0) break; require(output.size() + n <= 4096); output.write(buffer, 0, n) }
                        output.toByteArray()
                    }
                    require(bytes.size <= 4096 && JSONObject(String(bytes, Charsets.UTF_8)).optBoolean("registered"))
                }
                BobPushStore.ifCurrent(applicationContext, identity, revision) {
                    if (!isStopped) {
                        if (!value.optBoolean("paired")) BobPushStore.remove(applicationContext, identity)
                        else BobPushStore.update(applicationContext, identity) { it.put("registered", token != null) }
                    }
                }
                return Result.success()
            }
        } catch (_: Exception) { return retry() }
        finally { activeCall = null }
    }
    companion object {
        private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
            .connectionPool(ConnectionPool(0, 1, TimeUnit.SECONDS)).connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS).writeTimeout(15, TimeUnit.SECONDS).callTimeout(25, TimeUnit.SECONDS).build()
    }
}
