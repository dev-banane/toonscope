package com.example

import java.util.List
import kotlin.math.PI

/**
 * Adds two ints.
 */
fun add(a: Int, b: Int): Int {
    return a + b
}

private fun secret(): Int {
    return 0
}

class Point(val x: Int, val y: Int) {
    fun sum(): Int {
        return x + y
    }

    private fun hidden(): Int {
        return 0
    }
}

interface Shape {
    fun area(): Double
}

enum class Color { RED, GREEN, BLUE }
