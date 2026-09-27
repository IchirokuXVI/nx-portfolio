/**
 * The arithmetic the capture service needs to turn browser events into rows of the
 * walk file (recorder plan 0002, sections 1 and 2). Pure, so it carries the tests.
 */

const DEG = Math.PI / 180;

/**
 * A `deviceorientation` reading as the quaternion `[qx, qy, qz, qw]` that rotates
 * device frame vectors into the world frame.
 *
 * The W3C angles are intrinsic Tait-Bryan angles in the order Z-X'-Y'': `alpha`
 * around z, then `beta` around the new x, then `gamma` around the newest y. The
 * rotation is therefore `qz(alpha) ⊗ qx(beta) ⊗ qy(gamma)`, which multiplied out
 * is the formula the specification itself gives in its worked example.
 *
 * Answers null when any angle is missing, which is what a browser without the
 * sensor sends.
 */
export function eulerToQuaternion(
  alpha: number | null | undefined,
  beta: number | null | undefined,
  gamma: number | null | undefined
): [number, number, number, number] | null {
  if (!isFiniteNumber(alpha) || !isFiniteNumber(beta) || !isFiniteNumber(gamma)) {
    return null;
  }

  const x = (beta * DEG) / 2;
  const y = (gamma * DEG) / 2;
  const z = (alpha * DEG) / 2;

  const cX = Math.cos(x);
  const cY = Math.cos(y);
  const cZ = Math.cos(z);
  const sX = Math.sin(x);
  const sY = Math.sin(y);
  const sZ = Math.sin(z);

  const qw = cX * cY * cZ - sX * sY * sZ;
  const qx = sX * cY * cZ - cX * sY * sZ;
  const qy = cX * sY * cZ + sX * cY * sZ;
  const qz = cX * cY * sZ + sX * sY * cZ;

  return [qx, qy, qz, qw];
}

/** The parts of a `DeviceMotionEvent` a motion row is made from. */
export interface MotionReading {
  accelerationIncludingGravity: {
    x: number | null;
    y: number | null;
    z: number | null;
  } | null;
  rotationRate: {
    alpha: number | null;
    beta: number | null;
    gamma: number | null;
  } | null;
}

/**
 * One `motion` row, `[t, ax, ay, az, gx, gy, gz]`, or null when the event carries
 * no acceleration.
 *
 * The W3C `rotationRate` is in degrees per second with `alpha` around z, `beta`
 * around x and `gamma` around y, so the row takes `[beta, gamma, alpha]` and
 * converts it to radians per second (section 1). A missing rotation rate writes
 * zeros, which reads as a phone that never turned rather than a broken row; the
 * capture service records a `sensor-missing` event once when that happens.
 */
export function motionRow(t: number, reading: MotionReading): number[] | null {
  const a = reading.accelerationIncludingGravity;
  if (
    a === null ||
    !isFiniteNumber(a.x) ||
    !isFiniteNumber(a.y) ||
    !isFiniteNumber(a.z)
  ) {
    return null;
  }

  const r = reading.rotationRate;
  const gx = r !== null && isFiniteNumber(r.beta) ? r.beta * DEG : 0;
  const gy = r !== null && isFiniteNumber(r.gamma) ? r.gamma * DEG : 0;
  const gz = r !== null && isFiniteNumber(r.alpha) ? r.alpha * DEG : 0;

  return [
    roundTo(t, 1),
    roundTo(a.x, 4),
    roundTo(a.y, 4),
    roundTo(a.z, 4),
    roundTo(gx, 5),
    roundTo(gy, 5),
    roundTo(gz, 5),
  ];
}

/**
 * A number with at most `digits` decimals.
 *
 * Every row goes through this, because a twenty minute walk is over a hundred
 * thousand rows and seventeen significant digits of sensor noise would double the
 * file for nothing.
 */
export function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
