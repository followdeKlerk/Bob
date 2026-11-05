package com.bobmobile

import org.junit.Assert.*
import org.junit.Test

/** Exercises the exact write policy used to populate ContentValues, without Android/provider access. */
class PhoneToolsCalendarFieldsTest {
    private fun writes(fields: PhoneToolsPolicy.EventOptionalFields): Map<String, Any> = mutableMapOf<String, Any>().apply {
        fields.write({ column, value -> put(column, value) }, { put("allDay", it) })
    }
    @Test fun renamingTimedEventPreservesEveryOmittedOptionalField() {
        val original = mapOf("allDay" to 0, "description" to "Important notes", "eventLocation" to "Office")
        val fields = PhoneToolsPolicy.eventOptionalFields(false, null, null, null)
        assertFalse(fields.allDay); assertTrue(writes(fields).isEmpty())
        assertEquals(original, original + writes(fields))
    }
    @Test fun renamingAllDayEventPreservesItsSemanticsAndDoesNotRewriteOptionalFields() {
        val original = mapOf("allDay" to 1, "description" to "Annual holiday", "eventLocation" to "Home")
        val fields = PhoneToolsPolicy.eventOptionalFields(true, null, null, null)
        assertTrue(fields.allDay); assertTrue(writes(fields).isEmpty())
        assertEquals(original, original + writes(fields))
        PhoneToolsPolicy.eventDates(PhoneToolsPolicy.date("2028-01-01T00:00:00Z"), PhoneToolsPolicy.date("2028-01-02T00:00:00Z"), "UTC", fields.allDay)
        try {
            PhoneToolsPolicy.eventDates(PhoneToolsPolicy.date("2028-01-01T12:00:00Z"), PhoneToolsPolicy.date("2028-01-02T12:00:00Z"), "UTC", fields.allDay)
            fail("Omitted allDay was incorrectly treated as a timed event")
        } catch (_: IllegalArgumentException) {}
    }
    @Test fun explicitEmptyDescriptionClearsOnlyDescription() {
        val original = mapOf("allDay" to 1, "description" to "Old notes", "eventLocation" to "Office")
        val fields = PhoneToolsPolicy.eventOptionalFields(true, null, "", null)
        assertEquals(mapOf("description" to ""), writes(fields))
        assertEquals(mapOf("allDay" to 1, "description" to "", "eventLocation" to "Office"), original + writes(fields))
    }
    @Test fun explicitEmptyLocationClearsOnlyLocationAndPreservesNullDescription() {
        val original = mapOf("allDay" to 0, "description" to null, "eventLocation" to "Office")
        val fields = PhoneToolsPolicy.eventOptionalFields(false, null, null, "")
        assertEquals(mapOf("eventLocation" to ""), writes(fields))
        assertEquals(mapOf("allDay" to 0, "description" to null, "eventLocation" to ""), original + writes(fields))
    }
    @Test fun explicitlyProvidedFieldsReplaceOnlyThoseFieldsIncludingFalseAllDay() {
        val fields = PhoneToolsPolicy.eventOptionalFields(true, false, "New notes", "New place")
        assertFalse(fields.allDay)
        assertEquals(mapOf("allDay" to 0, "description" to "New notes", "eventLocation" to "New place"), writes(fields))
        val allDay = PhoneToolsPolicy.eventOptionalFields(false, true, null, null)
        assertTrue(allDay.allDay); assertEquals(mapOf("allDay" to 1), writes(allDay))
    }
    @Test fun createsRetainDefaultValuesAndHonorExplicitOptionals() {
        val defaults = PhoneToolsPolicy.eventOptionalFields(null, null, null, null)
        assertFalse(defaults.allDay)
        assertEquals(mapOf("allDay" to 0, "description" to "", "eventLocation" to ""), writes(defaults))
        val provided = PhoneToolsPolicy.eventOptionalFields(null, true, "Notes", "Place")
        assertTrue(provided.allDay)
        assertEquals(mapOf("allDay" to 1, "description" to "Notes", "eventLocation" to "Place"), writes(provided))
    }
    @Test fun recurrenceDetectionIncludesDetachedExceptionsAndSeriesMetadata() {
        val columns = PhoneToolsPolicy.recurrenceColumns
        assertTrue(columns.containsAll(listOf("rrule", "rdate", "original_id", "original_sync_id", "originalInstanceTime")))
        assertFalse(PhoneToolsPolicy.recurring(List(columns.size) { null }))
        assertFalse(PhoneToolsPolicy.recurring(List(columns.size) { "" }))
        for (index in columns.indices) {
            assertTrue(columns[index], PhoneToolsPolicy.recurring(List(columns.size) { if (it == index) "123" else null }))
        }
    }
}
