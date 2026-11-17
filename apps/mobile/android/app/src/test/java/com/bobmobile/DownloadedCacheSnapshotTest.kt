package com.bobmobile

import org.junit.Assert.*
import org.junit.Test
import java.io.File

class DownloadedCacheSnapshotTest {
    @Test fun ownershipMatchesTheJavascriptCacheBoundary() {
        val valid = listOf("chats:alpha", "history:alpha:1", "history-pages:alpha:9007199254740991", "chunked:history:alpha:1", "chunked:history:alpha:1:saved-1:0", "chunked:chats:alpha:saved:255")
        val invalid = listOf("notes:alpha", "draft:alpha:1", "history:alpha:0", "history:alpha:01", "history:alpha:-1", "history:alpha:9007199254740992", "history:alpha:9999999999999999999999", "chats:alpha:extra", "history:alpha:1:extra", "chunked:history:alpha:1:UPPER:0", "chunked:history:alpha:1:saved:256", "chunked:history:alpha:1:saved:00", "chunked:history:alpha:1:saved:9999999999999999999", "history:bad name:1")
        for (key in valid) assertTrue(key, DownloadedCacheSnapshot.managed(key))
        for (key in invalid) assertFalse(key, DownloadedCacheSnapshot.managed(key))
    }
    @Test fun adapterIsExplicitlyCoupledToThePinnedDefaultStorageSchema() {
        val root = File("../../node_modules/@react-native-async-storage/async-storage")
        assertTrue(File(root, "package.json").readText().contains("\"version\": \"3.1.1\""))
        assertTrue(File(root, "src/index.tsx").readText().contains("export default getLegacyStorage()"))
        val schema = File(root, "android/src/main/kotlin/org/asyncstorage/legacy_storage/LegacyStorageSupplier.kt").readText()
        for (fragment in listOf("DATABASE_NAME = \"AsyncStorage\"", "TABLE_NAME = \"Storage\"", "COLUMN_KEY = \"key\"", "COLUMN_VALUE = \"value\"")) assertTrue(fragment, schema.contains(fragment))
        val adapter = File("src/main/java/com/bobmobile/DownloadedCacheSnapshot.kt").readText()
        assertTrue(adapter.contains("SQLiteDatabase.OPEN_READONLY"))
        assertFalse(adapter.contains("THEN `value`")); assertFalse(adapter.contains("getString(2)"))
        assertFalse(adapter.contains("openOrCreateDatabase")); assertFalse(adapter.contains("execSQL"))
    }
}
