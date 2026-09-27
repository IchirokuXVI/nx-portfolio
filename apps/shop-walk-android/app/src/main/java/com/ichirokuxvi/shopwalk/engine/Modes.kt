package com.ichirokuxvi.shopwalk.engine

enum class StepSource(val id: String) { OWN("own"), HW("hw") }

enum class HeadingSource(val id: String) { GYRO("gyro"), GAME("game"), ABSOLUTE("absolute") }

/** The mode ids of recorder plan 0002, section 4. */
object Modes {
    const val VIO = "vio"
    const val GPS = "gps"

    fun pdr(steps: StepSource, heading: HeadingSource, snap: Boolean): String =
        "pdr:${steps.id}:${heading.id}" + if (snap) ":snap" else ""

    /**
     * Every mode id in the order the TypeScript twin lists them: vio, gps, then the PDR
     * modes with own before hw, then gyro, game, absolute, and snap before free.
     */
    val ALL: List<String> = buildList {
        add(VIO)
        add(GPS)
        for (s in StepSource.entries) for (h in HeadingSource.entries) {
            add(pdr(s, h, true))
            add(pdr(s, h, false))
        }
    }

    fun isSnap(mode: String): Boolean = mode.endsWith(":snap")

    fun isPdr(mode: String): Boolean = mode.startsWith("pdr:")
}

/** Which streams a walk has, which decides which modes are available. */
data class Availability(
    val motion: Boolean,
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
        HeadingSource.GYRO -> motion
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
        /** A stream counts when it has at least one row, as in the TypeScript twin. */
        fun of(walk: WalkFile): Availability {
            val s = walk.streams
            return Availability(
                motion = !s.motion.isNullOrEmpty(),
                game = !s.game.isNullOrEmpty(),
                absolute = !s.absolute.isNullOrEmpty(),
                steps = (s.steps?.size ?: 0) > 0,
                pose = !s.pose.isNullOrEmpty(),
                location = !s.location.isNullOrEmpty(),
            )
        }
    }
}
