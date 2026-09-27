package com.ichirokuxvi.shopwalk.engine

import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.sqrt

/** A step the own detector emitted: its time and the largest and smallest `s` of 5.1. */
data class OwnStep(val t: Double, val sMax: Double, val sMin: Double)

/**
 * The own step detector of recorder plan 0002, section 5.1, fed one motion row at a time.
 *
 * Choices where the contract is silent, kept identical in the report:
 * a sample with the same `t` as the previous one updates no filter; "the smallest `s`
 * since the previous step" is reset when a step is emitted (a dropped step does not reset
 * it); and the first second is judged on the step's emission time, the time of its peak.
 */
class OwnStepDetector(private val o: EngineOptions) {
    var s = 0.0; private set
    var b = 0.0; private set
    private var started = false
    private var lastT = 0.0
    private var inStep = false
    private var peakS = 0.0
    private var peakT = 0.0
    private var minS = Double.POSITIVE_INFINITY
    private var lastEmitted = Double.NEGATIVE_INFINITY

    fun push(t: Double, ax: Double, ay: Double, az: Double): OwnStep? {
        val m = sqrt(ax * ax + ay * ay + az * az)
        if (!started) {
            started = true
            s = m
            b = m
            lastT = t
        } else {
            val dt = (t - lastT) / 1000.0
            if (dt > 0) {
                s += (1 - exp(-dt / o.stepFastTauS)) * (m - s)
                b += (1 - exp(-dt / o.stepBaseTauS)) * (m - b)
                lastT = t
            }
        }
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
        if (d < o.stepFallMs2) {
            inStep = false
            if (peakT < o.stepWarmupMs) return null
            if (peakT - lastEmitted < o.stepRefractoryMs) return null
            lastEmitted = peakT
            val step = OwnStep(peakT, peakS, minS)
            minS = Double.POSITIVE_INFINITY
            return step
        }
        return null
    }
}

/** A heading source: `psi` in radians clockwise from the local +y, and its rate in deg/s. */
interface HeadingState {
    val started: Boolean
    val psi: Double
    val rateDegPerS: Double
}

/** Gyro heading, recorder plan 0002, section 5.2. */
class GyroHeading(private val o: EngineOptions) : HeadingState {
    override var started = false; private set
    override var psi = 0.0; private set
    override var rateDegPerS = 0.0; private set
    private var gx = 0.0
    private var gy = 0.0
    private var gz = 0.0
    private var lastT = 0.0

    fun push(t: Double, ax: Double, ay: Double, az: Double, wx: Double, wy: Double, wz: Double) {
        var dt = 0.0
        if (!started) {
            started = true
            gx = ax; gy = ay; gz = az
            lastT = t
        } else {
            dt = (t - lastT) / 1000.0
            if (dt > 0) {
                val k = 1 - exp(-dt / o.gravityTauS)
                gx += k * (ax - gx)
                gy += k * (ay - gy)
                gz += k * (az - gz)
                lastT = t
            } else {
                dt = 0.0
            }
        }
        val gn = sqrt(gx * gx + gy * gy + gz * gz)
        val yawRate = if (gn > 0) (wx * gx + wy * gy + wz * gz) / gn else 0.0
        psi -= yawRate * dt
        rateDegPerS = abs(Math.toDegrees(yawRate))
    }
}

/**
 * Rotation vector heading (`game`, `absolute`), recorder plan 0002, section 5.3.
 * Quaternions are `[qx, qy, qz, qw]`, normalised on the way in.
 */
class RotationHeading(private val absolute: Boolean) : HeadingState {
    override var started = false; private set
    override var psi = 0.0; private set
    override var rateDegPerS = 0.0; private set
    private var px = 0.0
    private var py = 0.0
    private var pz = 0.0
    private var pw = 1.0
    private var lastT = 0.0

    fun push(t: Double, qx0: Double, qy0: Double, qz0: Double, qw0: Double) {
        val n = sqrt(qx0 * qx0 + qy0 * qy0 + qz0 * qz0 + qw0 * qw0)
        if (n == 0.0 || n.isNaN()) return
        val qx = qx0 / n
        val qy = qy0 / n
        val qz = qz0 / n
        val qw = qw0 / n
        if (!started) {
            started = true
            psi = if (absolute) Quat.forwardBearing(qx, qy, qz, qw) else 0.0
            rateDegPerS = 0.0
        } else {
            // dq = q ⊗ conj(prev)
            val cx = -px
            val cy = -py
            val cz = -pz
            val cw = pw
            val w = qw * cw - qx * cx - qy * cy - qz * cz
            val x = qw * cx + qx * cw + qy * cz - qz * cy
            val y = qw * cy - qx * cz + qy * cw + qz * cx
            val z = qw * cz + qx * cy - qy * cx + qz * cw
            val yaw = atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))
            psi -= yaw
            val dt = (t - lastT) / 1000.0
            rateDegPerS = if (dt > 0) abs(Math.toDegrees(yaw)) / dt else 0.0
        }
        px = qx; py = qy; pz = qz; pw = qw
        lastT = t
    }
}

object Quat {
    /**
     * The compass bearing, radians clockwise from north, of the device's forward axis for a
     * device to ENU quaternion: device +y on the floor, or device -z when +y points more
     * than 45 degrees up or down (section 5.3).
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
        return atan2(vx, vy)
    }
}

/** Square turns, recorder plan 0002, section 5.4, over one heading source. */
class Snapper(private val o: EngineOptions) {
    var started = false; private set
    var psiRef = 0.0; private set
    /** The snapped heading, radians. */
    var h = 0.0; private set
    var turns = 0; private set
    private var calmSince: Double? = null
    /** Each turn's time and the snapped heading after it. */
    val turnLog = ArrayList<DoubleArray>()

    /** The heading the snapper started at. */
    var startHeading = 0.0; private set

    fun start(psi0: Double) {
        started = true
        startHeading = psi0
        psiRef = psi0
        h = psi0
    }

    fun update(t: Double, psi: Double, rateDegPerS: Double) {
        if (rateDegPerS < o.settleRateDegPerS) {
            if (calmSince == null) calmSince = t
        } else {
            calmSince = null
        }
        val calm = calmSince
        val settled = calm != null && t - calm >= o.settleMs
        val diff = psi - psiRef
        if (settled && abs(diff) > Math.toRadians(o.turnThresholdDeg)) {
            val q = Math.toRadians(o.turnQuantumDeg)
            // Math.round semantics (half up), the same as JavaScript's Math.round.
            val turn = floor(diff / q + 0.5) * q
            h += turn
            if (turn != 0.0) {
                turns++
                turnLog.add(doubleArrayOf(t, h))
            }
            psiRef = psi
        }
    }
}
