import {
  DEG,
  forwardBearing,
  GyroHeading,
  OwnStepDetector,
  quaternionYaw,
  RotationHeading,
  segmentConfidence,
  Snapper,
  weinbergLength,
} from './estimators';

/** |a| of a phone at rest plus a one cycle per step vertical bounce. */
function bounce(t: number, periodMs: number, amplitude: number): number {
  return 9.81 + amplitude * Math.sin((2 * Math.PI * t) / periodMs);
}

function runDetector(
  samples: (t: number) => number,
  untilMs: number,
  stepMs = 10
) {
  const d = new OwnStepDetector();
  const steps = [];
  for (let t = 0; t <= untilMs; t += stepMs) {
    const s = d.push(t, samples(t));
    if (s) steps.push(s);
  }
  return steps;
}

describe('OwnStepDetector (5.1)', () => {
  it.each([
    // [period ms, amplitude, duration ms, expected steps]
    [555, 2.5, 11_000, 18], // 1.8 Hz; first second silent, then one per cycle
    [500, 2.0, 6_000, 10],
    [555, 0.5, 11_000, 0], // under the 0.8 threshold after the low pass
  ])(
    'period %i ms, amplitude %f, %i ms: %i steps',
    (period, amplitude, duration, expected) => {
      const steps = runDetector((t) => bounce(t, period, amplitude), duration);
      expect(steps.length).toBe(expected);
    }
  );

  it('emits nothing in the first second', () => {
    const steps = runDetector((t) => bounce(t, 555, 3), 3000);
    expect(steps.length).toBeGreaterThan(0);
    for (const s of steps) expect(s.t).toBeGreaterThanOrEqual(1000);
  });

  it('drops a step less than 280 ms after the previous one', () => {
    // 5 Hz bouncing: every cycle crosses the thresholds, but only every
    // second peak is 280 ms clear of the last emitted one.
    const steps = runDetector((t) => bounce(t, 200, 6), 5000, 5);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].t - steps[i - 1].t).toBeGreaterThanOrEqual(280);
    }
  });

  it('carries the largest and smallest s for weinberg', () => {
    const steps = runDetector((t) => bounce(t, 555, 2.5), 6000);
    for (const s of steps) {
      expect(s.smax).toBeGreaterThan(9.81);
      expect(s.smin).toBeLessThan(9.81);
    }
  });
});

describe('GyroHeading (5.2)', () => {
  it('integrates the yaw rate around gravity, left turns decreasing psi', () => {
    const h = new GyroHeading();
    // Flat phone, 0.5 rad/s left for 2 s.
    for (let t = 0; t <= 2000; t += 10) h.push(t, 0, 0, 9.81, 0, 0, 0.5);
    expect(h.psi).toBeCloseTo(-1, 6);
  });

  it('projects on gravity, so an upright phone turns with its y rate', () => {
    const h = new GyroHeading();
    for (let t = 0; t <= 1000; t += 10) h.push(t, 0, 9.81, 0, 0, -0.3, 0);
    expect(h.psi).toBeCloseTo(0.3, 6);
  });

  it('integrates nothing on the first sample', () => {
    const h = new GyroHeading();
    h.push(500, 0, 0, 9.81, 0, 0, 10);
    expect(h.psi).toBe(0);
    expect(h.rate).toBe(10);
  });
});

const yawQ = (theta: number): [number, number, number, number] => [
  0,
  0,
  Math.sin(theta / 2),
  Math.cos(theta / 2),
];

describe('RotationHeading (5.3)', () => {
  it('follows the yaw increments of the quaternion', () => {
    const h = new RotationHeading(false);
    for (let i = 0; i <= 50; i++) {
      h.push(i * 20, ...yawQ(0.7 - (i / 50) * (Math.PI / 2)));
    }
    // The world yaw fell by 90 degrees: a right turn, psi grows.
    expect(h.psi).toBeCloseTo(Math.PI / 2, 6);
  });

  it('starts at 0 for game, whatever the first yaw', () => {
    const h = new RotationHeading(false);
    h.push(0, ...yawQ(1.234));
    expect(h.psi).toBe(0);
  });

  it.each([
    [0, 0],
    [90, 90],
    [212.5, 212.5],
    [359, 359],
  ])('absolute starts at the bearing of a flat phone: %f', (bearing, psi) => {
    const h = new RotationHeading(true);
    h.push(0, ...yawQ(-bearing * DEG));
    expect(h.psi / DEG).toBeCloseTo(psi, 6);
  });

  it('takes device -z as forward when +y points more than 45 degrees up', () => {
    // Upright phone facing east: device +y is up, -z is east.
    // Rotate +90° about world x (device +y to up), then -90° about up.
    const qx: [number, number, number, number] = [
      Math.sin(Math.PI / 4),
      0,
      0,
      Math.cos(Math.PI / 4),
    ];
    const qz = yawQ(-Math.PI / 2);
    const [ax, ay, az, aw] = qz;
    const [bx, by, bz, bw] = qx;
    const q: [number, number, number, number] = [
      aw * bx + ax * bw + ay * bz - az * by,
      aw * by - ax * bz + ay * bw + az * bx,
      aw * bz + ax * by - ay * bx + az * bw,
      aw * bw - ax * bx - ay * by - az * bz,
    ];
    expect(forwardBearing(q) / DEG).toBeCloseTo(90, 6);
  });

  it('reads the yaw of a pure z rotation', () => {
    expect(quaternionYaw(yawQ(0.3))).toBeCloseTo(0.3, 9);
  });
});

describe('Snapper (5.4)', () => {
  /** Drives a snapper through a heading profile sampled every 10 ms. */
  function drive(profile: (t: number) => number, until: number) {
    const s = new Snapper(0);
    let prev = profile(0);
    for (let t = 0; t <= until; t += 10) {
      const psi = profile(t);
      const rate = t === 0 ? 0 : Math.abs(psi - prev) / 0.01;
      prev = psi;
      s.update(t, psi, rate);
    }
    return s;
  }
  const turn =
    (deg: number, at = 1000, over = 1000) =>
    (t: number) =>
      t < at ? 0 : t > at + over ? deg * DEG : ((t - at) / over) * deg * DEG;

  it.each([
    [90, 1, 90],
    [80, 1, 90],
    [-100, 1, -90],
    [180, 1, 180],
    [50, 0, 0],
  ])('a settled turn of %f degrees: %i turns, heading %f', (deg, turns, h) => {
    const s = drive(turn(deg), 4000);
    expect(s.turns).toBe(turns);
    expect(s.heading / DEG).toBeCloseTo(h, 9);
  });

  it('waits for 400 ms under 20 degrees per second', () => {
    const s = drive(turn(90, 1000, 1000), 2350);
    expect(s.turns).toBe(0);
    const later = drive(turn(90, 1000, 1000), 2420);
    expect(later.turns).toBe(1);
  });

  it('discards the residue at each turn, so slow drift never accumulates', () => {
    // 85 degrees, then 85 more: two turns, heading exactly 180.
    const profile = (t: number) => turn(85, 1000)(t) + turn(85, 3000)(t);
    const s = drive(profile, 6000);
    expect(s.turns).toBe(2);
    expect(s.heading / DEG).toBeCloseTo(180, 9);
    expect(s.psiRef / DEG).toBeCloseTo(170, 6);
  });
});

describe('step length and confidence', () => {
  it('weinberg is K times the fourth root of the swing', () => {
    expect(weinbergLength(12, 8, 0.48)).toBeCloseTo(0.48 * Math.SQRT2, 9);
    expect(weinbergLength(8, 12, 0.48)).toBe(0);
  });

  it('confidence falls with the segment duration', () => {
    expect(segmentConfidence(0, 0)).toBe(1);
    expect(segmentConfidence(0, 60_000)).toBeCloseTo(Math.exp(-1), 12);
  });
});
