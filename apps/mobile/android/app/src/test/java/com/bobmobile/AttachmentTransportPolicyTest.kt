package com.bobmobile

import org.junit.Assert.*
import org.junit.Test
import java.nio.file.Files
import java.io.File

class AttachmentTransportPolicyTest {
    private val id = "5aaee20e-e260-4403-80da-b97ce80664a1"
    @Test fun permitsOnlyTheExactIdempotentArtifactUploadQuery() {
        assertTrue(AttachmentTransportPolicy.acceptsQuery("/v1/chats/7/artifacts", "uploadId=$id"))
        assertTrue(AttachmentTransportPolicy.acceptsQuery("/v1/chats/7/artifacts/$id", null))
        for (query in listOf("", "uploadId=bad", "uploadId=$id&other=1", "token=secret", "uploadId=%35aaee20e-e260-4403-80da-b97ce80664a1")) {
            assertFalse(query, AttachmentTransportPolicy.acceptsQuery("/v1/chats/7/artifacts", query))
        }
        for (path in listOf("/v1/chats/7/messages", "/v1/chats/7/artifacts/$id", "/v1/updates/test/apk", "/v1/chats/../artifacts")) {
            assertFalse(path, AttachmentTransportPolicy.acceptsQuery(path, "uploadId=$id"))
        }
    }
    @Test fun durableDraftIsNotLostWhenCacheIsEvictedAndLegacyFilesAreStillAccepted() {
        val root = Files.createTempDirectory("bob-draft-test").toFile()
        try {
            val files = File(root, "files").apply { mkdirs() }
            val cache = File(root, "cache").apply { mkdirs() }
            val candidates = AttachmentTransportPolicy.draftCandidates(files, cache, id)
            assertEquals(File(files, "bob-drafts/$id").canonicalFile, candidates[0])
            assertEquals(File(cache, "bob-drafts/$id").canonicalFile, candidates[1])
            candidates.forEach { it.parentFile!!.mkdirs(); it.writeText("original attachment bytes") }
            cache.deleteRecursively()
            assertTrue(candidates[0].isFile)
            assertEquals("original attachment bytes", candidates[0].readText())
            assertFalse(candidates[1].exists())
        } finally { root.deleteRecursively() }
    }
    @Test fun rejectsInvalidAttachmentIdentitiesBeforeResolvingPaths() {
        val root = Files.createTempDirectory("bob-draft-test").toFile()
        try {
            for (id in listOf("../private", "", "not-a-uuid", "/tmp/file", "$id/../../private")) {
                try {
                    AttachmentTransportPolicy.draftCandidates(root, root, id)
                    fail("Accepted invalid attachment ID: $id")
                } catch (_: IllegalArgumentException) { }
            }
        } finally { root.deleteRecursively() }
    }
}
