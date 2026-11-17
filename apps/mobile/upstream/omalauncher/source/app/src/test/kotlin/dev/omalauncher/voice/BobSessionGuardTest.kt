package dev.omalauncher.voice

import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BobSessionGuardTest {
    private val gate = BobSessionGuard()
    @Test fun unpairedOrUncheckedStateCannotSubmitOrPick() {
        assertFalse(gate.canSubmit)
        assertNull(gate.page())
        gate.reported(false)
        assertTrue(gate.canSubmit)
    }
    @Test fun aMetadataPickerBlocksVoiceWithoutChangingTheRoute() {
        gate.reported(false)
        assertNotNull(gate.page())
        assertFalse(gate.canSubmit)
        gate.dismiss()
        assertTrue(gate.canSubmit)
    }
    @Test fun previousPageCallbacksCannotReplaceTheCurrentPage() {
        gate.reported(false)
        val old = gate.page()!!
        val current = gate.page()!!
        assertFalse(gate.current(old))
        assertTrue(gate.current(current))
    }
    @Test fun resetInvalidatesCallbacksFromThePreviousProcess() {
        gate.reported(false)
        val old = gate.page()!!
        gate.reset()
        gate.reported(false)
        gate.page()
        assertFalse(gate.current(old))
    }
    @Test fun selectionBlocksBothSpeechAndAnotherSelection() {
        gate.reported(false)
        gate.page()
        assertNotNull(gate.choose())
        assertFalse(gate.canSubmit)
        assertFalse(gate.canChange)
        assertNull(gate.choose())
    }
    @Test fun successfulSelectionCanBeCommittedOnlyOnce() {
        gate.reported(false)
        gate.page()
        val ticket = gate.choose()!!
        assertTrue(gate.selected(ticket, true))
        assertTrue(gate.canSubmit)
        assertFalse(gate.selected(ticket, true))
    }
    @Test fun aTimeoutOrFailureBlocksPromptsAndLateSuccess() {
        gate.reported(false)
        gate.page()
        val ticket = gate.choose()!!
        assertTrue(gate.selected(ticket, false))
        assertFalse(gate.canSubmit)
        assertFalse(gate.selected(ticket, true))
        gate.reported(false)
        assertFalse(gate.canSubmit)
        gate.reset()
        gate.reported(false)
        assertTrue(gate.canSubmit)
    }
    @Test fun dismissalDuringSelectionDoesNotRestoreUnsafeSpeech() {
        gate.reported(false)
        gate.page()
        val ticket = gate.choose()!!
        gate.dismiss()
        assertFalse(gate.canSubmit)
        assertFalse(gate.selected(ticket, true))
    }
    @Test fun unresolvedRecoveryBlocksNewSelectionAndOrdinaryMessages() {
        gate.reported(true)
        assertTrue(gate.ready)
        assertFalse(gate.canSubmit)
        assertFalse(gate.canChange)
        assertNull(gate.page())
        gate.reported(false)
        assertTrue(gate.canSubmit)
    }
    @Test fun settlementWaitsForAConfirmedStateRefresh() {
        gate.reported(false)
        gate.refreshing()
        assertFalse(gate.canSubmit)
        gate.reported(true)
        assertFalse(gate.canSubmit)
        gate.reported(false)
        assertTrue(gate.canSubmit)
    }
}
