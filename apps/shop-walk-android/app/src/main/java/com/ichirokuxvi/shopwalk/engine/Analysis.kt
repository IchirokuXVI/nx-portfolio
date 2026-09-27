package com.ichirokuxvi.shopwalk.engine

import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.sin

/** Alignment, recorder plan 0002, section 5.6. */
object Alignment {

    /**
     * Rotates the track around its first point so that its first point at least [metres]
     * from there lies on +y: `rotation = atan2(p.x, p.y)`, applied counterclockwise. A
     * track that never goes that far is returned unrotated. The rotation is kept on it.
     */
    fun align(track: Track, metres: Double = 3.0): Track {
        if (track.size == 0) return track
        val x0 = track.x[0]
        val y0 = track.y[0]
        var found = -1
        for (k in 0 until track.size) {
            if (hypot(track.x[k] - x0, track.y[k] - y0) >= metres) { found = k; break }
        }
        if (found < 0) return track
        val rotation = atan2(track.x[found] - x0, track.y[found] - y0)
        val c = cos(rotation)
        val s = sin(rotation)
        val xs = DoubleArray(track.size)
        val ys = DoubleArray(track.size)
        for (k in 0 until track.size) {
            val dx = track.x[k] - x0
            val dy = track.y[k] - y0
            xs[k] = x0 + dx * c - dy * s
            ys[k] = y0 + dx * s + dy * c
        }
        return Track(track.mode, track.t, xs, ys, track.steps, track.turns, track.segments, rotation, track.northUp)
    }
}

/** A checkpoint label marked more than once, and the largest distance between its marks. */
data class CheckpointError(val label: String, val count: Int, val errorMetres: Double)

/** The metrics of recorder plan 0002, section 6, for one track. */
data class TrackMetrics(
    val mode: String,
    val steps: Int,
    val turns: Int,
    val distanceMetres: Double,
    val endToStartMetres: Double,
    val checkpoints: List<CheckpointError>,
) {
    fun checkpoint(label: String): Double? = checkpoints.firstOrNull { it.label == label }?.errorMetres
}

object Metrics {

    /** The index of the track point at or before [t]; the first point when [t] is before every point. */
    fun positionAt(track: Track, t: Double): Int {
        if (track.size == 0) return -1
        if (t < track.t[0]) return 0
        var lo = 0
        var hi = track.size - 1
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
     * Checkpoints group by their label exactly as written (no label groups under ""), in
     * the order each label first appears, and only labels marked at least twice count.
     */
    fun checkpoints(track: Track, marks: List<WalkMark>): List<CheckpointError> {
        val groups = LinkedHashMap<String, MutableList<Int>>()
        for (m in marks) {
            if (m.kind != WalkMark.CHECKPOINT) continue
            groups.getOrPut(m.label ?: "") { ArrayList() }.add(positionAt(track, m.t))
        }
        val out = ArrayList<CheckpointError>()
        if (track.size == 0) return out
        for ((label, idx) in groups) {
            if (idx.size < 2) continue
            var worst = 0.0
            for (a in idx.indices) for (b in a + 1 until idx.size) {
                worst = max(worst, hypot(track.x[idx[a]] - track.x[idx[b]], track.y[idx[a]] - track.y[idx[b]]))
            }
            out.add(CheckpointError(label, idx.size, worst))
        }
        return out
    }

    fun of(track: Track, marks: List<WalkMark>): TrackMetrics = TrackMetrics(
        mode = track.mode,
        steps = track.steps,
        turns = track.turns,
        distanceMetres = distance(track),
        endToStartMetres = endToStart(track),
        checkpoints = checkpoints(track, marks),
    )
}

/** Every mode of one walk, computed, aligned and measured, plus the export bearing. */
class TrackSet(val walk: WalkFile, val options: EngineOptions, val tracks: List<Track>) {
    val metrics: List<TrackMetrics> = tracks.map { Metrics.of(it, walk.marks) }

    fun track(mode: String): Track? = tracks.firstOrNull { it.mode == mode }

    /**
     * Degrees clockwise from north of the aligned +y axis (section 3): the bearing of the
     * first of `pdr:own:absolute` and `gps` the file can compute, else 0.
     */
    val bearingDeg: Double = run {
        for (m in BEARING_MODES) {
            val t = track(m) ?: continue
            return@run t.bearingDeg ?: continue
        }
        0.0
    }

    companion object {
        val BEARING_MODES = listOf(Modes.pdr(StepSource.OWN, HeadingSource.ABSOLUTE, false), Modes.GPS)

        fun compute(walk: WalkFile, options: EngineOptions = EngineOptions.forWalk(walk)): TrackSet {
            val engine = TrackEngine.replay(walk, options)
            return TrackSet(walk, options, engine.tracks().map { Alignment.align(it, options.alignMetres) })
        }

        fun normaliseDeg(d: Double): Double {
            val r = d % 360.0
            return if (r < 0) r + 360.0 else r
        }
    }
}
