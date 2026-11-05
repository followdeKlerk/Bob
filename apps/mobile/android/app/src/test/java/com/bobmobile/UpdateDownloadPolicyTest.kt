package com.bobmobile

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.security.MessageDigest

class UpdateDownloadPolicyTest {
    private val sha = "a".repeat(64)
    private val url = "https://paired.tailnet.ts.net/v1/updates/release_1-abc/apk"
    private fun rejects(block: () -> Unit) { assertThrows(Exception::class.java, block) }
    @Test fun onlyExactPairedArtifactTransportWithoutQueryCredentialsFragmentsOrEncoding() {
        assertEquals(4L, UpdateDownloadPolicy.validate(url, sha, 4.0, false))
        for (bad in listOf(
            url.replace("https:", "http:"), url.replace("paired.tailnet.ts.net", "ts.net.evil.com"),
            url.replace("paired.tailnet.ts.net", "ts.net"), url.replace("https://", "https://user:secret@"),
            "$url?token=secret", "$url?", "$url#fragment", url.replace("/apk", "/%61pk"),
            url.replace("release_1-abc", "../other"), url.replace("/updates/", "/chats/"), "$url/", "file:///v1/updates/release/apk"
        )) rejects { UpdateDownloadPolicy.validate(bad, sha, 4.0, false) }
        val local = "http://127.0.0.1:1234/v1/updates/release/apk"
        assertEquals(4L, UpdateDownloadPolicy.validate(local, sha, 4.0, true))
        rejects { UpdateDownloadPolicy.validate(local, sha, 4.0, false) }
        rejects { UpdateDownloadPolicy.validate(local.replace("127.0.0.1", "localhost"), sha, 4.0, true) }
        rejects { UpdateDownloadPolicy.validate(local.replace(":1234", ""), sha, 4.0, true) }
    }
    @Test fun artifactBoundsRejectNonfiniteFractionalAndOversizeMetadata() {
        for (size in listOf(0.0, -1.0, Double.NaN, Double.POSITIVE_INFINITY, 1.5, UpdateDownloadPolicy.MAX_BYTES + 1.0))
            rejects { UpdateDownloadPolicy.artifact(sha, size) }
        for (checksum in listOf("", "A".repeat(64), "g".repeat(64), "../$sha", sha.drop(1)))
            rejects { UpdateDownloadPolicy.artifact(checksum, 1.0) }
        assertEquals(UpdateDownloadPolicy.MAX_BYTES, UpdateDownloadPolicy.artifact(sha, UpdateDownloadPolicy.MAX_BYTES.toDouble()))
        assertEquals(15 * 60 * 1000L, UpdateDownloadPolicy.TIMEOUT_MS)
    }
    @Test fun streamRequiresExactLengthAndDigestWithoutWritingOverflowBytes() {
        val bytes = ByteArray(150000) { (it % 251).toByte() }
        val digest = UpdateDownloadPolicy.hex(MessageDigest.getInstance("SHA-256").digest(bytes))
        val output = ByteArrayOutputStream(); var checks = 0
        UpdateDownloadPolicy.copyVerified(ByteArrayInputStream(bytes), output, bytes.size.toLong(), digest) { checks++ }
        assertArrayEquals(bytes, output.toByteArray()); assertTrue(checks >= 3)
        rejects { UpdateDownloadPolicy.copyVerified(ByteArrayInputStream(bytes.dropLast(1).toByteArray()), ByteArrayOutputStream(), bytes.size.toLong(), digest) {} }
        val bounded = ByteArrayOutputStream()
        rejects { UpdateDownloadPolicy.copyVerified(ByteArrayInputStream(bytes), bounded, 100L, digest) {} }
        assertEquals(0, bounded.size())
        rejects { UpdateDownloadPolicy.copyVerified(ByteArrayInputStream(bytes), ByteArrayOutputStream(), bytes.size.toLong(), sha) {} }
        rejects { UpdateDownloadPolicy.copyVerified(ByteArrayInputStream(bytes), ByteArrayOutputStream(), bytes.size.toLong(), digest) { throw InterruptedException() } }
    }
    @Test fun packageUpgradeAndCompleteNonemptySignerSetMustMatch() {
        fun verify(pkg: String = "com.bobmobile", version: Long = 2, candidate: List<String> = listOf("signer"), installed: List<String> = listOf("signer")) =
            UpdateDownloadPolicy.verifyIdentity(pkg, "com.bobmobile", version, 1, candidate, installed)
        verify(); verify(candidate = listOf("b", "a"), installed = listOf("a", "b"))
        rejects { verify(pkg = "other.app") }; rejects { verify(version = 1) }; rejects { verify(version = 0) }
        rejects { verify(candidate = emptyList(), installed = emptyList()) }
        rejects { verify(candidate = listOf("other")) }; rejects { verify(candidate = listOf("signer", "extra")) }
    }
    @Test fun sameLengthCorruptReadyArtifactIsInvalidatedSoExplicitRedownloadCanProceed() {
        val dir = java.nio.file.Files.createTempDirectory("bob-update-corrupt").toFile()
        try {
            val original = byteArrayOf(1, 2, 3)
            val expectedSha = UpdateDownloadPolicy.hex(MessageDigest.getInstance("SHA-256").digest(original))
            val file = java.io.File(dir, "ready.apk").apply { writeBytes(byteArrayOf(1, 2, 4)) }
            val record = java.io.File(dir, "ready.json").apply { writeText("ready") }
            assertEquals(original.size.toLong(), file.length()) // Length-only status previously stayed ready forever.
            var failedRetryable = false; var packageChecked = false
            rejects {
                UpdateDownloadPolicy.recheckReady(file, expectedSha, 3L, { packageChecked = true }) {
                    failedRetryable = UpdateDownloadPolicy.invalidateReady(expectedSha, 3L, expectedSha, 3L, file, record)
                }
            }
            assertFalse(packageChecked); assertTrue(failedRetryable)
            assertFalse(file.exists()); assertFalse(record.exists()) // Also absent after a process restart.
            // An explicit subsequent download can create and verify a fresh copy.
            file.writeBytes(original); record.writeText("ready")
            assertEquals(file, UpdateDownloadPolicy.recheckReady(file, expectedSha, 3L, {}) { fail("Valid copy must not be invalidated") })
            assertTrue(file.exists()); assertTrue(record.exists())
        } finally { dir.deleteRecursively() }
    }
    @Test fun packageRecheckFailureInvalidatesOnlyMatchingArtifactAndNeverReplacementReceipt() {
        val dir = java.nio.file.Files.createTempDirectory("bob-update-stale").toFile()
        try {
            val bytes = byteArrayOf(1, 2, 3)
            val expectedSha = UpdateDownloadPolicy.hex(MessageDigest.getInstance("SHA-256").digest(bytes))
            val file = java.io.File(dir, "old.apk").apply { writeBytes(bytes) }
            val record = java.io.File(dir, "ready.json").apply { writeText("replacement ready") }
            val replacement = java.io.File(dir, "replacement.apk").apply { writeBytes(byteArrayOf(4, 5, 6)) }
            for ((recordSha, recordSize) in listOf("b".repeat(64) to 3L, expectedSha to 4L, null to null)) {
                rejects {
                    UpdateDownloadPolicy.recheckReady(file, expectedSha, 3L, { error("Signing identity rejected") }) {
                        assertFalse(UpdateDownloadPolicy.invalidateReady(expectedSha, 3L, recordSha, recordSize, file, record))
                    }
                }
                assertTrue(file.exists()); assertTrue(record.exists()); assertTrue(replacement.exists())
            }
            rejects {
                UpdateDownloadPolicy.recheckReady(file, expectedSha, 3L, { error("Signing identity rejected") }) {
                    assertTrue(UpdateDownloadPolicy.invalidateReady(expectedSha, 3L, expectedSha, 3L, file, record))
                }
            }
            assertFalse(file.exists()); assertFalse(record.exists()); assertTrue(replacement.exists())
        } finally { dir.deleteRecursively() }
    }
    @Test fun completionBeforeDestroyHoldsSlotAndDestroyBeforeCompletionAlsoHoldsSlot() {
        val completedFirst = UpdateDownloadLifetime()
        completedFirst.workerFinished()
        assertFalse(completedFirst.mayRetire) // A second tap here must still see the old request as owned.
        completedFirst.workerFinished(); assertFalse(completedFirst.mayRetire)
        completedFirst.onDestroy(); assertTrue(completedFirst.mayRetire)
        val destroyedFirst = UpdateDownloadLifetime()
        destroyedFirst.onDestroy()
        assertFalse(destroyedFirst.mayRetire) // Cancellation does not permit overlap with a socket still unwinding.
        destroyedFirst.onDestroy(); assertFalse(destroyedFirst.mayRetire)
        destroyedFirst.workerFinished(); assertTrue(destroyedFirst.mayRetire)
    }

}
