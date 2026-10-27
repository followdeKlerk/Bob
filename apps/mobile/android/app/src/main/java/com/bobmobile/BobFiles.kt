package com.bobmobile

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.provider.MediaStore
import android.provider.DocumentsContract
import android.content.ContentUris
import androidx.core.content.FileProvider
import com.facebook.react.bridge.*
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.util.UUID

/** Streams original bytes through Android's document picker; never persists bearer credentials. */
class BobFiles(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    private class UploadHttpError(val status: Int, val retryAfterMs: Double?) : Exception("Upload rejected (HTTP $status)")
    private data class Operation(val url: String, val token: String, val identity: String, val promise: Promise, val limit: Long)
    private var upload: Operation? = null
    private var download: Operation? = null
    private var markdownPromise: Promise? = null
    private var folderPromise: Promise? = null
    private var camera: Triple<File, Long, Promise>? = null
    private var selection: Pair<Long, Promise>? = null
    private val staged = java.util.concurrent.ConcurrentHashMap<String, Triple<File, String, String>>()
    override fun getName() = "BobFiles"
    init {
        context.addActivityEventListener(object : BaseActivityEventListener() {
            override fun onActivityResult(activity: Activity, code: Int, result: Int, data: Intent?) {
                if (code == 2705) {
                    val promise = folderPromise ?: return; folderPromise = null
                    val uri = data?.data
                    if (result != Activity.RESULT_OK || uri == null) { promise.resolve(null); return }
                    try {
                        context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        context.getSharedPreferences("attachment-library", 0).edit().putString("folder", uri.toString()).apply()
                        promise.resolve(uri.toString())
                    } catch (e: Exception) { promise.reject("folder", e.message) }
                    return
                }
                if (code == 2706) {
                    val pending = camera ?: return; camera = null
                    if (result != Activity.RESULT_OK) { pending.first.delete(); pending.third.resolve(null); return }
                    Thread {
                        try { pending.third.resolve(stageContent(Uri.fromFile(pending.first), pending.second, "Camera.jpg", "image/jpeg")) }
                        catch (e: Exception) { pending.third.reject("camera", e.message) }
                        finally { pending.first.delete() }
                    }.start()
                    return
                }
                if (code == 2704) {
                    val pending = selection ?: return; selection = null
                    val uri = data?.data
                    if (result != Activity.RESULT_OK || uri == null) { pending.second.resolve(null); return }
                    Thread {
                        try { pending.second.resolve(stageContent(uri, pending.first)) }
                        catch (e: Exception) { pending.second.reject("selection", e.message ?: "Cannot attach file") }
                    }.start()
                    return
                }
                if (code == 2703) {
                    val pending = markdownPromise ?: return; markdownPromise = null
                    val uri = data?.data
                    if (result != Activity.RESULT_OK || uri == null) { pending.reject("cancelled", "Import cancelled"); return }
                    Thread {
                        try {
                            var name = ""
                            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) name = it.getString(0) }
                            require(listOf(".md", ".markdown", ".txt").any { name.lowercase().endsWith(it) }) { "Choose a Markdown or text file" }
                            val output = java.io.ByteArrayOutputStream()
                            context.contentResolver.openInputStream(uri)!!.use { copy(it, output, 128000) }
                            val bytes = output.toByteArray(); require(!bytes.contains(0.toByte())) { "Binary file cannot be a skill" }
                            val decoder = Charsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT).onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
                            pending.resolve(decoder.decode(java.nio.ByteBuffer.wrap(bytes)).toString())
                        } catch (e: Exception) { pending.reject("import", e.message ?: "Cannot import Markdown") }
                    }.start()
                    return
                }
                val operation = when (code) { 2701 -> upload.also { upload = null }; 2702 -> download.also { download = null }; else -> null } ?: return
                val uri = data?.data
                if (result != Activity.RESULT_OK || uri == null) { operation.promise.reject("cancelled", "Document selection cancelled"); return }
                Thread {
                    try {
                        if (code == 2701) send(uri, operation) else {
                            context.contentResolver.openOutputStream(uri, "wt")!!.use { receive(operation, it) }
                            operation.promise.resolve("Saved original bytes")
                        }
                    } catch (e: Exception) { operation.promise.reject("transfer", e.message ?: "Transfer failed") }
                }.start()
            }
        })
    }
    private fun connection(op: Operation): HttpURLConnection {
        val uri = URI(op.url)
        require(uri.userInfo == null && uri.fragment == null && AttachmentTransportPolicy.acceptsQuery(uri.path, uri.rawQuery))
        require((uri.scheme == "https" && uri.host?.endsWith(".ts.net") == true) ||
            (BuildConfig.DEBUG && uri.scheme == "http" && uri.host == "127.0.0.1" && uri.port in 1..65535)) { "Verified paired transport required" }
        require(uri.path.startsWith("/v1/chats/") || Regex("^/v1/updates/[A-Za-z0-9_-]{1,128}/apk$").matches(uri.path))
        return (uri.toURL().openConnection() as HttpURLConnection).apply {
            instanceFollowRedirects = false
            connectTimeout = 15000; readTimeout = 60000
            setRequestProperty("Authorization", "Bearer ${op.token}")
            setRequestProperty("x-bob-backend", op.identity)
        }
    }
    private fun copy(input: InputStream, output: OutputStream, limit: Long) {
        val buffer = ByteArray(65536); var count = 0L
        while (true) {
            val n = input.read(buffer); if (n < 0) return
            count += n; require(count <= limit) { "Transfer exceeds configured limit" }; output.write(buffer, 0, n)
        }
    }
    private fun operation(url: String, token: String, identity: String, limit: Double, promise: Promise) =
        Operation(url, token, identity, promise, limit.toLong().also { require(it in 1..1073741824) })
    private fun send(uri: Uri, op: Operation, stagedName: String? = null, stagedMime: String? = null) {
        var name = "attachment"
        if (stagedName == null) context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use {
            if (it.moveToFirst()) {
                name = it.getString(0)
                if (!it.isNull(1)) require(it.getLong(1) <= op.limit) { "Attachment exceeds configured limit" }
            }
        }
        if (stagedName != null) name = stagedName
        val connection = connection(op)
        try {
            connection.requestMethod = "POST"; connection.doOutput = true; connection.setChunkedStreamingMode(65536)
            connection.setRequestProperty("Content-Type", stagedMime ?: context.contentResolver.getType(uri) ?: "application/octet-stream")
            connection.setRequestProperty("x-file-name", URLEncoder.encode(name, "UTF-8").replace("+", "%20"))
            context.contentResolver.openInputStream(uri)!!.use { input -> connection.outputStream.use { copy(input, it, op.limit) } }
            if (connection.responseCode !in 200..299) {
                val header = connection.getHeaderField("Retry-After")
                val retryMs = header?.toDoubleOrNull()?.times(1000) ?: try {
                    header?.let { (java.text.SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss z", java.util.Locale.US).parse(it)!!.time - System.currentTimeMillis()).toDouble().coerceAtLeast(0.0) }
                } catch (_: Exception) { null }
                throw UploadHttpError(connection.responseCode, retryMs)
            }
            op.promise.resolve(connection.inputStream.bufferedReader().use { it.readText().take(16384) })
        } finally { connection.disconnect() }
    }
    private fun receive(op: Operation, output: OutputStream) {
        val connection = connection(op)
        try {
            require(connection.responseCode == 200) { "Download rejected (HTTP ${connection.responseCode})" }
            require(connection.contentLengthLong <= op.limit) { "Attachment exceeds configured limit" }
            connection.inputStream.use { copy(it, output, op.limit) }
        } finally { connection.disconnect() }
    }
    override fun getConstants(): MutableMap<String, Any> = mutableMapOf("versionCode" to BuildConfig.VERSION_CODE, "versionName" to BuildConfig.VERSION_NAME)
    @ReactMethod fun installUpdate(url: String, token: String, identity: String, sha256: String, expectedSize: Double, promise: Promise) {
        if (android.os.Build.VERSION.SDK_INT >= 26 && !context.packageManager.canRequestPackageInstalls()) {
            try { context.startActivity(Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            catch (e: Exception) { promise.reject("permission", "Open Android Settings and allow Bob to install app updates"); return }
            promise.reject("permission", "Allow updates from Bob, then return and tap Install again"); return
        }
        Thread {
            var file: File? = null
            try {
                require(Regex("^[a-f0-9]{64}$").matches(sha256)) { "Invalid update checksum" }
                require(Regex("^/v1/updates/[A-Za-z0-9_-]{1,128}/apk$").matches(URI(url).path)) { "Invalid update endpoint" }
                require(expectedSize >= 1 && expectedSize <= 268435456) { "Invalid update size" }
                val directory = File(context.cacheDir, "bob-previews").apply { mkdirs() }
                directory.listFiles()?.filter { it.name.startsWith("update-") && it.lastModified() < System.currentTimeMillis() - 86400000 }?.forEach { it.delete() }
                file = File(directory, "update-" + UUID.randomUUID() + ".apk")
                file.outputStream().use { receive(operation(url, token, identity, expectedSize, promise), it) }
                require(file.length() == expectedSize.toLong()) { "Incomplete update download" }
                val digest = java.security.MessageDigest.getInstance("SHA-256")
                file.inputStream().use { input -> val buffer = ByteArray(65536); while (true) { val n = input.read(buffer); if (n < 0) break; digest.update(buffer, 0, n) } }
                require(digest.digest().joinToString("") { "%02x".format(it) } == sha256) { "Update checksum mismatch" }
                val flags = if (android.os.Build.VERSION.SDK_INT >= 28) android.content.pm.PackageManager.GET_SIGNING_CERTIFICATES else android.content.pm.PackageManager.GET_SIGNATURES
                val candidate = context.packageManager.getPackageArchiveInfo(file.absolutePath, flags) ?: throw Exception("Invalid Android update")
                val installed = context.packageManager.getPackageInfo(context.packageName, flags)
                require(candidate.packageName == context.packageName) { "This update belongs to a different app" }
                val version = if (android.os.Build.VERSION.SDK_INT >= 28) candidate.longVersionCode else candidate.versionCode.toLong()
                val current = if (android.os.Build.VERSION.SDK_INT >= 28) installed.longVersionCode else installed.versionCode.toLong()
                require(version > current) { "This update is already installed or older" }
                fun signers(info: android.content.pm.PackageInfo): List<String> = (if (android.os.Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures)?.map { java.security.MessageDigest.getInstance("SHA-256").digest(it.toByteArray()).joinToString("") { byte -> "%02x".format(byte) } }?.sorted() ?: emptyList()
                val signatures = signers(candidate)
                require(signatures.isNotEmpty() && signatures == signers(installed)) { "Update signing identity does not match Bob" }
                val uri = FileProvider.getUriForFile(context, context.packageName + ".files", file)
                context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
                promise.resolve("Android installer opened. Confirm the update there; your app data is retained.")
            } catch (e: Exception) { file?.delete(); promise.reject("update", e.message ?: "Cannot install update") }
        }.start()
    }
    @ReactMethod fun importMarkdown(promise: Promise) {
        val activity = context.currentActivity
        if (activity == null || markdownPromise != null) { promise.reject("busy", "Document picker unavailable"); return }
        try {
            markdownPromise = promise
            activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply { type = "*/*"; addCategory(Intent.CATEGORY_OPENABLE) }, 2703)
        } catch (e: Exception) { markdownPromise = null; promise.reject("picker", e) }
    }
    private fun stageContent(uri: Uri, limit: Long, suppliedName: String? = null, suppliedMime: String? = null): WritableMap {
        var file: File? = null
        try {
            require(limit in 1..1073741824)
            var name = suppliedName ?: "attachment"
            if (suppliedName == null) context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use {
                if (it.moveToFirst()) {
                    name = it.getString(0) ?: "attachment"
                    if (!it.isNull(1)) require(it.getLong(1) <= limit) { "Attachment exceeds configured limit" }
                }
            }
            val mime = suppliedMime ?: context.contentResolver.getType(uri) ?: "application/octet-stream"
            val id = UUID.randomUUID().toString()
            val selectedFile = File(File(context.filesDir, "bob-drafts").apply { mkdirs() }, id).canonicalFile
            file = selectedFile
            selectedFile.outputStream().use { output -> context.contentResolver.openInputStream(uri)!!.use { copy(it, output, limit) }; output.fd.sync() }
            staged[id] = Triple(selectedFile, name, mime)
            return Arguments.createMap().apply { putString("id", id); putString("uri", Uri.fromFile(selectedFile).toString()); putString("name", name); putString("mime", mime) }
        } catch (e: Exception) { file?.delete(); throw e }
    }
    @ReactMethod fun stageLibraryItem(value: String, limit: Double, promise: Promise) {
        Thread {
            try {
                val uri = Uri.parse(value); require(uri.scheme == "content") { "Choose an on-device item" }
                promise.resolve(stageContent(uri, limit.toLong()))
            } catch (e: Exception) { promise.reject("selection", e.message) }
        }.start()
    }
    @ReactMethod fun galleryPage(before: String?, promise: Promise) {
        Thread {
            try {
                val items = Arguments.createArray()
                val collection = MediaStore.Images.Media.EXTERNAL_CONTENT_URI
                var last: String? = null; var more = false
                val supported = "mime_type IN ('image/jpeg','image/png','image/gif')"
                context.contentResolver.query(collection, arrayOf("_id", "_display_name", "mime_type", "_size"), supported + if (before == null) "" else " AND _id < ?", before?.let { arrayOf(it.toLong().toString()) }, "_id DESC")?.use { cursor ->
                    var count = 0
                    while (cursor.moveToNext()) {
                        if (count++ == 80) { more = true; break }
                        val id = cursor.getLong(0); last = id.toString()
                        items.pushMap(Arguments.createMap().apply {
                            putString("uri", ContentUris.withAppendedId(collection, id).toString()); putString("name", cursor.getString(1) ?: "Image")
                            putString("mime", cursor.getString(2) ?: "image/jpeg"); putDouble("size", cursor.getLong(3).toDouble()); putBoolean("directory", false)
                        })
                    }
                }
                promise.resolve(Arguments.createMap().apply { putArray("items", items); putString("next", if (more) last else null) })
            } catch (e: Exception) { promise.reject("gallery", e.message ?: "Photo access unavailable") }
        }.start()
    }
    @ReactMethod fun savedAttachmentFolder(promise: Promise) { promise.resolve(context.getSharedPreferences("attachment-library", 0).getString("folder", null)) }
    @ReactMethod fun chooseAttachmentFolder(promise: Promise) {
        val activity = context.currentActivity
        if (activity == null || folderPromise != null) { promise.reject("busy", "Folder picker unavailable"); return }
        try {
            folderPromise = promise
            activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION), 2705)
        } catch (e: Exception) { folderPromise = null; promise.reject("folder", e.message) }
    }
    @ReactMethod fun folderPage(treeValue: String, documentValue: String?, offset: Double, promise: Promise) {
        Thread {
            try {
                require(offset >= 0 && offset <= 1000000 && offset % 1.0 == 0.0)
                val tree = Uri.parse(treeValue)
                require(context.contentResolver.persistedUriPermissions.any { it.uri == tree && it.isReadPermission }) { "Choose this folder again to grant access" }
                val documentId = documentValue ?: DocumentsContract.getTreeDocumentId(tree)
                val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, documentId)
                val items = Arguments.createArray(); var seen = 0; var more = false
                context.contentResolver.query(children, arrayOf("document_id", "_display_name", "mime_type", "_size"), null, null, null)?.use { cursor ->
                    while (cursor.moveToNext()) {
                        if (seen++ < offset.toInt()) continue
                        if (items.size() == 80) { more = true; break }
                        val id = cursor.getString(0); val mime = cursor.getString(2) ?: "application/octet-stream"
                        items.pushMap(Arguments.createMap().apply {
                            putString("uri", DocumentsContract.buildDocumentUriUsingTree(tree, id).toString()); putString("documentId", id)
                            putString("name", cursor.getString(1) ?: "File"); putString("mime", mime); putDouble("size", if (cursor.isNull(3)) 0.0 else cursor.getLong(3).toDouble())
                            putBoolean("directory", mime == DocumentsContract.Document.MIME_TYPE_DIR)
                        })
                    }
                }
                promise.resolve(Arguments.createMap().apply { putArray("items", items); putBoolean("more", more) })
            } catch (e: Exception) { promise.reject("folder", e.message ?: "Folder unavailable") }
        }.start()
    }
    @ReactMethod fun captureAttachment(limit: Double, promise: Promise) {
        val activity = context.currentActivity
        if (activity == null || camera != null) { promise.reject("busy", "Camera unavailable"); return }
        var file: File? = null
        try {
            require(limit >= 1 && limit <= 1073741824)
            val output = File(File(context.cacheDir, "bob-previews").apply { mkdirs() }, "camera-" + UUID.randomUUID() + ".jpg"); file = output
            val uri = FileProvider.getUriForFile(context, context.packageName + ".files", output)
            camera = Triple(output, limit.toLong(), promise)
            activity.startActivityForResult(Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, uri).apply {
                addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
                clipData = android.content.ClipData.newRawUri("Camera photo", uri)
            }, 2706)
        } catch (e: Exception) { camera = null; file?.delete(); promise.reject("camera", e.message ?: "No camera app available") }
    }
    @ReactMethod fun chooseAttachment(limit: Double, promise: Promise) {
        val activity = context.currentActivity
        if (activity == null || selection != null) { promise.reject("busy", "Document picker unavailable"); return }
        try {
            require(limit >= 1 && limit <= 1073741824)
            selection = Pair(limit.toLong(), promise)
            activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply { type = "*/*"; addCategory(Intent.CATEGORY_OPENABLE) }, 2704)
        } catch (e: Exception) { selection = null; promise.reject("picker", e) }
    }
    @ReactMethod fun removeAttachment(id: String, promise: Promise) {
        try {
            val files = AttachmentTransportPolicy.draftCandidates(context.filesDir, context.cacheDir, id)
            staged.remove(id)?.first?.delete()
            files.forEach { it.delete() }
            promise.resolve(null)
        } catch (e: Exception) { promise.reject("attachment", e.message ?: "Attachment unavailable") }
    }
    @ReactMethod fun restoreAttachment(id: String, uri: String, name: String, mime: String, promise: Promise) {
        try {
            // Android may expose the same private file through /data/data and
            // /data/user/0 aliases. Compare canonical files, not URI spelling;
            // still restrict restoration to this UUID's private draft locations.
            val requested = Uri.parse(uri)
            require(requested.scheme == "file" && requested.authority.isNullOrEmpty() && requested.query == null && requested.fragment == null) { "Invalid attachment URI" }
            val requestedFile = File(requireNotNull(requested.path)).canonicalFile
            val file = AttachmentTransportPolicy.draftCandidates(context.filesDir, context.cacheDir, id)
                .firstOrNull { it == requestedFile && it.isFile }
                ?: throw IllegalArgumentException("Queued attachment is no longer available; choose it again")
            staged[id] = Triple(file, name, mime)
            promise.resolve(null)
        } catch (e: Exception) { promise.reject("attachment", e.message ?: "Attachment unavailable") }
    }
    @ReactMethod fun uploadAttachment(id: String, url: String, token: String, identity: String, limit: Double, promise: Promise) {
        Thread {
            try {
                val item = staged[id] ?: error("Attachment is no longer available; choose it again")
                send(Uri.fromFile(item.first), operation(url, token, identity, limit, promise), item.second, item.third)
            } catch (e: UploadHttpError) {
                promise.reject("http_${e.status}", e.message, Arguments.createMap().apply {
                    putInt("httpStatus", e.status)
                    e.retryAfterMs?.takeIf { it.isFinite() && it >= 0 }?.let { putDouble("retryAfterMs", it) }
                })
            } catch (e: IllegalArgumentException) { promise.reject("attachment", e.message ?: "Attachment unavailable") }
            catch (e: Exception) { promise.reject("transfer", e.message ?: "Transfer failed") }
        }.start()
    }
    @ReactMethod fun chooseUpload(url: String, token: String, identity: String, limit: Double, promise: Promise) {
        val activity = context.currentActivity
        if (activity == null || upload != null) { promise.reject("busy", "Document picker unavailable"); return }
        try {
            upload = operation(url, token, identity, limit, promise)
            activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply { type = "*/*"; addCategory(Intent.CATEGORY_OPENABLE) }, 2701)
        } catch (e: Exception) { upload = null; promise.reject("picker", e) }
    }
    @ReactMethod fun save(url: String, token: String, identity: String, name: String, mime: String, limit: Double, promise: Promise) {
        val activity = context.currentActivity
        if (activity == null || download != null) { promise.reject("busy", "Document picker unavailable"); return }
        try {
            download = operation(url, token, identity, limit, promise)
            activity.startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply { type = mime; addCategory(Intent.CATEGORY_OPENABLE); putExtra(Intent.EXTRA_TITLE, name) }, 2702)
        } catch (e: Exception) { download = null; promise.reject("picker", e) }
    }
    @ReactMethod fun preview(url: String, token: String, identity: String, mime: String, limit: Double, promise: Promise) {
        Thread {
            var file: File? = null
            try {
                val dir = File(context.cacheDir, "bob-previews").apply { mkdirs() }
                dir.listFiles()?.filter { it.lastModified() < System.currentTimeMillis() - 86400000 }?.forEach { it.delete() }
                file = File(dir, UUID.randomUUID().toString())
                file.outputStream().use { receive(operation(url, token, identity, limit, promise), it) }
                val intent = if (mime.startsWith("text/") || mime.startsWith("image/") || mime == "application/pdf") {
                    Intent(context, BobPreviewActivity::class.java).putExtra("path", file.absolutePath).putExtra("mime", mime)
                } else {
                    val uri = FileProvider.getUriForFile(context, context.packageName + ".files", file)
                    Intent.createChooser(Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), "Open original attachment")
                }
                context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); promise.resolve("Opened")
            } catch (e: Exception) { file?.delete(); promise.reject("preview", e.message ?: "Cannot open attachment") }
        }.start()
    }
}
