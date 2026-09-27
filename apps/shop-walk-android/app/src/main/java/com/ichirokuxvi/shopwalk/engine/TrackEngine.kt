package com.ichirokuxvi.shopwalk.engine

import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin

/** The streams the engine reads, in the order rows with the same `t` are fed. */
enum class Stream { MOTION, GAME, ABSOLUTE, STEPS, LOCATION, POSE }

/** A snapped segment between two turns (section 5.4, rule 5). */
data class Segment(val fromT: Double, val toT: Double, val headingDeg: Double, val steps: Int, val confidence: Double)

/**
 * A computed track: points `{ t, x, y }` in metres on the floor, start at the origin.
 * `rotationDeg` is the alignment rotation (section 5.6), degrees clockwise, 0 before
 * alignment and when the track never went [EngineOptions.alignMetres].
 */
class Track(
    val mode: String,
    val t: DoubleArray,
    val x: DoubleArray,
    val y: DoubleArray,
    val steps: Int,
    val turns: Int,
    val segments: List<Segment> = emptyList(),
    val rotationDeg: Double = 0.0,
    val alignedFound: Boolean = false,
) {
    val size: Int get() = t.size
}

private class Growable(cap: Int = 256) {
    var t = DoubleArray(cap)
    var x = DoubleArray(cap)
    var y = DoubleArray(cap)
    var n = 0

    fun add(tt: Double, xx: Double, yy: Double) {
        if (n == t.size) {
            val c = n * 2
            t = t.copyOf(c); x = x.copyOf(c); y = y.copyOf(c)
        }
        t[n] = tt; x[n] = xx; y[n] = yy
        n++
    }
}

/**
 * The incremental engine of recorder plan 0002: fed stream rows merged by `t`, it keeps
 * every available mode's track up to date. The recording screen feeds it live and the
 * viewer feeds it a whole file through [replay]; the two are the same code, the shape of
 * the TypeScript `createTrackEngine`.
 */
class TrackEngine(val availability: Availability, val options: EngineOptions = EngineOptions()) {

    private val own = if (availability.motion) OwnStepDetector(options) else null
    private val gyro = if (availability.heading(HeadingSource.GYRO)) GyroHeading(options) else null
    private val game = if (availability.game) RotationHeading(false) else null
    private val absolute = if (availability.absolute) RotationHeading(true) else null
    private val snappers = HashMap<HeadingSource, Snapper>()

    private class Pdr(val mode: String, val steps: StepSource, val heading: HeadingSource, val snap: Boolean) {
        val points = Growable().apply { add(0.0, 0.0, 0.0) }
        var x = 0.0
        var y = 0.0
        var count = 0
    }

    private val pdr = ArrayList<Pdr>()
    private val vio = if (availability.pose) Growable() else null
    private val gps = if (availability.location) Growable() else null
    private var vioStart: DoubleArray? = null
    private var gpsStart: DoubleArray? = null

    /** Own steps emitted so far. */
    var ownSteps = 0; private set
    /** Hardware steps seen so far. */
    var hwSteps = 0; private set
    /** The latest `t` fed. */
    var lastT = 0.0; private set

    // For a hardware step's Weinberg length: the largest and smallest `s` since the last one.
    private var hwWinMax = Double.NEGATIVE_INFINITY
    private var hwWinMin = Double.POSITIVE_INFINITY

    init {
        for (h in HeadingSource.entries) if (availability.heading(h)) snappers[h] = Snapper(options)
        for (s in StepSource.entries) for (h in HeadingSource.entries) {
            if (!availability.steps(s) || !availability.heading(h)) continue
            pdr.add(Pdr(Modes.pdr(s, h, true), s, h, true))
            pdr.add(Pdr(Modes.pdr(s, h, false), s, h, false))
        }
    }

    fun modes(): List<String> = availability.modes()

    fun push(stream: Stream, row: DoubleArray) {
        when (stream) {
            Stream.MOTION -> pushMotion(row)
            Stream.GAME -> pushRotation(row, false)
            Stream.ABSOLUTE -> pushRotation(row, true)
            Stream.STEPS -> pushStep(row[0])
            Stream.LOCATION -> pushLocation(row)
            Stream.POSE -> pushPose(row)
        }
    }

    fun pushMotion(r: DoubleArray) {
        if (r.size < 4) return
        val t = r[0]
        lastT = max(lastT, t)
        if (gyro != null && r.size >= 7) {
            gyro.push(t, r[1], r[2], r[3], r[4], r[5], r[6])
            snap(HeadingSource.GYRO, t, gyro)
        }
        val det = own ?: return
        val step = det.push(t, r[1], r[2], r[3])
        if (det.s > hwWinMax) hwWinMax = det.s
        if (det.s < hwWinMin) hwWinMin = det.s
        if (step != null) {
            ownSteps++
            val len = when (options.stepModel) {
                StepModel.FIXED -> options.stepMetres
                StepModel.WEINBERG -> weinberg(step.sMax, step.sMin)
            }
            advance(StepSource.OWN, step.t, len)
        }
    }

    private fun pushRotation(r: DoubleArray, abs: Boolean) {
        if (r.size < 5) return
        val t = r[0]
        lastT = max(lastT, t)
        val src = (if (abs) absolute else game) ?: return
        src.push(t, r[1], r[2], r[3], r[4])
        snap(if (abs) HeadingSource.ABSOLUTE else HeadingSource.GAME, t, src)
    }

    fun pushStep(t: Double) {
        lastT = max(lastT, t)
        if (!availability.steps) return
        hwSteps++
        val len = if (options.stepModel == StepModel.WEINBERG && hwWinMax >= hwWinMin) {
            weinberg(hwWinMax, hwWinMin)
        } else {
            options.stepMetres
        }
        hwWinMax = Double.NEGATIVE_INFINITY
        hwWinMin = Double.POSITIVE_INFINITY
        advance(StepSource.HW, t, len)
    }

    private fun pushLocation(r: DoubleArray) {
        if (r.size < 3) return
        val g = gps ?: return
        lastT = max(lastT, r[0])
        val start = gpsStart ?: r.also { gpsStart = it }
        val lat0 = Math.toRadians(start[1])
        val x = (r[2] - start[2]) * METRES_PER_DEGREE * cos(lat0)
        val y = (r[1] - start[1]) * METRES_PER_DEGREE
        g.add(r[0], x, y)
    }

    private fun pushPose(r: DoubleArray) {
        if (r.size < 4) return
        val v = vio ?: return
        lastT = max(lastT, r[0])
        val start = vioStart ?: r.also { vioStart = it }
        v.add(r[0], r[1] - start[1], -(r[3] - start[3]))
    }

    private fun snap(h: HeadingSource, t: Double, state: HeadingState) {
        val s = snappers[h] ?: return
        // The first heading row starts the snapper and is also its first settling sample.
        if (!s.started) s.start(state.psi)
        s.update(t, state.psi, state.rateDegPerS)
    }

    private fun weinberg(sMax: Double, sMin: Double): Double =
        options.weinbergK * max(0.0, sMax - sMin).pow(0.25)

    private fun heading(h: HeadingSource, snap: Boolean): Double {
        if (snap) return snappers[h]?.h ?: 0.0
        return when (h) {
            HeadingSource.GYRO -> gyro?.psi
            HeadingSource.GAME -> game?.psi
            HeadingSource.ABSOLUTE -> absolute?.psi
        } ?: 0.0
    }

    private fun advance(source: StepSource, t: Double, len: Double) {
        for (p in pdr) {
            if (p.steps != source) continue
            val psi = heading(p.heading, p.snap)
            p.x += len * sin(psi)
            p.y += len * cos(psi)
            p.count++
            p.points.add(t, p.x, p.y)
        }
    }

    /** The current tracks, unaligned, as copies safe to hand to another thread. */
    fun tracks(): List<Track> {
        val out = ArrayList<Track>()
        for (p in pdr) {
            val g = p.points
            val t = g.t.copyOf(g.n)
            val snapper = snappers[p.heading]
            out.add(
                Track(
                    mode = p.mode,
                    t = t,
                    x = g.x.copyOf(g.n),
                    y = g.y.copyOf(g.n),
                    steps = p.count,
                    turns = if (p.snap) snapper?.turns ?: 0 else 0,
                    segments = if (p.snap && snapper != null) segments(t, snapper) else emptyList(),
                ),
            )
        }
        vio?.let { out.add(Track(Modes.VIO, it.t.copyOf(it.n), it.x.copyOf(it.n), it.y.copyOf(it.n), 0, 0)) }
        gps?.let { out.add(Track(Modes.GPS, it.t.copyOf(it.n), it.x.copyOf(it.n), it.y.copyOf(it.n), 0, 0)) }
        val order = Modes.ALL
        out.sortBy { order.indexOf(it.mode) }
        return out
    }

    fun track(mode: String): Track? = tracks().firstOrNull { it.mode == mode }

    private fun segments(stepT: DoubleArray, s: Snapper): List<Segment> {
        val out = ArrayList<Segment>()
        var from = 0.0
        var heading = s.startHeading
        for (turn in s.turnLog) {
            out.add(segment(from, turn[0], heading, stepT))
            from = turn[0]
            heading = turn[1]
        }
        out.add(segment(from, max(lastT, stepT.lastOrNull() ?: 0.0), heading, stepT))
        return out
    }

    private fun segment(from: Double, to: Double, heading: Double, stepT: DoubleArray): Segment {
        var n = 0
        for (k in 1 until stepT.size) if (stepT[k] > from && stepT[k] <= to) n++
        val seconds = max(0.0, to - from) / 1000.0
        return Segment(from, to, Math.toDegrees(heading), n, exp(-seconds / options.confidenceTauS))
    }

    companion object {
        const val METRES_PER_DEGREE = 111320.0

        /** Replays a whole walk file: every stream merged by `t`, ties in [Stream] order. */
        fun replay(walk: WalkFile, options: EngineOptions = EngineOptions.forWalk(walk)): TrackEngine {
            val engine = TrackEngine(Availability.of(walk), options)
            val s = walk.streams
            val lists = arrayOf<List<DoubleArray>>(
                s.motion ?: emptyList(),
                s.game ?: emptyList(),
                s.absolute ?: emptyList(),
                (s.steps ?: DoubleArray(0)).map { doubleArrayOf(it) },
                s.location ?: emptyList(),
                s.pose ?: emptyList(),
            )
            val idx = IntArray(lists.size)
            val streams = Stream.entries
            while (true) {
                var best = -1
                var bestT = Double.POSITIVE_INFINITY
                for (k in lists.indices) {
                    val l = lists[k]
                    if (idx[k] < l.size) {
                        val tt = l[idx[k]][0]
                        if (tt < bestT) { bestT = tt; best = k }
                    }
                }
                if (best < 0) break
                engine.push(streams[best], lists[best][idx[best]])
                idx[best]++
            }
            return engine
        }

        @Suppress("unused")
        private fun clamp(v: Double, lo: Double, hi: Double) = min(hi, max(lo, v))
    }
}
