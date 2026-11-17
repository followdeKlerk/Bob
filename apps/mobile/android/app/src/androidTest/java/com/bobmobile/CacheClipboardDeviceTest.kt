package com.bobmobile

import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.database.sqlite.SQLiteDatabase
import android.test.InstrumentationTestCase
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.BridgeReactContext
import java.lang.reflect.Proxy
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Run only on an isolated synthetic-data emulator, never the owner's phone. */
@Suppress("DEPRECATION")
class CacheClipboardDeviceTest : InstrumentationTestCase() {
    fun testNativeCopyRoundTripKeepsCompleteTextAndSensitivePreviewFlag() {
        val context = instrumentation.targetContext
        val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)!!.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val activity = instrumentation.startActivitySync(intent)
        val done = CountDownLatch(1)
        var rejected = false
        val promise = Proxy.newProxyInstance(Promise::class.java.classLoader, arrayOf(Promise::class.java)) { _, method, _ ->
            if (method.name == "reject") { rejected = true; done.countDown() }
            if (method.name == "resolve") done.countDown()
            null
        } as Promise
        val text = "**Bold** literal a*b / *****\n```txt\nkeep *\n```\n" + "界😀\n".repeat(20000) + "COMPLETE CLIPBOARD END"
        try {
            instrumentation.runOnMainSync {
                val module = BobPlatform(BridgeReactContext(context))
                module.copyText(text, promise)
                assertTrue(done.await(5, TimeUnit.SECONDS)); assertFalse(rejected)
                val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                val clip = clipboard.primaryClip!!
                assertEquals(text, clip.getItemAt(0).text.toString())
                assertEquals(text, clip.getItemAt(0).coerceToText(context).toString())
                assertTrue(clip.description.extras!!.getBoolean("android.content.extra.IS_SENSITIVE"))
                module.invalidate()
            }
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
    fun testReadOnlyCacheMetadataMatchesUtf8WithoutReturningPayloads() {
        val path = java.io.File(instrumentation.targetContext.cacheDir, "synthetic-cache.sqlite")
        path.delete()
        try {
            SQLiteDatabase.openOrCreateDatabase(path, null).use { db ->
                db.execSQL("CREATE TABLE Storage (`key` TEXT NOT NULL PRIMARY KEY, `value` TEXT)")
                val payload = "界😀".repeat(8000) // 56KB chunk, realistic production boundary.
                val manifest = "{\"version\":1,\"generation\":\"saved\",\"parts\":20}"
                db.beginTransaction()
                for (id in 1..100) {
                    db.execSQL("INSERT INTO Storage VALUES (?, ?)", arrayOf("chunked:history:synthetic:$id", manifest))
                    for (part in 0 until 20) db.execSQL("INSERT INTO Storage VALUES (?, ?)", arrayOf("chunked:history:synthetic:$id:saved:$part", payload))
                }
                db.execSQL("INSERT INTO Storage VALUES ('notes:synthetic', 'PRIVATE SYNTHETIC NOTE')")
                db.execSQL("INSERT INTO Storage VALUES ('history:synthetic:01', 'NOT A CACHE KEY')")
                db.execSQL("INSERT INTO Storage VALUES ('history:synthetic:101', ?)", arrayOf("x".repeat(3*1024*1024)))
                db.setTransactionSuccessful(); db.endTransaction()
                val start = System.nanoTime()
                var oldBytes = 0L
                db.rawQuery("SELECT `key`, `value` FROM Storage WHERE `key` GLOB 'chunked:*'", null).use { cursor ->
                    while (cursor.moveToNext()) oldBytes += cursor.getString(1).toByteArray(Charsets.UTF_8).size
                }
                val oldMs = (System.nanoTime()-start)/1_000_000
                val next = System.nanoTime()
                val rows = DownloadedCacheSnapshot.read(db)
                val newMs = (System.nanoTime()-next)/1_000_000
                assertEquals(2101, rows.size)
                assertEquals(oldBytes+3*1024*1024, rows.sumOf { it.bytes })
                assertTrue(rows.none { it.key.startsWith("notes:") || it.key.endsWith(":01") })
                assertEquals(2103, db.rawQuery("SELECT count(*) FROM Storage", null).use { it.moveToFirst(); it.getInt(0) })
                android.util.Log.i("BobCacheTest", "synthetic 100 chats / 112MB: payload cursor=${oldMs}ms metadata=${newMs}ms; payload bytes avoided=$oldBytes")
                // A large legacy row that exceeds a CursorWindow is still measurable.
                assertEquals(3L*1024*1024, rows.single { it.key == "history:synthetic:101" }.bytes)
            }
            SQLiteDatabase.openDatabase(path.path, null, SQLiteDatabase.OPEN_READONLY).use { db ->
                assertEquals(2101, DownloadedCacheSnapshot.read(db).size)
            }
        } finally { path.delete() }
    }
}
