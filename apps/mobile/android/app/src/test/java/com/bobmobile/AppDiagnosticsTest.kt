package com.bobmobile

import org.junit.Assert.*
import org.junit.Test

class AppDiagnosticsTest {
    @Test fun onlyFixedNonContentEventsAreAccepted() {
        for (event in listOf("js.ready", "js.background", "activity.pause", "activity.back", "back.root-ignored")) assertTrue(AppDiagnostics.allowedEvent(event))
        for (event in listOf("my private message", "https://backend.ts.net", "Bearer secret", "51.5,-0.1", "js.arbitrary-message", "")) assertFalse(AppDiagnostics.allowedEvent(event))
    }
    @Test fun eventHistoryIsBoundedAndKeepsTheNewestEvents() {
        var events = emptyList<AppDiagnostics.Event>()
        for (time in 0L until 1000L) events = AppDiagnostics.append(events, AppDiagnostics.Event(time, "activity.resume"))
        assertEquals(64, events.size); assertEquals(936L, events.first().time); assertEquals(999L, events.last().time)
        assertEquals(events, AppDiagnostics.append(events, AppDiagnostics.Event(1001L, "private content")))
    }
    @Test fun knownSystemReasonsAreReportedWithoutInventingACauseForUnknownCodes() {
        assertEquals("java_crash", AppDiagnostics.reason(4)); assertEquals("native_crash", AppDiagnostics.reason(5))
        assertEquals("not_responding", AppDiagnostics.reason(6)); assertEquals("low_memory", AppDiagnostics.reason(3))
        assertEquals("package_updated", AppDiagnostics.reason(16)); assertEquals("unknown", AppDiagnostics.reason(900))
    }
}
