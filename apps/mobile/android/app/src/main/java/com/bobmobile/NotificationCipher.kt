package com.bobmobile

import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Authenticated encryption, with each record bound to its paired backend identity. */
internal object NotificationCipher {
    data class Box(val iv: ByteArray, val ciphertext: ByteArray)
    fun encrypt(identity: String, plaintext: ByteArray, key: SecretKey): Box {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key); cipher.updateAAD(identity.toByteArray(Charsets.UTF_8))
        return Box(cipher.iv, cipher.doFinal(plaintext))
    }
    fun decrypt(identity: String, box: Box, key: SecretKey): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, box.iv)); cipher.updateAAD(identity.toByteArray(Charsets.UTF_8))
        return cipher.doFinal(box.ciphertext)
    }
}
