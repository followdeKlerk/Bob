package com.bobmobile

import android.content.Context
import android.database.sqlite.SQLiteDatabase

/** Read-only metadata for the pinned AsyncStorage 3.x default (legacy Room) store.
 * Never opens/creates/upgrades a database and never returns transcript payloads.
 * Keep the adapter test coupled to the installed dependency's schema. */
internal object DownloadedCacheSnapshot {
    data class Row(val key: String, val bytes: Long)
    private val address = Regex("^(chats:[^:\\s]+|(?:history|history-pages):[^:\\s]+:([1-9][0-9]*))(?::([a-z0-9-]+):(0|[1-9][0-9]*))?$")
    fun managed(key: String): Boolean {
        val chunked = key.startsWith("chunked:")
        val match = address.matchEntire(if (chunked) key.substring(8) else key) ?: return false
        if (!chunked && match.groupValues[3].isNotEmpty()) return false
        if (match.groupValues[2].isNotEmpty() && (match.groupValues[2].toLongOrNull() ?: return false) > 9007199254740991L) return false
        if (match.groupValues[4].isNotEmpty() && (match.groupValues[4].toIntOrNull() ?: return false) >= 256) return false
        return true
    }
    fun read(context: Context): List<Row> {
        val path = context.getDatabasePath("AsyncStorage")
        check(path.isFile) { "AsyncStorage has not been initialized" }
        return SQLiteDatabase.openDatabase(path.path, null, SQLiteDatabase.OPEN_READONLY).use { db ->
            read(db)
        }
    }
    fun read(db: SQLiteDatabase): List<Row> {
        // LENGTH(BLOB) measures UTF-8 in SQLite, without loading large text into
        // a CursorWindow, across JNI, or onto the JS thread. No values, including
        // small transcript chunks, are selected. Unknown schemas fail visibly.
        val rows = ArrayList<Row>()
        db.rawQuery("""SELECT `key`, length(CAST(`value` AS BLOB))
            FROM Storage WHERE `value` IS NOT NULL AND
            (`key` GLOB 'chats:*' OR `key` GLOB 'history:*' OR `key` GLOB 'history-pages:*' OR `key` GLOB 'chunked:chats:*' OR `key` GLOB 'chunked:history:*' OR `key` GLOB 'chunked:history-pages:*')""", null).use { cursor ->
            while (cursor.moveToNext()) {
                val key = cursor.getString(0)
                if (!managed(key)) continue
                rows.add(Row(key, cursor.getLong(1)))
            }
        }
        return rows
    }
}
