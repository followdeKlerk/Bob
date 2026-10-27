package com.bobmobile

internal object DiagnosticPolicy {
    const val SAMPLE_LIMIT = 48
    const val CRITICAL_LIMIT = 8
    const val FAULT_LIMIT = 3
    val types = setOf("Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "URIError", "EvalError", "other")
    val sources = setOf("global", "render")
    fun coordinate(line: Long, column: Long) = line in 1..10_000_000 && column in 0..100_000_000
    fun number(value: Double, maximum: Long): Long? =
        if (value.isFinite() && value >= 0 && value <= maximum && value == value.toLong().toDouble()) value.toLong() else null
    fun <T> append(items: List<T>, item: T, limit: Int): List<T> = (items + item).takeLast(limit)
}
