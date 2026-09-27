package com.ichirokuxvi.shopwalk.engine

import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.sqrt

/** π / 180, the same product the TypeScript twin uses. */
const val DEG = Math.PI / 180

/** A step the own detector emitted: its time and the largest and smallest `s` of 5.1. */
data class OwnStep(val t: Double, val sMax: Double, val sMin: Double)

/**
 * The own step detector of recorder plan 0002, section 5.1, fed one motion row at a time.
 *
 * Where the contract is silent this follows the rules the TypeScript twin fixed in its
 * `estimators.ts`, so both count the same steps: `s` and `b` start at the first `m`;
 * "rises above" is `s - b > 0.8` and "falls below" is `s - b < 0.2`; the row that rises
 * above is the first candidate for the largest `s`; "the smallest `s` since the previous
 * step" starts at the first `s` and is reset to the current `s` at the row that emits a
 * step, while a dropped step resets nothing; and the first second is measured from the
 * first motion row, judged on the step's own `t`.
 */
class OwnStepDetector(private val o: EngineOptions) {
    var s = 0.0; private set
    var b = 0.0; private set
    private var started = false
    private var firstT = 0.0
    private var lastT = 0.0
    private var inStep = false
    private var peakS = 0.0
    private var peakT = 0.0
    private var minS = 0.0
    private var lastEmitted = Double.NEGATIVE_INFINITY

    fun push(t: Double, ax: Double, ay: Double, az: Double): OwnStep? {
        val m = sqrt(ax * ax + ay * ay + az * az)
        if (!started) {
            started = true
            firstT = t
            s = m
            b = m
            minS = m
        } else {
            val dt = (t - lastT) / 1000.0
            s += (1 - exp(-dt / o.stepFastTauS)) * (m - s)
            b += (1 - exp(-dt / o.stepBaseTauS)) * (m - b)
        }
        lastT = t
        if (s < minS) minS = s
        val d = s - b
        if (!inStep) {
            if (d > o.stepRiseMs2) {
                inStep = true
                peakS = s
                peakT = t
            }
            return null
        }
        if (s > peakS) {
            peakS = s
            peakT = t
        }
        if (d >= o.stepFallMs2) return null
        inStep = false
        if (peakT < firstT + o.stepWarmupMs) return null
        if (peakT - lastEmitted < o.stepRefractoryMs) return null
        lastEmitted = peakT
        val step = OwnStep(peakT, peakS, minS)
        minS = s
        return step
    }
}

/** A heading source: `psi` in radians clockwise from the local +y, and |its rate| in rad/s. */
interface HeadingState {
    val started: Boolean
    val psi: Double
    val rate: Double
}

/**
 * Gyro heading, recorder plan 0002, section 5.2. At each row gravity is updated first,
 * then the yaw rate is this row's rotation rate projected on it, then `psi -= yawRate * dt`
 * with `dt` since the previous row. The first row integrates nothing.
 */
class GyroHeading(private val o: EngineOptions) : HeadingState {
    override var started = false; private set
    override var psi = 0.0; private set
    override var rate = 0.0; private set
    private var gx = 0.0
    private var gy = 0.0
    private var gz = 0.0
    private var lastT = 0.0

    fun push(t: Double, ax: Double, ay: Double, az: Double, wx: Double, wy: Double, wz: Double) {
        var dt = 0.0
        if (!started) {
            started = true
            gx = ax; gy = ay; gz = az
        } else {
            dt = (t - lastT) / 1000.0
            val k = 1 - exp(-dt / o.gravityTauS)
            gx += k * (ax - gx)
            gy += k * (ay - gy)
            gz += k * (az - gz)
        }
        lastT = t
        val gn = sqrt(gx * gx + gy * gy + gz * gz)
        val yawRate = if (gn == 0.0) 0.0 else (wx * gx + wy * gy + wz * gz) / gn
        psi -= yawRate * dt
        rate = abs(yawRate)
    }
}

/**
 * Rotation vector heading (`game`, `absolute`), recorder plan 0002, section 5.3.
 * Quaternions are `[qx, qy, qz, qw]`, normalised on the way in. The first sample sets the
 * start heading and a rate of 0; later ones turn by the yaw of `q ⊗ conj(prev)` with a
 * rate of `|yaw| / dt`, or 0 when `dt <= 0`.
 */
class RotationHeading(private val absolute: Boolean) : HeadingState {
    override var started = false; private set
    override var psi = 0.0; private set
    override var rate = 0.0; private set
    private var px = 0.0
    private var py = 0.0
    private var pz = 0.0
    private var pw = 1.0
    private var lastT = 0.0

    fun push(t: Double, qx0: Double, qy0: Double, qz0: Double, qw0: Double) {
        val n = sqrt(qx0 * qx0 + qy0 * qy0 + qz0 * qz0 + qw0 * qw0)
        var qx = 0.0
        var qy = 0.0
        var qz = 0.0
        var qw = 1.0
        if (n != 0.0 && !n.isNaN()) {
            qx = qx0 / n; qy = qy0 / n; qz = qz0 / n; qw = qw0 / n
        }
        if (!started) {
            started = true
            psi = if (absolute) Quat.forwardBearing(qx, qy, qz, qw) else 0.0
            rate = 0.0
        } else {
            // dq = q ⊗ conj(prev)
            val cx = -px
            val cy = -py
            val cz = -pz
            val cw = pw
            val x = qw * cx + qx * cw + qy * cz - qz * cy
            val y = qw * cy - qx * cz + qy * cw + qz * cx
            val z = qw * cz + qx * cy - qy * cx + qz * cw
            val w = qw * cw - qx * cx - qy * cy - qz * cz
            val yaw = atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))
            psi -= yaw
            val dt = (t - lastT) / 1000.0
            rate = if (dt > 0) abs(yaw) / dt else 0.0
        }
        px = qx; py = qy; pz = qz; pw = qw
        lastT = t
    }
}

object Quat {
    /**
     * The compass bearing, radians clockwise from north in [0, 2π), of the device's forward
     * axis for a device to ENU quaternion: device +y on the floor, or device -z when +y
     * points more than 45 degrees up or down (section 5.3).
     */
    fun forwardBearing(x: Double, y: Double, z: Double, w: Double): Double {
        // Column two of the rotation matrix: device +y in the world.
        var vx = 2 * (x * y - z * w)
        var vy = 1 - 2 * (x * x + z * z)
        val vz = 2 * (y * z + x * w)
        if (abs(vz) > sqrt(0.5)) {
            // Minus column three: device -z in the world.
            vx = -2 * (x * z + y * w)
            vy = -2 * (y * z - x * w)
        }
        val full = 2 * Math.PI
        val a = atan2(vx, vy) % full
        return if (a < 0) a + full else a
    }
}

/**
 * Square turns, recorder plan 0002, section 5.4, over one heading source. The settle
 * clock is the time of the first sample of the current unbroken run of samples whose rate
 * is under 20 degrees per second; settled means that run is at least 400 ms old. `update`
 * runs after every heading sample, the first one included.
 */
class Snapper(private val o: EngineOptions, start: Double) {
    /** The heading the snapper started at. */
    val startHeading = start
    var psiRef = start; private set
    /** The snapped heading, radians. */
    var h = start; private set
    var turns = 0; private set
    private var calmSince: Double? = null

    /** Answers true when a counted turn happened at this sample. */
    fun update(t: Double, psi: Double, rate: Double): Boolean {
        if (rate < o.settleRateDegPerS * DEG) {
            if (calmSince == null) calmSince = t
        } else {
            calmSince = null
        }
        val calm = calmSince
        val settled = calm != null && t - calm >= o.settleMs
        val diff = psi - psiRef
        if (!settled || abs(diff) <= o.turnThresholdDeg * DEG) return false
        val q = if (o.turnQuantumDeg == 90.0) Math.PI / 2 else o.turnQuantumDeg * DEG
        // Math.round semantics (half up), the same as JavaScript's Math.round.
        val turn = floor(diff / q + 0.5) * q
        h += turn
        psiRef = psi
        if (turn == 0.0) return false
        turns++
        return true
    }
}
