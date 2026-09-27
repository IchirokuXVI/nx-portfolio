package com.ichirokuxvi.shopwalk.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin

class StepDetectorTest {

    private fun run(samples: (Double) -> Double, ms: Int): List<OwnStep> {
        val d = OwnStepDetector(EngineOptions())
        val out = ArrayList<OwnStep>()
        var t = 0.0
        while (t < ms) {
            d.push(t, 0.0, 0.0, samples(t))?.let { out.add(it) }
            t += 10.0
        }
        return out
    }

    @Test
    fun countsOneStepPerCycleAt2Hz() {
        // Two seconds still, then ten cycles at 2 Hz, then still.
        val steps = run({ t -> if (t >= 2000 && t < 7000) 9.81 + 3 * sin(2 * PI * 2 * (t - 2000) / 1000) else 9.81 }, 9000)
        assertEquals(10, steps.size)
        for (k in 1 until steps.size) assertTrue(steps[k].t - steps[k - 1].t >= 280)
        for (s in steps) assertTrue(s.sMax > s.sMin)
    }

    @Test
    fun emitsNothingInTheFirstSecond() {
        val steps = run({ t -> 9.81 + 3 * sin(2 * PI * 2 * t / 1000) }, 3000)
        assertTrue(steps.all { it.t >= 1000 })
        assertTrue(steps.isNotEmpty())
    }

    @Test
    fun dropsAStepCloserThan280msToThePrevious() {
        // Cycles at 5 Hz: peaks 200 ms apart, so every other one is dropped.
        val steps = run({ t -> if (t >= 2000) 9.81 + 4 * sin(2 * PI * 5 * (t - 2000) / 1000) else 9.81 }, 6000)
        for (k in 1 until steps.size) assertTrue(steps[k].t - steps[k - 1].t >= 280)
        assertTrue(steps.size in 5..11)
    }

    @Test
    fun stillPhoneHasNoSteps() {
        assertEquals(0, run({ 9.81 }, 5000).size)
    }
}

class HeadingTest {

    @Test
    fun gyroLeftTurnDecreasesHeadingFlat() {
        val g = GyroHeading(EngineOptions())
        var t = 0.0
        // A left turn of 90 degrees over one second, phone flat: rotation about +z.
        repeat(101) {
            g.push(t, 0.0, 0.0, 9.81, 0.0, 0.0, if (t > 0) PI / 2 else 0.0)
            t += 10.0
        }
        assertEquals(-PI / 2, g.psi, 1e-9)
    }

    @Test
    fun gyroProjectsOnGravityWhenUpright() {
        val g = GyroHeading(EngineOptions())
        var t = 0.0
        // Upright: gravity along device +y; a right turn is a negative rate about +y.
        repeat(101) {
            g.push(t, 0.0, 9.81, 0.0, 0.3, if (t > 0) -PI / 2 else 0.0, 0.2)
            t += 10.0
        }
        assertEquals(PI / 2, g.psi, 1e-9)
    }

    private fun qz(a: Double) = doubleArrayOf(0.0, 0.0, sin(a / 2), cos(a / 2))

    @Test
    fun gameFollowsTheYawOfEachIncrement() {
        val h = RotationHeading(false)
        for (k in 0..50) {
            val q = qz(Math.toRadians(90.0) * k / 50)
            h.push(k * 20.0, q[0], q[1], q[2], q[3])
        }
        assertEquals(-PI / 2, h.psi, 1e-9)
        assertEquals(0.0, RotationHeading(false).apply { push(0.0, 0.1, 0.2, 0.3, 0.9) }.psi, 0.0)
    }

    @Test
    fun absoluteStartsAtTheForwardBearing() {
        // Device +y rotated 90 degrees clockwise from north points east.
        val q = qz(Math.toRadians(-90.0))
        val h = RotationHeading(true)
        h.push(0.0, q[0], q[1], q[2], q[3])
        assertEquals(PI / 2, h.psi, 1e-9)
        // Identity: +y points north.
        assertEquals(0.0, Quat.forwardBearing(0.0, 0.0, 0.0, 1.0), 1e-12)
    }

    @Test
    fun absoluteUsesMinusZWhenUpright() {
        // Upright facing north: device +y up, device -z north. That is a +90 degree
        // rotation about world east (x).
        val a = Math.toRadians(90.0)
        val b = Quat.forwardBearing(sin(a / 2), 0.0, 0.0, cos(a / 2))
        assertEquals(0.0, b, 1e-9)
        // Then turned to face west: a further +90 degree rotation about world up.
        val qUp = doubleArrayOf(0.0, 0.0, sin(a / 2), cos(a / 2))
        val qE = doubleArrayOf(sin(a / 2), 0.0, 0.0, cos(a / 2))
        val q = mul(qUp, qE)
        assertEquals(-PI / 2, Quat.forwardBearing(q[0], q[1], q[2], q[3]), 1e-9)
    }

    private fun mul(a: DoubleArray, b: DoubleArray): DoubleArray {
        val (ax, ay, az, aw) = a.toList()
        val (bx, by, bz, bw) = b.toList()
        return doubleArrayOf(
            aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz,
        )
    }
}

class SnapTest {

    @Test
    fun snapsA75DegreeTurnTo90AndDiscardsTheResidue() {
        val s = Snapper(EngineOptions())
        s.start(0.0)
        var t = 0.0
        var psi = 0.0
        // Turning at 75 deg/s for one second, then still.
        repeat(100) { psi += Math.toRadians(0.75); s.update(t, psi, 75.0); t += 10.0 }
        assertEquals(0, s.turns)
        repeat(39) { s.update(t, psi, 0.0); t += 10.0 }
        assertEquals(0, s.turns) // settled needs 400 ms
        repeat(2) { s.update(t, psi, 0.0); t += 10.0 }
        assertEquals(1, s.turns)
        assertEquals(PI / 2, s.h, 1e-12)
        assertEquals(psi, s.psiRef, 0.0)
    }

    @Test
    fun ignoresA50DegreeWiggle() {
        val s = Snapper(EngineOptions())
        s.start(0.0)
        var t = 0.0
        repeat(200) { s.update(t, Math.toRadians(50.0), 0.0); t += 10.0 }
        assertEquals(0, s.turns)
        assertEquals(0.0, s.h, 0.0)
    }

    @Test
    fun a150DegreeTurnIsTwoQuarters() {
        val s = Snapper(EngineOptions())
        s.start(0.0)
        var t = 0.0
        repeat(100) { s.update(t, -Math.toRadians(150.0), 0.0); t += 10.0 }
        assertEquals(1, s.turns)
        assertEquals(-PI, s.h, 1e-12)
    }
}

class AlignmentAndMetricsTest {

    private fun track(vararg pts: Double, mode: String = "m"): Track {
        val n = pts.size / 3
        return Track(mode, DoubleArray(n) { pts[it * 3] }, DoubleArray(n) { pts[it * 3 + 1] }, DoubleArray(n) { pts[it * 3 + 2] }, n - 1, 0)
    }

    @Test
    fun rotatesTheFirstPointBeyond3MetresOntoPlusY() {
        val t = track(0.0, 0.0, 0.0, 1.0, 1.0, 0.0, 2.0, 2.5, 0.0, 3.0, 4.0, 0.0, 4.0, 4.0, 3.0)
        val a = Alignment.align(t)
        assertTrue(a.alignedFound)
        assertEquals(90.0, a.rotationDeg, 1e-9)
        assertEquals(0.0, a.x[2], 1e-9)
        assertEquals(2.5, a.y[2], 1e-9)
        assertEquals(-3.0, a.x[4], 1e-9)
        assertEquals(4.0, a.y[4], 1e-9)
    }

    @Test
    fun leavesAShortTrackAlone() {
        val t = track(0.0, 0.0, 0.0, 1.0, 2.0, 0.0)
        val a = Alignment.align(t)
        assertEquals(0.0, a.rotationDeg, 0.0)
        assertEquals(2.0, a.x[1], 0.0)
    }

    @Test
    fun metricsOfASquare() {
        val t = track(0.0, 0.0, 0.0, 1000.0, 0.0, 4.0, 2000.0, 4.0, 4.0, 3000.0, 4.0, 0.0, 4000.0, 0.5, 0.0)
        val marks = listOf(
            WalkMark(0.0, WalkMark.CHECKPOINT, "door"),
            WalkMark(1500.0, WalkMark.CHECKPOINT, " door "),
            WalkMark(4500.0, WalkMark.CHECKPOINT, "door"),
            WalkMark(2500.0, WalkMark.CHECKPOINT, "fish"),
            WalkMark(3500.0, WalkMark.CHECKPOINT, null),
        )
        val m = Metrics.of(t, marks)
        assertEquals(15.5, m.distanceMetres, 1e-9)
        assertEquals(0.5, m.endToStartMetres, 1e-9)
        assertEquals(setOf("door"), m.checkpointErrors.keys)
        assertEquals(hypot(0.5, 4.0), m.checkpointErrors["door"]!!, 1e-9)
        assertEquals(0, Metrics.positionAt(t, -5.0))
        assertEquals(1, Metrics.positionAt(t, 1999.9))
        assertEquals(2, Metrics.positionAt(t, 2000.0))
    }
}

class TrackEngineTest {

    private fun square(): WalkFile = Synth(startBearingDeg = 30.0)
        .rest(2000)
        .mark(WalkMark.CHECKPOINT, "door")
        .walk(10).rest(500).turn(90.0).rest(1000)
        .walk(10).rest(500).turn(90.0).rest(1000)
        .walk(10).rest(500).turn(90.0).rest(1000)
        .walk(10).rest(1000)
        .mark(WalkMark.CHECKPOINT, "door")
        .build()

    @Test
    fun aSquareWalkClosesInEverySnapMode() {
        val set = TrackSet.compute(square())
        assertEquals(12, set.tracks.size)
        for (tr in set.tracks) {
            assertEquals(tr.mode, 40, tr.steps)
            val m = set.metrics.first { it.mode == tr.mode }
            if (Modes.isSnap(tr.mode)) {
                assertEquals(tr.mode, 3, tr.turns)
                assertEquals(tr.mode, 4, tr.segments.size)
                assertEquals(tr.mode, 0.0, m.endToStartMetres, 1e-6)
                assertEquals(tr.mode, 0.0, m.checkpointErrors["door"]!!, 1e-6)
            } else {
                assertEquals(tr.mode, 0, tr.turns)
                assertTrue(tr.mode, m.endToStartMetres < 0.5)
            }
            assertEquals(tr.mode, 28.0, m.distanceMetres, 1e-6)
        }
        // Left turns: aligned, the square goes up +y then to -x.
        val g = set.track("pdr:own:gyro:snap")!!
        assertEquals(0.0, g.x[10], 1e-9)
        assertEquals(7.0, g.y[10], 1e-9)
        assertEquals(-7.0, g.x[20], 1e-9)
        assertEquals(30.0, set.bearingDeg, 1e-6)
    }

    @Test
    fun liveFeedingEqualsReplay() {
        val walk = square()
        val replay = TrackEngine.replay(walk).tracks()
        val live = TrackEngine(Availability.of(walk), EngineOptions.forWalk(walk))
        val rows = ArrayList<Pair<Stream, DoubleArray>>()
        walk.streams.motion!!.forEach { rows.add(Stream.MOTION to it) }
        walk.streams.game!!.forEach { rows.add(Stream.GAME to it) }
        walk.streams.absolute!!.forEach { rows.add(Stream.ABSOLUTE to it) }
        walk.streams.steps!!.forEach { rows.add(Stream.STEPS to doubleArrayOf(it)) }
        rows.sortWith(compareBy({ it.second[0] }, { it.first.ordinal }))
        rows.forEach { live.push(it.first, it.second) }
        val l = live.tracks()
        assertEquals(replay.size, l.size)
        for (k in replay.indices) {
            assertEquals(replay[k].mode, l[k].mode)
            assertTrue(replay[k].x.contentEquals(l[k].x))
            assertTrue(replay[k].y.contentEquals(l[k].y))
        }
    }

    @Test
    fun weinbergChangesTheLength() {
        val walk = square()
        val w = TrackSet.compute(walk, EngineOptions.forWalk(walk).copy(stepModel = StepModel.WEINBERG, weinbergK = 0.5))
        val d = w.metrics.first { it.mode == "pdr:own:gyro:snap" }.distanceMetres
        assertTrue(d > 0 && abs(d - 28.0) > 0.01)
        assertTrue(w.metrics.first { it.mode == "pdr:own:gyro:snap" }.endToStartMetres < 0.5)
    }

    @Test
    fun vioAndGpsProjectTheirStreams() {
        val pose = listOf(
            doubleArrayOf(0.0, 1.0, 1.5, 2.0, 0.0, 0.0, 0.0, 1.0),
            doubleArrayOf(100.0, 1.0, 1.5, -2.0, 0.0, 0.0, 0.0, 1.0),
        )
        val loc = listOf(
            doubleArrayOf(0.0, 40.0, -3.0, 10.0),
            doubleArrayOf(1000.0, 40.0 + 10.0 / 111320, -3.0, 10.0),
        )
        val walk = Synth().rest(2000).build(location = loc, pose = pose)
        val set = TrackSet.compute(walk)
        val vio = TrackEngine.replay(walk).track(Modes.VIO)!!
        assertEquals(0.0, vio.x[1], 1e-12)
        assertEquals(4.0, vio.y[1], 1e-12)
        val gps = set.track(Modes.GPS)!!
        assertEquals(10.0, hypot(gps.x[1], gps.y[1]), 1e-6)
        assertEquals(0, gps.steps)
        // A gps track that walked north has bearing 0; absolute went nowhere.
        assertEquals(0.0, set.bearingDeg, 1e-6)
    }

    @Test
    fun modesFollowTheStreams() {
        val walk = Synth().rest(100).build()
        val bare = walk.copy(streams = WalkStreams(steps = DoubleArray(0), game = emptyList()))
        assertEquals(listOf("pdr:hw:game:snap", "pdr:hw:game"), Availability.of(bare).modes())
        assertNull(TrackSet.compute(bare).track("pdr:own:gyro"))
        assertNotNull(TrackSet.compute(walk).track("pdr:own:gyro"))
    }
}
