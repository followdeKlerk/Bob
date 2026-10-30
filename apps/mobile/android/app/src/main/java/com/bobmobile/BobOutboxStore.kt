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

/** App-private delivery intent, not backend chat authority. Full items, credentials and
 * receipts are authenticated/encrypted; WorkManager receives only the request UUID.
 * AtomicFile.finishWrite fsyncs before publication. Unreadable records fail closed rather
 * than becoming an empty queue that might blindly resend an already admitted message. */
internal object BobOutboxStore {
    private const val ALIAS = "bob-outbox-v1"
    private const val MAX_RECORD_BYTES = 16 * 1048576
    private fun directory(context: Context) = File(context.noBackupFilesDir, "bob-outbox-v1").apply {
        check(isDirectory || mkdirs())
    }
    private fun file(context: Context, id: String) = AtomicFile(File(directory(context), BobOutboxPolicy.identity(id) + ".json"))
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    @Synchronized fun ids(context: Context): List<String> = directory(context).listFiles().orEmpty().mapNotNull {
        // Include interrupted AtomicFile writes so read() can perform its normal recovery.
        val name = it.name.removeSuffix(".bak").removeSuffix(".new")
        if (name.endsWith(".json")) name.removeSuffix(".json").takeIf { id -> runCatching { BobOutboxPolicy.identity(id) }.isSuccess } else null
    }.distinct()
    @Synchronized fun read(context: Context, id: String): JSONObject? {
        val source = file(context, id)
        if (!source.baseFile.exists() && !File(source.baseFile.path + ".bak").exists()) return null
        val raw = source.openRead().use { input ->
            val output = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            while (true) {
                val n = input.read(buffer); if (n < 0) break
                check(output.size() + n <= MAX_RECORD_BYTES); output.write(buffer, 0, n)
            }
            JSONObject(output.toString("UTF-8"))
        }
        val box = NotificationCipher.Box(Base64.decode(raw.getString("iv"), Base64.NO_WRAP), Base64.decode(raw.getString("data"), Base64.NO_WRAP))
        val value = JSONObject(String(NotificationCipher.decrypt("outbox-v1:$id", box, key()), Charsets.UTF_8))
        check(value.getString("requestId") == id)
        return value
    }
    @Synchronized fun write(context: Context, value: JSONObject) {
        val id = value.getString("requestId")
        val bytes = value.toString().toByteArray(Charsets.UTF_8)
        check(bytes.size <= MAX_RECORD_BYTES / 2)
        val box = NotificationCipher.encrypt("outbox-v1:$id", bytes, key())
        val encoded = JSONObject().put("iv", Base64.encodeToString(box.iv, Base64.NO_WRAP))
            .put("data", Base64.encodeToString(box.ciphertext, Base64.NO_WRAP)).toString().toByteArray(Charsets.UTF_8)
        val target = file(context, id)
        val stream = target.startWrite()
        try {
            stream.write(encoded)
            // AtomicFile logs some sync/rename failures rather than throwing. Make
            // the Promise's persistence barrier explicit and verify publication.
            stream.fd.sync()
            target.finishWrite(stream)
            check(target.baseFile.readBytes().contentEquals(encoded))
        } catch (error: Exception) { target.failWrite(stream); throw error }
    }
    @Synchronized fun all(context: Context): List<JSONObject> = ids(context).mapNotNull { read(context, it) }.sortedBy { it.getLong("order") }
    @Synchronized fun remove(context: Context, id: String) { file(context, id).delete(); check(!file(context, id).baseFile.exists()) }
}
