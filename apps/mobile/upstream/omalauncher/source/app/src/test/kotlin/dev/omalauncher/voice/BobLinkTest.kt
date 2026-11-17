package dev.omalauncher.voice

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BobLinkTest {
    private val written = ArrayList<JSONObject>()
    private val link = BobLink { written += JSONObject(it) }
    private fun response(data: JSONObject, success: Boolean = true): String {
        val request = written.last()
        return JSONObject().put("type", "response").put("command", request.getString("type"))
            .put("id", request.getString("id")).put("success", success).put("data", data).toString()
    }

    private fun opened() {
        assertTrue(link.open(null).isEmpty())
        assertEquals(listOf(LinkEvent.Ready), link.read(response(JSONObject("""{"sessionFile":null,"recoveryRequired":false,"attached":false}"""))))
        written.clear()
    }

    @Test fun nativeCommandNeverCallsPiOrPhoneControlCli() {
        assertTrue(link.command(null).startsWith("exec bob-voice-agent rpc --append-system-prompt '"))
        assertFalse(link.command(null).contains("exec pi"))
        assertFalse(link.command(null).contains("127.0.0.1"))
        assertTrue(link.instructed)
        opened()
    }

    @Test fun listsOnePageWithoutSelectingOrSendingPrompt() {
        var page: BobLink.SelectionResult<BobLink.SessionPage>? = null
        link.listSessions("opaque&next") { page = it }
        assertEquals("list_sessions", written.single().getString("type"))
        assertEquals("opaque&next", written.single().getString("cursor"))
        assertTrue(link.read(response(JSONObject("""{"items":[{"id":"7","title":"Chosen chat"}],"next":"older"}"""))).isEmpty())
        val value = (page as BobLink.SelectionResult.Success).value
        assertEquals(listOf(BobLink.SessionOption("7", "Chosen chat")), value.items)
        assertEquals("older", value.next)
        assertEquals(1, written.size)
    }

    @Test fun explicitSelectionEmitsOnlyMatchingSessionAndNoSpeech() {
        opened()
        var selected: BobLink.SelectionResult<String>? = null
        link.selectSession("7") { selected = it }
        assertTrue(written.single().getBoolean("confirm"))
        assertEquals("7", written.single().getString("sessionId"))
        val events = link.read(response(JSONObject("""{"sessionFile":"bob-voice:7"}""")))
        assertTrue(events.isEmpty())
        assertEquals(BobLink.SelectionResult.Success("bob-voice:7"), selected)
    }

    @Test fun selectionFailureNeverEmitsChosenSession() {
        var selected: BobLink.SelectionResult<String>? = null
        link.selectSession("7") { selected = it }
        assertTrue(link.read(response(JSONObject("""{"sessionFile":"bob-voice:8"}"""))).isEmpty())
        assertTrue(selected is BobLink.SelectionResult.Failure)
    }

    @Test(expected = IllegalStateException::class) fun failedSelectionBlocksLaterPromptsUntilRestart() {
        opened()
        link.selectSession("7") { }
        link.read(response(JSONObject(), success = false))
        link.prompt("Never send after an unconfirmed route change")
    }

    @Test fun cannotSelectDuringVoiceTurnOrPendingSelection() {
        opened()
        link.prompt("hello")
        val count = written.size
        var result: BobLink.SelectionResult<String>? = null
        link.selectSession("7") { result = it }
        assertEquals(count, written.size)
        assertTrue(result is BobLink.SelectionResult.Failure)
        link.read(response(JSONObject().put("accepted", true)))
        link.read("""{"type":"agent_settled"}""")
        link.selectSession("7") { result = it }
        assertEquals("select_session", written.last().getString("type"))
        val selectingCount = written.size
        link.selectSession("8") { result = it }
        assertEquals(selectingCount, written.size)
        assertTrue(result is BobLink.SelectionResult.Failure)
    }

    @Test fun cancellationDropsQueuedTurnSelectionLockout() {
        opened()
        link.prompt("first")
        link.read(response(JSONObject().put("accepted", true)))
        link.prompt("queued")
        link.cancel()
        link.read("""{"type":"agent_settled","aborted":true}""")
        link.selectSession("7") { }
        assertEquals("select_session", written.last().getString("type"))
        assertEquals(1, written.count { it.optString("type") == "prompt" })
    }

    @Test fun malformedOrWrongCommandResponsesDoNotSelect() {
        var result: BobLink.SelectionResult<String>? = null
        link.selectSession("7") { result = it }
        val id = written.last().getString("id")
        assertTrue(link.read("""{"type":"response","id":"$id","command":"list_sessions","success":true,"data":{"sessionFile":"bob-voice:7"}}""").isEmpty())
        assertNull(result)
        assertTrue(link.read(response(JSONObject("""{"sessionFile":"bob-voice:7"}"""))).isEmpty())
    }

    @Test fun invalidIdsAndCursorsNeverReachTheProcess() {
        for (id in listOf("/tmp/file", "0", "-1", "9007199254740992", "7;rm -rf")) {
            link.selectSession(id) { assertTrue(it is BobLink.SelectionResult.Failure) }
        }
        link.listSessions("x".repeat(4097)) { assertTrue(it is BobLink.SelectionResult.Failure) }
        assertTrue(written.isEmpty())
    }

    @Test fun openingRequiresPairedJournalStateBeforeReady() {
        assertTrue(link.open(null).isEmpty())
        assertEquals("get_state", written.single().getString("type"))
        val events = link.read(response(JSONObject(), success = false))
        assertTrue(events.single() is LinkEvent.Failed)
        assertFalse(events.contains(LinkEvent.Ready))
    }

    @Test fun failedExplicitResumeDoesNotCreateANewConversation() {
        link.open("bob-voice:7")
        assertTrue(link.read(response(JSONObject("""{"sessionFile":null,"recoveryRequired":false,"attached":false}"""))).isEmpty())
        assertEquals("switch_session", written.last().getString("type"))
        val events = link.read(response(JSONObject(), success = false))
        assertTrue(events.single() is LinkEvent.Failed)
        assertFalse(written.any { it.optString("type") == "prompt" })
    }

    @Test fun journaledRecoveryWinsWithoutSubmittingFreshInput() {
        var state: BobLink.State? = null
        link.onState = { state = it }
        link.open("bob-voice:7")
        val events = link.read(response(JSONObject("""{"sessionFile":"bob-voice:42","recoveryRequired":true,"attached":true}""")))
        assertTrue(events.contains(LinkEvent.Ready))
        assertTrue(events.contains(LinkEvent.Session("bob-voice:42")))
        assertEquals(BobLink.State("bob-voice:42", true, true), state)
        assertFalse(written.any { it.optString("type") == "switch_session" })
        link.recover()
        assertEquals("recover", written.last().getString("type"))
        assertFalse(written.any { it.optString("type") == "prompt" })
    }

    @Test fun originalPiAndBobPromptLifecycleStayDistinct() {
        val pi = PiLink {}
        assertTrue(pi.command(null).startsWith("exec pi --mode rpc"))
        opened()
        assertTrue(link.read("""{"type":"agent_settled"}""").isEmpty())
        link.prompt("hello")
        link.read(response(JSONObject().put("accepted", true)))
        assertEquals(listOf(LinkEvent.Text("Hello from Bob.")), link.read("""{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Hello from Bob."}}"""))
        assertEquals(listOf(LinkEvent.Done()), link.read("""{"type":"agent_settled"}"""))
        assertEquals("get_state", written.last().getString("type"))
    }
}
