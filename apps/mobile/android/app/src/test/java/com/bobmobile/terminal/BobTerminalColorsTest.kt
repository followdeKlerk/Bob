package com.bobmobile

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.pow

class BobTerminalColorsTest {
    private fun luminance(hex: String): Double {
        val rgb = listOf(1, 3, 5).map { hex.substring(it, it + 2).toInt(16) / 255.0 }
            .map { if (it <= 0.04045) it / 12.92 else ((it + 0.055) / 1.055).pow(2.4) }
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
    }
    @Test fun syntaxSlotsRemainReadableInBothBobThemes() {
        for (light in listOf(false, true)) {
            val colors = BobTerminalColors.ansi(light)
            assertEquals(16, colors.size)
            val background = luminance(if (light) "#e8dfd0" else "#000000")
            for ((name, hex) in colors) {
                assertTrue(hex.matches(Regex("#[a-f0-9]{6}")))
                // Black/white slots may deliberately be program backgrounds, not syntax text.
                if (name in listOf("black", "white", "brightWhite")) continue
                val foreground = luminance(hex)
                val contrast = (maxOf(background, foreground) + 0.05) / (minOf(background, foreground) + 0.05)
                assertTrue("$name in ${if(light) "light" else "dark"}: $contrast", contrast >= 4.5)
            }
        }
    }
    @Test fun palettesAreIndependentFromProgramTrueColors() {
        assertNotEquals(BobTerminalColors.ansi(true), BobTerminalColors.ansi(false))
        assertFalse(BobTerminalColors.ansi(true).containsKey("foreground"))
        assertFalse(BobTerminalColors.ansi(false).containsKey("background"))
    }
}
