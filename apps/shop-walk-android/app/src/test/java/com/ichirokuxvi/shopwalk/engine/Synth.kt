package com.ichirokuxvi.shopwalk.engine

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * Builds synthetic walks for the tests: a phone lying flat, stepping at 2 Hz, turning on the
 * spot around the vertical. Every stream the engine reads is written consistently.
 */
class Synth(
    /** Compass bearing, degrees, of device +y at the start. */
    private val startBearingDeg: Double = 0.0,
    private val stepAmplitude: Double = 3.0,
) {
    private val motion = ArrayList<DoubleArray>()
    private val game = ArrayList<DoubleArray>()
    private val absolute = ArrayList<DoubleArray>()
    private val steps = ArrayList<Double>()
    val marks = ArrayList<WalkMark>()
    private var tick = 0
    /** Yaw so far, radians, counter clockwise from above (a left turn is positive). */
    private var yaw = 0.0

    val t: Double get() = tick * 10.0

    private fun sample(bump: Double, yawRate: Double) {
        val tt = t
        motion.add(doubleArrayOf(tt, 0.0, 0.0, 9.81 + bump, 0.0, 0.0, yawRate))
        if (tick % 2 == 0) {
            game.add(quatZ(tt, yaw))
            absolute.add(quatZ(tt, yaw - Math.toRadians(startBearingDeg)))
        }
        tick++
        yaw += yawRate * 0.01
    }

    private fun quatZ(tt: Double, a: Double) = doubleArrayOf(tt, 0.0, 0.0, sin(a / 2), cos(a / 2))

    fun rest(ms: Int): Synth {
        repeat(ms / 10) { sample(0.0, 0.0) }
        return this
    }

    fun walk(stepCount: Int): Synth {
        val n = stepCount * 50
        for (k in 0 until n) {
            val tau = k * 0.01
            val bump = stepAmplitude * sin(2 * PI * 2 * tau)
            // The hardware detector fires at each positive peak.
            if (k % 50 == 12) steps.add(t)
            sample(bump, 0.0)
        }
        return this
    }

    /** Turns on the spot by [deg] over one second, left positive. */
    fun turn(deg: Double): Synth {
        val rate = Math.toRadians(deg)
        repeat(100) { sample(0.0, rate) }
        return this
    }

    fun mark(kind: String, label: String? = null): Synth {
        marks.add(WalkMark(t, kind, label))
        return this
    }

    fun build(
        origin: WalkOrigin? = null,
        location: List<DoubleArray>? = null,
        pose: List<DoubleArray>? = null,
    ): WalkFile = WalkFile(
        id = "00000000-0000-4000-8000-000000000001",
        name = "Synthetic square",
        startedAt = "2026-09-28T10:30:00.000+02:00",
        durationMs = t,
        source = WalkSource("android", "shop-walk-android", "test"),
        holding = "flat",
        settings = WalkSettings(0.7, 0.5),
        origin = origin,
        streams = WalkStreams(
            motion = motion,
            game = game,
            absolute = absolute,
            steps = steps.toDoubleArray(),
            location = location,
            pose = pose,
        ),
        marks = marks,
    )
}
