package com.bobmobile

import org.junit.Assert.*
import org.junit.Test

class PhoneToolsPolicyTest {
    private fun invalid(block: () -> Unit) { try { block(); fail("Accepted invalid input") } catch (_: IllegalArgumentException) {} }
    private fun date(value: String) = PhoneToolsPolicy.date(value)

    @Test fun timestampsRequireRealDatesOffsetsAndMillisecondPrecision() {
        assertEquals(date("2028-02-29T12:34:56.123Z").millis, date("2028-02-29T14:34:56.123+02:00").millis)
        assertEquals(date("2028-02-29T12:34:56.100Z").millis, date("2028-02-29T12:34:56.1Z").millis)
        assertEquals(date("2028-02-29T12:34:56.123Z").millis, date("2028-02-29T12:34:56.123000000Z").millis)
        for (value in listOf("2027-02-29T12:00:00Z", "2028-13-01T12:00:00Z", "2028-01-01T24:00:00Z", "2028-01-01T12:60:00Z", "2028-01-01T12:00:60Z", "2028-01-01", "2028-01-01T12:00:00", "2028-01-01T12:00:00+18:01", "2028-01-01T12:00:00+02:60", "2028-01-01T12:00:00.1234Z", "0000-01-01T00:00:00Z", "1500-02-29T00:00:00Z")) invalid { date(value) }
        assertEquals(86400000L, date("1582-10-05T00:00:00Z").millis - date("1582-10-04T00:00:00Z").millis)
    }
    @Test fun expandedCalendarQueriesAcceptAnyPositiveWindowThrough366Days() {
        val start = date("2028-01-01T00:00:00Z")
        for (end in listOf("2028-01-01T00:00:00.001Z", "2028-01-01T01:00:00Z", "2028-01-01T06:00:00Z", "2028-01-01T23:59:59Z", "2028-01-02T00:00:00Z", "2029-01-01T00:00:00Z")) {
            PhoneToolsPolicy.range(start, date(end), true)
        }
        invalid { PhoneToolsPolicy.range(start, start, true) }
        invalid { PhoneToolsPolicy.range(start, date("2027-12-31T23:59:59.999Z"), true) }
        invalid { PhoneToolsPolicy.range(start, date("2029-01-01T00:00:00.001Z"), true) }
    }
    @Test fun requestUtf8BudgetAcceptsFullUnicodeTextAndIsSeparateFromResultBudget() {
        for (action in listOf("clipboard_write", "share_text")) {
            val prefix = "{\"id\":\"${"a".repeat(64)}\",\"action\":\"$action\",\"parameters\":{\"text\":\""
            val suffix = "\"},\"expiresAt\":2000000000000}"
            // Full three-byte Unicode text, and the worst six-byte JSON escape per character.
            PhoneToolsPolicy.requestSize(prefix + "漢".repeat(20000) + suffix)
            PhoneToolsPolicy.requestSize(prefix + "\\u0001".repeat(20000) + suffix)
        }
        PhoneToolsPolicy.requestSize("a".repeat(131072))
        invalid { PhoneToolsPolicy.requestSize("a".repeat(131073)) }
        invalid { PhoneToolsPolicy.requestSize("漢".repeat(43691)) }
        assertEquals(131072, PhoneToolsPolicy.MAX_REQUEST_BYTES)
        assertEquals(65536, PhoneToolsPolicy.MAX_RESULT_BYTES)
    }
    @Test fun allDayEventsNeverShiftLocalMidnightOrInventTimezone() {
        val start = date("2028-01-01T00:00:00Z"); val end = date("2028-01-02T00:00:00Z")
        PhoneToolsPolicy.eventDates(start, end, "UTC", true)
        invalid { PhoneToolsPolicy.eventDates(start, end, "Europe/London", true) }
        invalid { PhoneToolsPolicy.eventDates(date("2028-01-01T00:00:00+02:00"), end, "UTC", true) }
        invalid { PhoneToolsPolicy.eventDates(date("2028-01-01T00:00:00.001Z"), end, "UTC", true) }
        invalid { PhoneToolsPolicy.eventDates(start, end, "Not/AZone", false) }
    }
    @Test fun timedOffsetsMustAgreeWithZoneIncludingDaylightSavingTransition() {
        PhoneToolsPolicy.eventDates(date("2028-03-12T01:30:00-05:00"), date("2028-03-12T03:30:00-04:00"), "America/New_York", false)
        invalid { PhoneToolsPolicy.eventDates(date("2028-07-01T12:00:00-05:00"), date("2028-07-01T13:00:00-05:00"), "America/New_York", false) }
        invalid { PhoneToolsPolicy.eventDates(date("2028-03-12T02:30:00-05:00"), date("2028-03-12T04:30:00-04:00"), "America/New_York", false) }
    }
    @Test fun listedEventTimestampsRoundTripIntoRenameValidationWithTheirActualZoneOffsets() {
        val cases = listOf(
            Triple("Africa/Johannesburg", "2026-11-05T08:00:00Z", "2026-11-05T09:00:00Z"),
            Triple("America/New_York", "2028-03-12T06:30:00Z", "2028-03-12T07:30:00Z"),
            Triple("America/New_York", "2028-11-05T05:30:00Z", "2028-11-05T06:30:00Z"),
            Triple("UTC", "2028-01-01T00:00:00Z", "2028-01-02T00:00:00Z")
        )
        for ((zone, begin, finish) in cases) {
            val start = date(begin).millis; val end = date(finish).millis
            val listedStart = PhoneToolsPolicy.timestamp(start, zone); val listedEnd = PhoneToolsPolicy.timestamp(end, zone)
            val roundStart = date(listedStart); val roundEnd = date(listedEnd)
            assertEquals(start, roundStart.millis); assertEquals(end, roundEnd.millis)
            PhoneToolsPolicy.eventDates(roundStart, roundEnd, zone, zone == "UTC")
        }
        assertEquals("2026-11-05T10:00:00.000+02:00", PhoneToolsPolicy.timestamp(date("2026-11-05T08:00:00Z").millis, "Africa/Johannesburg"))
        assertEquals("2028-03-12T01:30:00.000-05:00", PhoneToolsPolicy.timestamp(date("2028-03-12T06:30:00Z").millis, "America/New_York"))
        assertEquals("2028-03-12T03:30:00.000-04:00", PhoneToolsPolicy.timestamp(date("2028-03-12T07:30:00Z").millis, "America/New_York"))
    }
    @Test fun requestIdentityAndFingerprintCoverCompletePayload() {
        assertEquals("a".repeat(64), PhoneToolsPolicy.id("A".repeat(64)))
        invalid { PhoneToolsPolicy.id("a".repeat(63)) }; invalid { PhoneToolsPolicy.id("g".repeat(64)) }
        invalid { PhoneToolsPolicy.backend("") }; invalid { PhoneToolsPolicy.backend("backend\n") }
        PhoneToolsPolicy.backend("test-backend")
        val original = "{\"action\":\"volume_set\",\"parameters\":{\"percent\":50},\"expiresAt\":100}"
        assertEquals(64, PhoneToolsPolicy.fingerprint(original).length)
        assertEquals(PhoneToolsPolicy.fingerprint(original), PhoneToolsPolicy.fingerprint(original))
        assertNotEquals(PhoneToolsPolicy.fingerprint(original), PhoneToolsPolicy.fingerprint(original.replace("50", "60")))
        assertNotEquals(PhoneToolsPolicy.fingerprint(original), PhoneToolsPolicy.fingerprint(original.replace("100", "200")))
    }
    @Test fun expiryGuidanceNeverEncouragesRepeatingAnUncertainMutationWithANewId() {
        try { PhoneToolsPolicy.fresh(100, 100); fail("Expired request accepted") }
        catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("stored receipt"))
            assertTrue(e.message!!.contains("do not repeat"))
            assertFalse(e.message!!.contains("new request id"))
        }
    }
    @Test fun nativeEnumIsExplicitAndHasNoArbitraryExecutionOrRecoveryAction() {
        assertEquals(setOf("capabilities", "calendar_list", "calendar_events", "calendar_create", "calendar_update", "calendar_delete", "contacts_search", "apps_list", "app_launch", "alarm_set", "timer_set", "device_info", "volume_set", "torch_set", "clipboard_write", "dial", "sms_compose", "share_text", "open_settings"), PhoneToolsPolicy.actions)
        for (action in listOf("operation_status", "shell", "intent", "js", "accessibility", "sms_send", "call")) assertFalse(PhoneToolsPolicy.actions.contains(action))
        assertEquals(65536, PhoneToolsPolicy.MAX_RESULT_BYTES)
    }
}
