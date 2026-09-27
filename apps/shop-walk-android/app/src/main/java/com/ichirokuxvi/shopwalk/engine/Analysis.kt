package com.ichirokuxvi.shopwalk.engine

import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.sin

/** Alignment, recorder plan 0002, section 5.6. */
object Alignment {

    /**
     * Rotates the track around its start so that its first point at least [metres] from the
     * start lies on +y. A track that never goes that far is returned unrotated. The rotation
     * applied, degrees clockwise, is kept on the result.
     */
    fun align(track: Track, metres: Double = 3.0): Track {
        if (track.size == 0) return track
        val x0 = track.x[0]
        val y0 = track.y[0]
        var found = -1
        for (k in 0 until track.size) {
            if (hypot(track.x[k] - x0, track.y[k] - y0) >= metres) { found = k; break }
        }
        if (found < 0) {
            return Track(track.mode, track.t, track.x, track.y, track.steps, track.turns, track.segments, 0.0, false)
        }
        val theta = atan2(track.x[found] - x0, track.y[found] - y0)
        val c = cos(theta)
        val s = sin(theta)
        val xs = DoubleArray(track.size)
        val ys = DoubleArray(track.size)
        for (k in 0 until track.size) {
            val dx = track.x[k] - x0
            val dy = track.y[k] - y0
            xs[k] = x0 + dx * c - dy * s
            ys[k] = y0 + dx * s + dy * c
        }
        return Track(track.mode, track.t, xs, ys, track.steps, track.turns, track.segments, Math.toDegrees(theta), true)
    }
}

/** The metrics of recorder plan 0002, section 6, for one track. */
data class TrackMetrics(
    val mode: String,
    val steps: Int,
    val turns: Int,
    val distanceMetres: Double,
    val endToStartMetres: Double,
    /** Per checkpoint label marked more than once, the largest distance between its marks. */
    val checkpointErrors: Map<String, Double>,
) {
    val worstCheckpointError: Double? get() = checkpointErrors.values.maxOrNull()
}

object Metrics {

    /** The track point at or before [t]; the first point when [t] is before every point. */
    fun positionAt(track: Track, t: Double): Int {
        if (track.size == 0) return -1
        var lo = 0
        var hi = track.size - 1
        if (track.t[0] > t) return 0
        while (lo < hi) {
            val mid = (lo + hi + 1) ushr 1
            if (track.t[mid] <= t) lo = mid else hi = mid - 1
        }
        return lo
    }

    fun distance(track: Track): Double {
        var d = 0.0
        for (k in 1 until track.size) d += hypot(track.x[k] - track.x[k - 1], track.y[k] - track.y[k - 1])
        return d
    }

    fun endToStart(track: Track): Double {
        if (track.size == 0) return 0.0
        val n = track.size - 1
        return hypot(track.x[n] - track.x[0], track.y[n] - track.y[0])
    }

    /**
     * Checkpoints are grouped by their label, trimmed and compared exactly. A checkpoint with
     * no label or a blank one belongs to no group.
     */
    fun checkpointErrors(track: Track, marks: List<WalkMark>): Map<String, Double> {
        val groups = LinkedHashMap<String, MutableList<Double>>()
        for (m in marks) {
            if (m.kind != WalkMark.CHECKPOINT) continue
            val label = m.label?.trim().orEmpty()
            if (label.isEmpty()) continue
            groups.getOrPut(label) { ArrayList() }.add(m.t)
        }
        val out = LinkedHashMap<String, Double>()
        if (track.size == 0) return out
        for ((label, times) in groups) {
            if (times.size < 2) continue
            val idx = times.map { positionAt(track, it) }
            var worst = 0.0
            for (a in idx.indices) for (b in a + 1 until idx.size) {
                worst = max(worst, hypot(track.x[idx[a]] - track.x[idx[b]], track.y[idx[a]] - track.y[idx[b]]))
            }
            out[label] = worst
        }
        return out
    }

    fun of(track: Track, marks: List<WalkMark>): TrackMetrics = TrackMetrics(
        mode = track.mode,
        steps = track.steps,
        turns = track.turns,
        distanceMetres = distance(track),
        endToStartMetres = endToStart(track),
        checkpointErrors = checkpointErrors(track, marks),
    )
}

/** Every mode of one walk, computed, aligned and measured, plus the export bearing. */
class TrackSet(val walk: WalkFile, val options: EngineOptions, val tracks: List<Track>) {
    val metrics: List<TrackMetrics> = tracks.map { Metrics.of(it, walk.marks) }

    fun track(mode: String): Track? = tracks.firstOrNull { it.mode == mode }

    /**
     * Degrees clockwise from north of the aligned +y axis: the alignment rotation of the
     * first of `pdr:own:absolute` and `gps` that exists and went far enough to be aligned,
     * else 0 (section 3).
     */
    val bearingDeg: Double = run {
        for (m in listOf(Modes.pdr(StepSource.OWN, HeadingSource.ABSOLUTE, false), Modes.GPS)) {
            val t = track(m) ?: continue
            if (t.alignedFound) return@run normaliseDeg(t.rotationDeg)
        }
        0.0
    }

    companion object {
        fun compute(walk: WalkFile, options: EngineOptions = EngineOptions.forWalk(walk)): TrackSet {
            val engine = TrackEngine.replay(walk, options)
            return TrackSet(walk, options, engine.tracks().map { Alignment.align(it, options.alignMetres) })
        }

        fun normaliseDeg(d: Double): Double {
            var v = d % 360.0
            if (v < 0) v += 360.0
            return v
        }
    }
}
