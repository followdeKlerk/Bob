package com.bobmobile

import org.junit.Assert.*
import org.junit.Test
import java.io.File

/** Static Android integration contracts, not claims of on-device/provider coverage. */
class PhoneToolsWiringTest {
    private val source get() = File("src/main/java/com/bobmobile/BobPhoneTools.kt").readText()
    @Test fun receiptLookupIsReadOnlyAndBackendScoped() {
        val lookup = source.substringAfter("@ReactMethod fun getResult(").substringBefore("@ReactMethod fun setEnabled(")
        assertTrue(lookup.contains("receipts.find(backendId, id)?.second"))
        assertTrue(lookup.contains("isEnabled(backendId)")); assertTrue(lookup.contains("foreground()"))
        for (effect in listOf("dispatch(", "begin(", "finish(", "delete(", "executeRequest(", "startActivity")) assertFalse(effect, lookup.contains(effect))
        assertTrue(source.contains("PRIMARY KEY(backend,id)"))
        assertTrue(source.contains("backend=? AND id=?"))
    }
    @Test fun durableQueueNeverEvictsLiveReceiptsAndFailsClosedAtCapacity() {
        assertTrue(source.contains("Executors.newSingleThreadExecutor"))
        assertTrue(source.contains("PRAGMA synchronous=FULL"))
        assertTrue(source.contains("db.beginTransaction()")); assertTrue(source.contains("db.endTransaction()"))
        assertEquals(1, Regex("db\\.delete\\(\"receipts\"").findAll(source).count())
        assertTrue(source.contains("db.delete(\"receipts\", \"expires<=?\""))
        assertTrue(source.contains("it.getInt(0) < 4096"))
        assertTrue(source.contains("PhoneToolsPolicy.fingerprint(raw)"))
        assertTrue(source.contains("PhoneToolsLedger.run(receipts, backend, id, fingerprint, expires"))
    }
    @Test fun executionAndActivityDispatchRecheckEnablementExpiryAndForeground() {
        val guard = source.substringAfter("private fun guard(").substringBefore("private fun onActivity(")
        assertTrue(guard.contains("isEnabled(backend)")); assertTrue(guard.contains("PhoneToolsPolicy.fresh")); assertTrue(guard.contains("foreground()"))
        val foreground = source.substringAfter("private fun foreground()").substringBefore("private fun guard(")
        assertTrue(foreground.contains("context.lifecycleState != LifecycleState.RESUMED"))
        assertTrue(foreground.contains("Lifecycle.State.RESUMED")); assertTrue(foreground.contains("activity.isFinishing")); assertTrue(foreground.contains("activity.isDestroyed"))
        assertTrue(source.contains("val task = FutureTask { block(guard(backend, expires)) }"))
        assertTrue(source.contains("activity.runOnUiThread(task)"))
        assertEquals(1, Regex("activity\\.startActivity\\(intent\\)").findAll(source).count())
        assertTrue(source.contains("result(\"launched\", data, \"Handed action to Android; completion, sending, or saving is not verified\")"))
    }
    @Test fun calendarExpansionAndSafeWriteScopeAreExplicit() {
        assertTrue(source.contains("CalendarContract.Instances.CONTENT_URI.buildUpon()"))
        assertTrue(source.contains("ContentUris.appendId(this, start.millis)")); assertTrue(source.contains("ContentUris.appendId(this, end.millis)"))
        assertTrue(source.contains("permission(Manifest.permission.READ_CALENDAR); permission(Manifest.permission.WRITE_CALENDAR)"))
        assertTrue(source.contains("CAL_ACCESS_CONTRIBUTOR"))
        assertTrue(source.contains("_id=? AND calendar_id=? AND deleted=0"))
        assertTrue(source.contains("\"original_id\", \"original_sync_id\", \"originalInstanceTime\""))
        assertTrue(source.contains("resolver.delete(CalendarContract.Events.CONTENT_URI, safeSelection, args)"))
        assertTrue(source.contains("resolver.update(CalendarContract.Events.CONTENT_URI, values, safeSelection, args)"))
        assertTrue(source.contains("single_non_recurring_event")); assertTrue(source.contains("matchedRows"))
        assertTrue(source.contains("val title = string(p, \"title\", 500)"))
        assertTrue(source.contains("string(p, \"description\", 10000, true)"))
    }
    @Test fun calendarUpdatesReadScopedAllDayBeforeValidationAndOmitUnspecifiedFields() {
        val write = source.substringAfter("private fun calendarWrite(").substringBefore("private fun contacts(")
        assertTrue(write.contains("(recurrence + \"allDay\").toTypedArray(), selection, args"))
        assertTrue(write.indexOf("val existingAllDay") < write.indexOf("PhoneToolsPolicy.eventOptionalFields("))
        assertTrue(write.indexOf("PhoneToolsPolicy.eventOptionalFields(") < write.indexOf("PhoneToolsPolicy.eventDates("))
        assertTrue(write.contains("if (p.has(\"allDay\")) bool(p, \"allDay\") else null"))
        assertTrue(write.contains("if (p.has(\"description\")) string(p, \"description\", 10000, true) else null"))
        assertTrue(write.contains("if (p.has(\"location\")) string(p, \"location\", 2000, true) else null"))
        assertTrue(write.contains("optional.write({ column, value -> values.put(column, value) }"))
        assertFalse(write.contains("values.put(\"description\"")); assertFalse(write.contains("values.put(\"eventLocation\""))
        assertTrue(write.contains("safeSelection += \" AND allDay=?\""))
        val events = source.substringAfter("private fun calendarEvents(").substringBefore("private fun writableCalendar(")
        assertTrue(events.contains("PhoneToolsPolicy.recurrenceColumns"))
        assertTrue(events.contains("PhoneToolsPolicy.recurring(PhoneToolsPolicy.recurrenceColumns.map { row.text(it) })"))
        assertTrue(events.contains(".put(\"description\", row.text(\"description\"))"))
    }
    @Test fun clocksRequestNoUiButStillOnlyReportLaunchedAndDeviceInfoReadsPermissionlessBattery() {
        assertEquals(2, Regex("EXTRA_SKIP_UI, true").findAll(source).count())
        assertFalse(source.contains("EXTRA_SKIP_UI, false"))
        assertTrue(source.contains("completion, sending, or saving is not verified"))
        val device = source.substringAfter("private fun deviceInfo()").substringBefore("private fun settingsIntent(")
        assertTrue(device.contains("BatteryManager.BATTERY_PROPERTY_CAPACITY"))
        assertTrue(device.contains("takeIf { it in 0..100 }"))
        assertTrue(device.contains("manager?.isCharging"))
        assertTrue(device.contains("capacity ?: JSONObject.NULL")); assertTrue(device.contains("charging ?: JSONObject.NULL"))
        assertFalse(device.contains("permission(")); assertFalse(device.contains("registerReceiver("))
    }
    @Test fun noGenericExecutionAndOnlyMusicVolumeAndReadOnlyContacts() {
        for (forbidden in listOf("Intent.parseUri", "Runtime.getRuntime", "ProcessBuilder", "ACTION_CALL", "SmsManager", "addJavascriptInterface", "AlertDialog", "STREAM_RING", "STREAM_ALARM", "STREAM_NOTIFICATION")) assertFalse(forbidden, source.contains(forbidden))
        assertTrue(source.contains("AudioManager.STREAM_MUSIC"))
        assertFalse(source.contains("insert(ContactsContract")); assertFalse(source.contains("update(ContactsContract")); assertFalse(source.contains("delete(ContactsContract"))
        assertTrue(source.contains("size <= PhoneToolsPolicy.MAX_RESULT_BYTES"))
        assertTrue(source.contains("PhoneToolsPolicy.requestSize(raw)"))
        assertTrue(source.contains("if (more) put(\"nextOffset\", offset.toLong() + count)"))
    }
    @Test fun registrationAndManifestOnlyDeclareTheAuthorizedSurface() {
        assertTrue(File("src/main/java/com/bobmobile/BobPlatform.kt").readText().contains("BobPhoneTools(context)"))
        val manifest = File("src/main/AndroidManifest.xml").readText()
        for (permission in listOf("READ_CALENDAR", "WRITE_CALENDAR", "READ_CONTACTS", "CAMERA", "MODIFY_AUDIO_SETTINGS")) assertTrue(permission, manifest.contains("android.permission.$permission"))
        assertTrue(manifest.contains("com.android.alarm.permission.SET_ALARM"))
        assertTrue(manifest.contains("android.intent.category.LAUNCHER"))
        for (forbidden in listOf("QUERY_ALL_PACKAGES", "WRITE_CONTACTS", "SEND_SMS", "CALL_PHONE", "BIND_ACCESSIBILITY_SERVICE", "BIND_NOTIFICATION_LISTENER_SERVICE")) assertFalse(forbidden, manifest.contains(forbidden))
    }
}
