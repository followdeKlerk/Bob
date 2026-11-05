package com.bobmobile

import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.net.URI
import java.security.MessageDigest

/** No Android dependencies: exact artifact/transport bounds are independently testable. */
internal object UpdateDownloadPolicy {
    const val MAX_BYTES = 268435456L
    const val TIMEOUT_MS = 15 * 60 * 1000L
    const val RETENTION_MS = 86400000L
    fun artifact(sha: String, size: Double): Long {
        require(Regex("^[a-f0-9]{64}$").matches(sha)) { "Invalid update checksum" }
        require(size.isFinite() && size % 1.0 == 0.0 && size >= 1 && size <= MAX_BYTES) { "Invalid update size" }
        return size.toLong()
    }
    fun validate(url: String, sha: String, size: Double, debug: Boolean): Long {
        val bytes = artifact(sha, size)
        val uri = URI(url)
        require(uri.userInfo == null && uri.fragment == null && uri.rawQuery == null &&
            Regex("^/v1/updates/[A-Za-z0-9_-]{1,128}/apk$").matches(uri.rawPath ?: "")) { "Invalid update endpoint" }
        require((uri.scheme == "https" && uri.host?.endsWith(".ts.net") == true) ||
            (debug && uri.scheme == "http" && uri.host == "127.0.0.1" && uri.port in 1..65535)) { "Verified paired transport required" }
        return bytes
    }
    fun copyVerified(input: InputStream, output: OutputStream, size: Long, sha: String, check: () -> Unit) {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(65536); var count = 0L
        while (true) {
            check()
            val n = input.read(buffer); if (n < 0) break
            count += n
            require(count <= size) { "Update exceeds expected size" }
            digest.update(buffer, 0, n); output.write(buffer, 0, n)
        }
        require(count == size) { "Incomplete update download" }
        require(hex(digest.digest()) == sha) { "Update checksum mismatch" }
    }
    fun recheckReady(file: File, sha: String, size: Long, verifyPackage: (File) -> Unit, onInvalid: () -> Unit): File {
        try {
            val discard = object : OutputStream() {
                override fun write(value: Int) {}
                override fun write(buffer: ByteArray, offset: Int, length: Int) {}
            }
            file.inputStream().use { copyVerified(it, discard, size, sha) {} }
            verifyPackage(file)
            return file
        } catch (e: Exception) {
            onInvalid()
            throw e
        }
    }
    /** A stale install tap must never erase a replacement artifact or its completion receipt. */
    fun invalidateReady(sha: String, size: Long, recordSha: String?, recordSize: Long?, file: File, record: File): Boolean {
        if (recordSha != sha || recordSize != size) return false
        file.delete(); record.delete()
        return true
    }
    fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }
    fun verifyIdentity(candidatePackage: String, installedPackage: String, candidateVersion: Long, installedVersion: Long, candidateSigners: List<String>, installedSigners: List<String>) {
        require(candidatePackage == installedPackage) { "This update belongs to a different app" }
        require(candidateVersion > installedVersion) { "This update is already installed or older" }
        require(candidateSigners.isNotEmpty() && candidateSigners.sorted() == installedSigners.sorted()) { "Update signing identity does not match Bob" }
    }
}

/** The download slot stays owned until BOTH transport completion and service destruction. */
internal class UpdateDownloadLifetime {
    private var workerFinished = false
    var destroyed = false
        private set
    val mayRetire get() = workerFinished && destroyed
    fun workerFinished() { workerFinished = true }
    fun onDestroy() { destroyed = true }
}
