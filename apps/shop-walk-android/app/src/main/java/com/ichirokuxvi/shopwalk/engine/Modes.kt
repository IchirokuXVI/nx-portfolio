package com.ichirokuxvi.shopwalk.engine

enum class StepSource(val id: String) { OWN("own"), HW("hw") }

enum class HeadingSource(val id: String) { GYRO("gyro"), GAME("game"), ABSOLUTE("absolute") }

/** The mode ids of recorder plan 0002, section 4. */
object Modes {
    const val VIO = "vio"
    const val GPS = "gps"

    fun pdr(steps: StepSource, heading: HeadingSource, snap: Boolean): String =
        "pdr:${steps.id}:${heading.id}" + if (snap) ":snap" else ""

    /** Every mode id in a fixed display order: own before hw, gyro, game, absolute, snap first. */
    val ALL: List<String> = buildList {
        for (s in StepSource.entries) for (h in HeadingSource.entries) {
            add(pdr(s, h, true))
            add(pdr(s, h, false))
        }
        add(VIO)
        add(GPS)
    }

    fun isSnap(mode: String): Boolean = mode.endsWith(":snap")

    fun isPdr(mode: String): Boolean = mode.startsWith("pdr:")
}

/** Which streams a walk has, which decides which modes are available. */
data class Availability(
    val motion: Boolean,
    val gyro: Boolean,
    val game: Boolean,
    val absolute: Boolean,
    val steps: Boolean,
    val pose: Boolean,
    val location: Boolean,
) {
    fun steps(s: StepSource): Boolean = when (s) {
        StepSource.OWN -> motion
        StepSource.HW -> steps
    }

    fun heading(h: HeadingSource): Boolean = when (h) {
        HeadingSource.GYRO -> motion && gyro
        HeadingSource.GAME -> game
        HeadingSource.ABSOLUTE -> absolute
    }

    fun modes(): List<String> = Modes.ALL.filter { m ->
        when (m) {
            Modes.VIO -> pose
            Modes.GPS -> location
            else -> {
                val p = m.split(':')
                val s = StepSource.entries.first { it.id == p[1] }
                val h = HeadingSource.entries.first { it.id == p[2] }
                steps(s) && heading(h)
            }
        }
    }

    companion object {
        /**
         * A stream is available when the file carries it, even empty: a present but empty
         * `steps` means the phone had a step detector and it never fired. Gyro heading also
         * needs motion rows that carry the three rates.
         */
        fun of(walk: WalkFile): Availability {
            val s = walk.streams
            val motion = s.motion
            val gyro = motion != null && (motion.isEmpty() || motion.any { it.size >= 7 }) &&
                walk.events.none { it.kind == "sensor-missing" && it.detail?.startsWith("gyroscope") == true }
            return Availability(
                motion = motion != null,
                gyro = gyro,
                game = s.game != null,
                absolute = s.absolute != null,
                steps = s.steps != null,
                pose = s.pose != null,
                location = s.location != null,
            )
        }
    }
}
