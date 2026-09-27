package com.ichirokuxvi.shopwalk.engine

/**
 * A small JSON reader and writer with no Android imports, so the walk file can be read
 * and written in plain JVM unit tests (org.json is stubbed there).
 *
 * Values read are: Map<String, Any?> (insertion ordered), List<Any?>, DoubleArray (an
 * array whose elements are all numbers, which is what every stream row is), Double,
 * String, Boolean and null. An empty array reads as an empty DoubleArray.
 */
object Json {

    class ParseException(message: String) : RuntimeException(message)

    fun parse(text: String): Any? {
        val p = Parser(text)
        p.skipWs()
        val v = p.value()
        p.skipWs()
        if (p.i != text.length) throw ParseException("Trailing characters at ${p.i}")
        return v
    }

    private class Parser(val s: String) {
        var i = 0

        fun skipWs() {
            while (i < s.length) {
                val c = s[i]
                if (c == ' ' || c == '\n' || c == '\r' || c == '\t' || c.code == 0xFEFF) i++ else break
            }
        }

        fun value(): Any? {
            if (i >= s.length) throw ParseException("Unexpected end")
            return when (val c = s[i]) {
                '{' -> obj()
                '[' -> arr()
                '"' -> str()
                't' -> literal("true", true)
                'f' -> literal("false", false)
                'n' -> literal("null", null)
                else -> if (c == '-' || c in '0'..'9') num() else throw ParseException("Unexpected '$c' at $i")
            }
        }

        fun literal(word: String, v: Any?): Any? {
            if (!s.startsWith(word, i)) throw ParseException("Bad literal at $i")
            i += word.length
            return v
        }

        fun obj(): Map<String, Any?> {
            i++
            val m = LinkedHashMap<String, Any?>()
            skipWs()
            if (i < s.length && s[i] == '}') { i++; return m }
            while (true) {
                skipWs()
                if (i >= s.length || s[i] != '"') throw ParseException("Expected key at $i")
                val k = str()
                skipWs()
                if (i >= s.length || s[i] != ':') throw ParseException("Expected ':' at $i")
                i++
                skipWs()
                m[k] = value()
                skipWs()
                if (i >= s.length) throw ParseException("Unexpected end in object")
                when (s[i]) {
                    ',' -> i++
                    '}' -> { i++; return m }
                    else -> throw ParseException("Expected ',' or '}' at $i")
                }
            }
        }

        fun arr(): Any {
            i++
            skipWs()
            if (i < s.length && s[i] == ']') { i++; return DoubleArray(0) }
            // Fast path: an array of numbers becomes a DoubleArray.
            val start = i
            var nums = DoubleArray(8)
            var n = 0
            var allNumbers = true
            while (true) {
                skipWs()
                if (i >= s.length) throw ParseException("Unexpected end in array")
                val c = s[i]
                if (c == '-' || c in '0'..'9') {
                    if (n == nums.size) nums = nums.copyOf(n * 2)
                    nums[n++] = num()
                } else {
                    allNumbers = false
                    break
                }
                skipWs()
                if (i >= s.length) throw ParseException("Unexpected end in array")
                when (s[i]) {
                    ',' -> i++
                    ']' -> { i++; return nums.copyOf(n) }
                    else -> throw ParseException("Expected ',' or ']' at $i")
                }
            }
            if (!allNumbers) {
                i = start
                val list = ArrayList<Any?>()
                while (true) {
                    skipWs()
                    list.add(value())
                    skipWs()
                    if (i >= s.length) throw ParseException("Unexpected end in array")
                    when (s[i]) {
                        ',' -> i++
                        ']' -> { i++; return list }
                        else -> throw ParseException("Expected ',' or ']' at $i")
                    }
                }
            }
            throw IllegalStateException()
        }

        fun num(): Double {
            val start = i
            if (s[i] == '-') i++
            while (i < s.length) {
                val c = s[i]
                if (c in '0'..'9' || c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-') i++ else break
            }
            return s.substring(start, i).toDoubleOrNull() ?: throw ParseException("Bad number at $start")
        }

        fun str(): String {
            i++
            val sb = StringBuilder()
            while (true) {
                if (i >= s.length) throw ParseException("Unterminated string")
                val c = s[i++]
                when (c) {
                    '"' -> return sb.toString()
                    '\\' -> {
                        if (i >= s.length) throw ParseException("Bad escape")
                        when (val e = s[i++]) {
                            '"' -> sb.append('"')
                            '\\' -> sb.append('\\')
                            '/' -> sb.append('/')
                            'b' -> sb.append('\b')
                            'f' -> sb.append('\u000C')
                            'n' -> sb.append('\n')
                            'r' -> sb.append('\r')
                            't' -> sb.append('\t')
                            'u' -> {
                                if (i + 4 > s.length) throw ParseException("Bad unicode escape")
                                sb.append(s.substring(i, i + 4).toInt(16).toChar())
                                i += 4
                            }
                            else -> throw ParseException("Bad escape '$e'")
                        }
                    }
                    else -> sb.append(c)
                }
            }
        }
    }

    /** Writes a value built from the same types the reader produces, plus Number and arrays of rows. */
    fun write(value: Any?, out: Appendable) {
        when (value) {
            null -> out.append("null")
            is String -> writeString(value, out)
            is Boolean -> out.append(if (value) "true" else "false")
            is Double -> writeNumber(value, out)
            is Float -> writeNumber(value.toDouble(), out)
            is Number -> out.append(value.toString())
            is DoubleArray -> {
                out.append('[')
                for (k in value.indices) {
                    if (k > 0) out.append(',')
                    writeNumber(value[k], out)
                }
                out.append(']')
            }
            is Map<*, *> -> {
                out.append('{')
                var first = true
                for ((k, v) in value) {
                    if (v === Omit) continue
                    if (!first) out.append(',')
                    first = false
                    writeString(k.toString(), out)
                    out.append(':')
                    write(v, out)
                }
                out.append('}')
            }
            is Iterable<*> -> {
                out.append('[')
                var first = true
                for (v in value) {
                    if (!first) out.append(',')
                    first = false
                    write(v, out)
                }
                out.append(']')
            }
            is Array<*> -> write(value.asList(), out)
            else -> writeString(value.toString(), out)
        }
    }

    fun stringify(value: Any?): String = StringBuilder().also { write(value, it) }.toString()

    /** A map value that is left out when written. */
    object Omit

    fun writeNumber(d: Double, out: Appendable) {
        if (d.isNaN() || d.isInfinite()) {
            out.append("null")
            return
        }
        if (d == Math.rint(d) && Math.abs(d) < 1e15) {
            out.append(d.toLong().toString())
            return
        }
        out.append(d.toString())
    }

    fun writeString(s: String, out: Appendable) {
        out.append('"')
        for (c in s) {
            when {
                c == '"' -> out.append("\\\"")
                c == '\\' -> out.append("\\\\")
                c == '\n' -> out.append("\\n")
                c == '\r' -> out.append("\\r")
                c == '\t' -> out.append("\\t")
                c < ' ' -> out.append(String.format("\\u%04x", c.code))
                else -> out.append(c)
            }
        }
        out.append('"')
    }
}
