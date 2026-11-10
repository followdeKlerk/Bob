package com.bobmobile

import org.junit.Assert.*
import org.junit.Test

class BobTerminalConfigTest {
    private fun config(host: String = "192.0.2.1", port: Int = 60001, key: String = "abcdefghijklmnopqrstuv") =
        BobTerminalConfig(host, port, key, "backend", "conversation", "session", "Terminal", "/tmp")
    @Test fun acceptsNumericEndpointsAndMoshKeys() {
        config().validate()
        config("2001:db8::1").validate()
        config(key = "0123456789abcdef+/ABCD").validate()
    }
    @Test fun rejectsShellArgumentsHostnamesAndInvalidKeys() {
        for (host in listOf("example.com", "--help", "127.0.0.1;id", "127.0.0.1\n", "https://127.0.0.1")) {
            assertThrows(IllegalArgumentException::class.java) { config(host).validate() }
        }
        for (port in listOf(-1, 0, 65536)) assertThrows(IllegalArgumentException::class.java) { config(port = port).validate() }
        for (key in listOf("", "too-short", "abcdefghijklmnopqrstuv=", "abcdefghijklmnopqrstu\n")) {
            assertThrows(IllegalArgumentException::class.java) { config(key = key).validate() }
        }
    }
    @Test fun acceptsNumericConversationIdWithoutLoss() {
        assertEquals("42", BobTerminalConfig.conversationIdentity(42.0))
        assertEquals("9007199254740991", BobTerminalConfig.conversationIdentity(9007199254740991.0))
        for (value in listOf(0.0, -1.0, 1.5, Double.NaN, Double.POSITIVE_INFINITY, 9007199254740992.0)) {
            assertThrows(IllegalArgumentException::class.java) { BobTerminalConfig.conversationIdentity(value) }
        }
    }
    @Test fun diagnosticStringDoesNotContainSecret() {
        assertFalse(config().toString().contains("abcdefghijklmnopqrstuv"))
    }
}
