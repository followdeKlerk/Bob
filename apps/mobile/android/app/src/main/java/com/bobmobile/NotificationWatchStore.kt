package com.bobmobile

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/** Private notification scheduling metadata, NOT chat/delivery authority.
 * Workers need a credential after process death: encrypt it with an app-owned
 * Android Keystore key; neither WorkManager Data nor preferences contain plaintext tokens. */
internal object NotificationWatchStore {
    private const val alias = "bob-notification-watches-v1"
    private fun prefs(context: Context) = context.getSharedPreferences("notification-watches-encrypted-v1", Context.MODE_PRIVATE)
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    @Synchronized fun read(context: Context, identity: String): JSONObject? {
        val raw = prefs(context).getString(identity, null) ?: return null
        return try {
            require(raw.length <= 131072)
            val pieces = raw.split(':'); require(pieces.size == 2)
            val box = NotificationCipher.Box(Base64.decode(pieces[0], Base64.NO_WRAP), Base64.decode(pieces[1], Base64.NO_WRAP))
            JSONObject(String(NotificationCipher.decrypt(identity, box, key()), Charsets.UTF_8))
        } catch (_: Exception) { null } // Fail closed; foreground registration can restore from Keychain.
    }
    @Synchronized fun update(context: Context, identity: String, mutate: (JSONObject) -> Unit): JSONObject {
        val value = read(context, identity) ?: JSONObject().put("work", JSONObject())
        mutate(value)
        val box = NotificationCipher.encrypt(identity, value.toString().toByteArray(Charsets.UTF_8), key())
        // Publish synchronously before scheduling a worker in another thread/process lifetime.
        require(prefs(context).edit().putString(identity, Base64.encodeToString(box.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(box.ciphertext, Base64.NO_WRAP)).commit())
        return value
    }
    @Synchronized fun remove(context: Context, identity: String) { prefs(context).edit().remove(identity).commit() }
    @Synchronized fun identities(context: Context): List<String> = prefs(context).all.keys.toList()
    @Synchronized fun ifCurrent(context: Context, identity: String, revision: String, action: () -> Unit) {
        if (read(context, identity)?.optString("revision") == revision) action()
    }
}

internal object NotificationSchedulePolicy {
    fun needsRetry(hasWork: Boolean, activeBuild: Boolean) = hasWork || activeBuild
    fun activeStatus(status: String) = status == "queued" || status == "running" || status == "building"
}
