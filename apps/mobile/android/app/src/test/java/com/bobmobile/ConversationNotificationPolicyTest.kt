package com.bobmobile

import org.junit.Assert.*
import org.junit.Test

class ConversationNotificationPolicyTest {
    @Test fun identityIncludesBothBackendAndChatWithoutHashCollisions() {
        assertNotEquals(ConversationNotificationPolicy.tag("Aa", 1), ConversationNotificationPolicy.tag("BB", 1))
        assertNotEquals(ConversationNotificationPolicy.tag("backend", 1), ConversationNotificationPolicy.tag("backend", 2))
        assertEquals("conversation:backend:42", ConversationNotificationPolicy.tag("backend", 42))
    }
    @Test fun messageHistoryIsBoundedAndReceiptDeduplicated() {
        var history = emptyList<ConversationNotice>()
        for (n in 1..20) history = ConversationNotificationPolicy.append(history, ConversationNotice("reply:$n", "reply $n", n.toLong()))
        assertEquals(5, history.size); assertEquals("reply:16", history.first().id)
        history = ConversationNotificationPolicy.append(history, ConversationNotice("reply:20", "same receipt", 21))
        assertEquals(5, history.size); assertEquals(1, history.count { it.id == "reply:20" })
    }
    @Test fun labelsAndPreviewsAreBoundedAndControlCharactersCannotSpoofTitles() {
        assertEquals("Conversation 42", ConversationNotificationPolicy.title(" \n\t", 42))
        assertEquals("Job follow-ups", ConversationNotificationPolicy.title("Job\n follow-ups", 1))
        assertEquals(160, ConversationNotificationPolicy.title("a".repeat(500), 1).length)
        val value = ConversationNotificationPolicy.append(emptyList(), ConversationNotice("id", "x".repeat(10000), -1)).single()
        assertEquals(1000, value.text.length); assertEquals(0L, value.at)
    }
    @Test fun reRegistrationIsNotPairingRotationButEndpointOrCredentialChangeIs() {
        assertFalse(ConversationNotificationPolicy.changedPairing("", "", "https://bob.test", "secret"))
        assertFalse(ConversationNotificationPolicy.changedPairing("https://bob.test", "same", "https://bob.test", "same"))
        assertTrue(ConversationNotificationPolicy.changedPairing("https://bob.test", "old", "https://bob.test", "new"))
        assertTrue(ConversationNotificationPolicy.changedPairing("https://old.test", "same", "https://new.test", "same"))
    }
}
