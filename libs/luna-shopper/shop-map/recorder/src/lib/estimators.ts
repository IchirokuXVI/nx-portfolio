/**
 * The estimators of recorder plan 0002 section 5, each a small state machine
 * fed one sample at a time. The rules that the plan left open are fixed here
 * and in the README.
 *
 * Shared conventions:
 * - `t` is milliseconds, `dt` inside a filter is seconds.
 * - The first sample of a filter has `dt = 0`: it initializes the state and
 *   integrates nothing.
 * - A low pass is `v += (1 - exp(-dt / tau)) * (x - v)`.
 */

export const DEG = Math.PI / 180;

/** Section 5.1. */
export const STEP_FAST_TAU_S = 0.06;
export const STEP_BASELINE_TAU_S = 1.5;
export const STEP_RISE = 0.8;
export const STEP_FALL = 0.2;
export const STEP_REFRACTORY_MS = 280;
export const STEP_SETTLE_MS = 1000;
/** Section 5.2. */
export const GRAVITY_TAU_S = 0.5;
/** Section 5.4. */
export const SETTLE_RATE = 20 * DEG;
export const SETTLE_MS = 400;
export const TURN_THRESHOLD = 60 * DEG;
export const CONFIDENCE_SECONDS = 60;
/** Section 5.5. */
export const WEINBERG_K = 0.48;
/** Section 5.6. */
export const ALIGN_METRES = 3;

function lowPassAlpha(dtSeconds: number, tau: number): number {
  return 1 - Math.exp(-dtSeconds / tau);
}

export interface DetectedStep {
  /** The time of the largest `s`, which is when the step is emitted. */
  t: number;
  smax: number;
  smin: number;
}

/**
 * Section 5.1. `push` answers the step it emits at this sample, if any. A step
 * is only known when `s - b` falls back below the lower threshold, so a step
 * is answered some tens of milliseconds after the `t` it carries.
 *
 * - `s` and `b` both start at the first `m`.
 * - `smin` is the smallest `s` since the previous emitted step. It starts at
 *   the first `s`, and is reset to the current `s` at the sample that emits a
 *   step. A dropped step (too early, or inside the refractory time) resets
 *   nothing.
 * - "rises above" is `s - b > 0.8`, "falls below" is `s - b < 0.2`. The sample
 *   that rises above is the first candidate for the largest `s`.
 * - The first second is measured from the first motion sample: a step whose
 *   `t` is earlier than `firstT + 1000` is dropped.
 */
export class OwnStepDetector {
  private started = false;
  private firstT = 0;
  private lastT = 0;
  /** The fast low pass. Public so that `hw` steps can read it for weinberg. */
  s = 0;
  private b = 0;
  private above = false;
  private peakS = 0;
  private peakT = 0;
  private minS = 0;
  private lastEmitT = Number.NEGATIVE_INFINITY;

  push(t: number, m: number): DetectedStep | null {
    if (!this.started) {
      this.started = true;
      this.firstT = t;
      this.lastT = t;
      this.s = m;
      this.b = m;
      this.minS = m;
    } else {
      const dt = (t - this.lastT) / 1000;
      this.lastT = t;
      this.s += lowPassAlpha(dt, STEP_FAST_TAU_S) * (m - this.s);
      this.b += lowPassAlpha(dt, STEP_BASELINE_TAU_S) * (m - this.b);
    }
    if (this.s < this.minS) this.minS = this.s;
    const d = this.s - this.b;
    if (!this.above) {
      if (d > STEP_RISE) {
        this.above = true;
        this.peakS = this.s;
        this.peakT = t;
      }
      return null;
    }
    if (this.s > this.peakS) {
      this.peakS = this.s;
      this.peakT = t;
    }
    if (d >= STEP_FALL) return null;
    this.above = false;
    if (this.peakT < this.firstT + STEP_SETTLE_MS) return null;
    if (this.peakT - this.lastEmitT < STEP_REFRACTORY_MS) return null;
    const step: DetectedStep = {
      t: this.peakT,
      smax: this.peakS,
      smin: this.minS,
    };
    this.lastEmitT = this.peakT;
    this.minS = this.s;
    return step;
  }
}

/** A heading estimate: radians clockwise from the local +y, and how fast it turns. */
export interface HeadingSource {
  readonly ready: boolean;
  /** Raw heading, radians clockwise from the local +y. */
  readonly psi: number;
  /** |rate of the heading| in rad/s at the last sample, for the settle rule. */
  readonly rate: number;
}

/**
 * Section 5.2. At each sample the gravity estimate is updated first, then the
 * yaw rate is taken from this sample's rotation rate and that gravity, then
 * `psi -= yawRate * dt` with `dt` since the previous sample (the rectangle
 * rule, using the current rate). `|g| = 0` answers a yaw rate of 0.
 */
export class GyroHeading implements HeadingSource {
  ready = false;
  psi = 0;
  rate = 0;
  private lastT = 0;
  private g = [0, 0, 0];

  push(
    t: number,
    ax: number,
    ay: number,
    az: number,
    gx: number,
    gy: number,
    gz: number
  ): void {
    let dt = 0;
    if (!this.ready) {
      this.ready = true;
      this.g = [ax, ay, az];
    } else {
      dt = (t - this.lastT) / 1000;
      const k = lowPassAlpha(dt, GRAVITY_TAU_S);
      this.g[0] += k * (ax - this.g[0]);
      this.g[1] += k * (ay - this.g[1]);
      this.g[2] += k * (az - this.g[2]);
    }
    this.lastT = t;
    const norm = Math.hypot(this.g[0], this.g[1], this.g[2]);
    const yawRate =
      norm === 0
        ? 0
        : (gx * this.g[0] + gy * this.g[1] + gz * this.g[2]) / norm;
    this.pushYawRate(yawRate, dt);
  }

  /** Integrates an already projected yaw rate (plan 0001's `MotionSample`). */
  pushYawRate(yawRate: number, dtSeconds: number): void {
    this.ready = true;
    this.psi -= yawRate * dtSeconds;
    this.rate = Math.abs(yawRate);
  }
}

export type Quaternion = [number, number, number, number]; // x, y, z, w

export function normalizeQuaternion(q: Quaternion): Quaternion {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  if (n === 0) return [0, 0, 0, 1];
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Hamilton product `a ⊗ b`, both `[x, y, z, w]`. */
export function multiplyQuaternions(a: Quaternion, b: Quaternion): Quaternion {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function conjugate(q: Quaternion): Quaternion {
  return [-q[0], -q[1], -q[2], q[3]];
}

/** Yaw of a quaternion, counterclockwise around world up, section 5.3. */
export function quaternionYaw(q: Quaternion): number {
  const [x, y, z, w] = q;
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
}

/**
 * Section 5.3: the compass bearing, in radians clockwise from north, of the
 * device's forward axis. Device +y rotated into the world, or device -z when
 * +y points more than 45 degrees up or down (`|v.z| > sin 45°`).
 */
export function forwardBearing(qRaw: Quaternion): number {
  const [x, y, z, w] = normalizeQuaternion(qRaw);
  let vx = 2 * (x * y - z * w);
  let vy = 1 - 2 * (x * x + z * z);
  const vz = 2 * (y * z + x * w);
  if (Math.abs(vz) > Math.SQRT1_2) {
    vx = -2 * (x * z + y * w);
    vy = -2 * (y * z - x * w);
  }
  return normalizeRadians(Math.atan2(vx, vy));
}

/** An angle in [0, 2π). */
export function normalizeRadians(a: number): number {
  const full = 2 * Math.PI;
  const r = a % full;
  return r < 0 ? r + full : r;
}

/**
 * Section 5.3. Every quaternion is normalized before use. The first sample
 * sets the start heading (0, or the forward bearing when `absolute`) and a
 * rate of 0. Later samples take `Δq = q_t ⊗ conj(q_prev)`, `psi -= yaw(Δq)`,
 * and a rate of `|yaw| / dt`, or 0 when `dt <= 0`.
 */
export class RotationHeading implements HeadingSource {
  ready = false;
  psi = 0;
  rate = 0;
  private lastT = 0;
  private last: Quaternion = [0, 0, 0, 1];

  constructor(private readonly absolute: boolean) {}

  push(t: number, qx: number, qy: number, qz: number, qw: number): void {
    const q = normalizeQuaternion([qx, qy, qz, qw]);
    if (!this.ready) {
      this.ready = true;
      this.psi = this.absolute ? forwardBearing(q) : 0;
      this.rate = 0;
    } else {
      const yaw = quaternionYaw(multiplyQuaternions(q, conjugate(this.last)));
      this.psi -= yaw;
      const dt = (t - this.lastT) / 1000;
      this.rate = dt > 0 ? Math.abs(yaw) / dt : 0;
    }
    this.last = q;
    this.lastT = t;
  }
}

/**
 * Section 5.4. `update` is called after every heading sample, with that
 * sample's time, raw heading and rate. The settled clock is the time of the
 * first sample of the current unbroken run of samples whose rate is under 20
 * degrees per second; settled means that run is at least 400 ms old. The
 * rounding of the turn is `Math.round`, which takes an exact half towards +∞;
 * only an exact 135 or 225 degrees can tie.
 * A turn is snapped whenever it is settled and past 60 degrees, and it always
 * rounds to a non zero multiple of 90 there, so `psiRef` never resets alone.
 */
export class Snapper {
  psiRef: number;
  heading: number;
  turns = 0;
  private calmSince: number | null = null;

  constructor(start: number) {
    this.psiRef = start;
    this.heading = start;
  }

  /** Answers true when a counted turn happened at this sample. */
  update(t: number, psi: number, rate: number): boolean {
    if (rate < SETTLE_RATE) {
      if (this.calmSince === null) this.calmSince = t;
    } else {
      this.calmSince = null;
    }
    const settled = this.calmSince !== null && t - this.calmSince >= SETTLE_MS;
    const delta = psi - this.psiRef;
    if (!settled || Math.abs(delta) <= TURN_THRESHOLD) return false;
    const turn = Math.round(delta / (Math.PI / 2)) * (Math.PI / 2);
    this.heading += turn;
    this.psiRef = psi;
    if (turn === 0) return false;
    this.turns += 1;
    return true;
  }
}

/** Section 5.5, weinberg: `K × (smax − smin)^(1/4)`. */
export function weinbergLength(smax: number, smin: number, k: number): number {
  return k * Math.pow(Math.max(0, smax - smin), 0.25);
}

/** Segment confidence, section 5.4 step 5. */
export function segmentConfidence(fromT: number, toT: number): number {
  return Math.exp(-(toT - fromT) / 1000 / CONFIDENCE_SECONDS);
}
