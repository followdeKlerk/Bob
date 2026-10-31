package com.bobmobile

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/** Short-lived encrypted RemoteInput drafts, NOT delivery authority. Persist the exact
 * first input before enqueue so disk/WorkManager failures can retry the same UUID/text.
 * Kept outside the small watch record (whose read budget is only 128 KiB). */
internal object NotificationReplyStore {
    private const val ALIAS = "bob-notification-reply-v1"
    private fun file(context: Context, id: String): AtomicFile {
        val dir = File(context.noBackupFilesDir, ALIAS).apply { check(isDirectory || mkdirs()) }
        return AtomicFile(File(dir, BobOutboxPolicy.identity(id) + ".json"))
    }
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    @Synchronized fun read(context: Context, id: String): JSONObject? {
        val source = file(context, id)
        if (!source.baseFile.exists() && !File(source.baseFile.path + ".bak").exists()) return null
        val bytes = source.openRead().use { input ->
            val out = java.io.ByteArrayOutputStream(); val buffer = ByteArray(8192)
            while (true) { val n = input.read(buffer); if (n < 0) break; check(out.size() + n <= NotificationReplyPolicy.MAX_DRAFT_ENCODED_BYTES); out.write(buffer, 0, n) }
            out.toByteArray()
        }
        val raw = JSONObject(String(bytes, Charsets.UTF_8))
        val box = NotificationCipher.Box(Base64.decode(raw.getString("iv"), Base64.NO_WRAP), Base64.decode(raw.getString("data"), Base64.NO_WRAP))
        val plaintext = NotificationCipher.decrypt("reply-v1:$id", box, key())
        check(plaintext.size <= NotificationReplyPolicy.MAX_DRAFT_PLAINTEXT_BYTES)
        return JSONObject(String(plaintext, Charsets.UTF_8)).also {
            check(it.getString("requestId") == id)
        }
    }
    @Synchronized fun write(context: Context, value: JSONObject) {
        val id = value.getString("requestId"); val bytes = value.toString().toByteArray(Charsets.UTF_8)
        check(bytes.size <= NotificationReplyPolicy.MAX_DRAFT_PLAINTEXT_BYTES)
        val box = NotificationCipher.encrypt("reply-v1:$id", bytes, key())
        val encoded = JSONObject().put("iv", Base64.encodeToString(box.iv, Base64.NO_WRAP))
            .put("data", Base64.encodeToString(box.ciphertext, Base64.NO_WRAP)).toString().toByteArray(Charsets.UTF_8)
        // The publication bound is identical to read's encrypted-envelope budget.
        check(encoded.size <= NotificationReplyPolicy.MAX_DRAFT_ENCODED_BYTES)
        val target = file(context, id); val stream = target.startWrite()
        try {
            stream.write(encoded); stream.fd.sync(); target.finishWrite(stream)
            check(target.baseFile.readBytes().contentEquals(encoded))
        } catch (error: Exception) { target.failWrite(stream); throw error }
    }
    @Synchronized fun remove(context: Context, id: String) { file(context, id).delete() }
}
