package com.ichirokuxvi.shopwalk.engine

import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.sin

/**
 * The streams the engine reads, in the order rows with the same `t` are fed: the order
 * of the keys of `streams` in section 2 (magnetic and pressure are read by no mode).
 */
enum class Stream { MOTION, GAME, ABSOLUTE, STEPS, LOCATION, POSE }

/**
 * A stretch of a track between two turns (section 5.4, rule 5), as point indices, with
 * the confidence `exp(-seconds / 60)` over the time between its end points. A snap mode
 * closes one at each counted turn that has at least one step since the last; every other
 * mode has one.
 */
data class Segment(val fromIndex: Int, val toIndex: Int, val confidence: Double)

/**
 * A computed track: points `{ t, x, y }` in metres on the floor, start at the origin.
 * [rotation] is the alignment of section 5.6 in radians, counterclockwise positive: the
 * track's first point 3 m out was `rotation` clockwise from +y before it. 0 before
 * alignment and when the track never went 3 m.
 */
class Track(
    val mode: String,
    val t: DoubleArray,
    val x: DoubleArray,
    val y: DoubleArray,
    val steps: Int,
    val turns: Int,
    val segments: List<Segment>,
    val rotation: Double = 0.0,
    /** True for the modes whose unaligned +y is north: every absolute mode, and gps. */
    val northUp: Boolean = false,
) {
    val size: Int get() = t.size

    /** Degrees clockwise from north of the aligned +y, for a north up mode. */
    val bearingDeg: Double? get() = if (northUp) TrackSet.normaliseDeg(rotation * 180 / Math.PI) else null
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
 * viewer feeds it a whole file through [replay]; the two are the same code, and the rules
 * are the TypeScript `createTrackEngine`'s:
 *
 * - At a motion row the gyro heading and its snapper are updated first, then the own step
 *   detector runs, so a step is placed with the heading after that row.
 * - At a game or absolute row that rotation heading and its snapper are updated.
 * - A step takes the snapped heading (snap modes) or the raw one at the moment it is
 *   processed, and its point carries the step's own `t` (for an own step, the time of its
 *   largest `s`). A step before its heading source's first sample is ignored, not counted.
 * - Weinberg over a hardware step uses the largest and smallest `s` of the own detector
 *   over the motion rows since the previous hardware step, or the fixed length when there
 *   was no motion row in between.
 * - A PDR track starts at `{ t: 0, x: 0, y: 0 }`; vio and gps before their first row are
 *   that point alone.
 */
class TrackEngine(val availability: Availability, val options: EngineOptions = EngineOptions()) {

    private val own = if (availability.motion) OwnStepDetector(options) else null
    private val gyro = if (availability.heading(HeadingSource.GYRO)) GyroHeading(options) else null
    private val game = if (availability.game) RotationHeading(false) else null
    private val absolute = if (availability.absolute) RotationHeading(true) else null
    private val snappers = HashMap<HeadingSource, Snapper>()

    private inner class Pdr(val mode: String, val steps: StepSource, val heading: HeadingSource, val snap: Boolean) {
        val points = Growable().apply { add(0.0, 0.0, 0.0) }
        val segments = ArrayList<Segment>()
        var segmentStart = 0

        fun closeSegment() {
            val last = points.n - 1
            if (last <= segmentStart) return
            segments.add(segment(segmentStart, last))
            segmentStart = last
        }

        fun segment(from: Int, to: Int) =
            Segment(from, to, exp(-(points.t[to] - points.t[from]) / 1000.0 / options.confidenceTauS))

        fun allSegments(): List<Segment> {
            val last = points.n - 1
            val out = if (snap) ArrayList(segments) else ArrayList()
            val from = if (snap) segmentStart else 0
            if (last > from || out.isEmpty()) out.add(segment(from, last))
            return out
        }
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

    // For a hardware step's Weinberg length: the largest and smallest `s` since the last one.
    private var hwWinMax = Double.NEGATIVE_INFINITY
    private var hwWinMin = Double.POSITIVE_INFINITY

    init {
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
        if (gyro != null && r.size >= 7) {
            gyro.push(t, r[1], r[2], r[3], r[4], r[5], r[6])
            afterHeading(HeadingSource.GYRO, t, gyro)
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
        val src = (if (abs) absolute else game) ?: return
        src.push(r[0], r[1], r[2], r[3], r[4])
        afterHeading(if (abs) HeadingSource.ABSOLUTE else HeadingSource.GAME, r[0], src)
    }

    fun pushStep(t: Double) {
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
        val start = gpsStart ?: r.also { gpsStart = it }
        val lat0 = start[1]
        val x = (r[2] - start[2]) * METRES_PER_DEGREE * cos(lat0 * (Math.PI / 180))
        val y = (r[1] - lat0) * METRES_PER_DEGREE
        g.add(r[0], x, y)
    }

    private fun pushPose(r: DoubleArray) {
        if (r.size < 4) return
        val v = vio ?: return
        val start = vioStart ?: r.also { vioStart = it }
        v.add(r[0], r[1] - start[1], start[3] - r[3])
    }

    private fun afterHeading(h: HeadingSource, t: Double, state: HeadingState) {
        // The first heading row starts the snapper and is also its first settling sample.
        val s = snappers.getOrPut(h) { Snapper(options, state.psi) }
        if (s.update(t, state.psi, state.rate)) {
            for (p in pdr) if (p.snap && p.heading == h) p.closeSegment()
        }
    }

    private fun weinberg(sMax: Double, sMin: Double): Double =
        options.weinbergK * max(0.0, sMax - sMin).pow(0.25)

    private fun headingState(h: HeadingSource): HeadingState? = when (h) {
        HeadingSource.GYRO -> gyro
        HeadingSource.GAME -> game
        HeadingSource.ABSOLUTE -> absolute
    }

    private fun advance(source: StepSource, t: Double, len: Double) {
        for (p in pdr) {
            if (p.steps != source) continue
            val state = headingState(p.heading) ?: continue
            if (!state.started) continue
            val psi = if (p.snap) snappers[p.heading]?.h ?: state.psi else state.psi
            val g = p.points
            val lx = g.x[g.n - 1]
            val ly = g.y[g.n - 1]
            g.add(t, lx + len * sin(psi), ly + len * cos(psi))
        }
    }

    private fun direct(mode: String, g: Growable, northUp: Boolean): Track {
        if (g.n == 0) {
            return Track(mode, doubleArrayOf(0.0), doubleArrayOf(0.0), doubleArrayOf(0.0), 0, 0, listOf(Segment(0, 0, 1.0)), 0.0, northUp)
        }
        return Track(mode, g.t.copyOf(g.n), g.x.copyOf(g.n), g.y.copyOf(g.n), 0, 0, listOf(Segment(0, g.n - 1, 1.0)), 0.0, northUp)
    }

    /** The current tracks, unaligned, as copies safe to hand to another thread. */
    fun tracks(): List<Track> {
        val out = ArrayList<Track>()
        vio?.let { out.add(direct(Modes.VIO, it, false)) }
        gps?.let { out.add(direct(Modes.GPS, it, true)) }
        for (p in pdr) {
            val g = p.points
            out.add(
                Track(
                    mode = p.mode,
                    t = g.t.copyOf(g.n),
                    x = g.x.copyOf(g.n),
                    y = g.y.copyOf(g.n),
                    steps = g.n - 1,
                    turns = if (p.snap) snappers[p.heading]?.turns ?: 0 else 0,
                    segments = p.allSegments(),
                    northUp = p.heading == HeadingSource.ABSOLUTE,
                ),
            )
        }
        return out
    }

    fun track(mode: String): Track? = tracks().firstOrNull { it.mode == mode }

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
                var bestT = 0.0
                for (k in lists.indices) {
                    val l = lists[k]
                    if (idx[k] >= l.size) continue
                    val tt = l[idx[k]][0]
                    if (best == -1 || tt < bestT) { bestT = tt; best = k }
                }
                if (best < 0) break
                engine.push(streams[best], lists[best][idx[best]])
                idx[best]++
            }
            return engine
        }
    }
}
