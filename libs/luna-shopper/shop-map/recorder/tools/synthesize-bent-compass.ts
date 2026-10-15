/**
 * Writes the SYNTHETIC bent compass fixture of recorder plan 0005 section 5.
 *
 *   npx nx run luna-shopper/shop-map/recorder:synthesize-bent-compass
 *
 * No recording of the freezer aisles exists yet, so this trace is made up:
 * a straight walk of 30 s at 1 m per second along map +y, the camera and the
 * gyro in agreement, and a compass that swings 90 degrees away over 3 s,
 * holds for 8 s and comes back over 3 s. When the owner's walk lab recording
 * of the freezer aisles arrives, it replaces this file. Never edit the
 * output by hand: rerun this script.
 *
 * The rows have the shapes of the El Jamón fixture (`cut-tracking-fixture`):
 * `pose` is `t, x, y, z, qx, qy, qz, qw`, and `absolute` and `game` are
 * `t, qx, qy, qz, qw`, at 10 Hz. The compass and the gyro read a phone held
 * flat, as the guard's specs do; the guard only compares the headings.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const OUT = join(
  __dirname,
  '..',
  'src',
  '__fixtures__',
  'tracking',
  'bent-compass.synthetic.tracking.json'
);

const STEP_MS = 100;
const WALK_MS = 30_000;
const METRES_PER_SECOND = 1;
/** Compass minus camera heading while the compass is not bent. */
const BASELINE = 300;
/** Where the `game` stream put its zero, against the camera's. */
const GYRO_ZERO = 20;
/** The `game` yaw drift of 2026-09-28, degrees per second. */
const GYRO_DRIFT = 0.33;
/** The swing: starts, reaches 90 degrees, holds, comes back. */
const SWING = { from: 8_000, ramp: 3_000, hold: 8_000, degrees: 90 };

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** The compass's bend at `t`, in degrees. */
function bend(t: number): number {
  const a = t - SWING.from;
  const back = SWING.ramp + SWING.hold;
  if (a <= 0 || a >= back + SWING.ramp) return 0;
  if (a < SWING.ramp) return (SWING.degrees * a) / SWING.ramp;
  if (a <= back) return SWING.degrees;
  return SWING.degrees * (1 - (a - back) / SWING.ramp);
}

/** A camera pose facing heading 0 (map +y), upright. */
function pose(t: number): number[] {
  const y = (METRES_PER_SECOND * t) / 1000;
  // Heading h is a turn of 180 - h degrees about +y from camera -z.
  return [t, 0, 1.2, r6(y), 0, 1, 0, 0];
}

/** A flat phone pointing at `bearing` degrees: a negative turn about +z. */
function flat(t: number, bearing: number): number[] {
  const a = -(bearing * Math.PI) / 180 / 2;
  return [t, 0, 0, r6(Math.sin(a)), r6(Math.cos(a))];
}

const rows = {
  pose: [] as number[][],
  absolute: [] as number[][],
  game: [] as number[][],
};
for (let t = 0; t <= WALK_MS; t += STEP_MS) {
  rows.absolute.push(flat(t, BASELINE + bend(t)));
  rows.game.push(flat(t, GYRO_ZERO + (GYRO_DRIFT * t) / 1000));
  rows.pose.push(pose(t));
}

const fixture = {
  synthetic: true,
  source: {
    description:
      'SYNTHETIC, recorder plan 0005 section 5: a straight walk of 30 s at 1 m/s, camera and gyro in agreement, and a compass that swings 90 degrees over 3 s from 8 s, holds for 8 s and comes back over 3 s. Replace it with the walk lab recording of the freezer aisles.',
    stepMs: STEP_MS,
    baseline: BASELINE,
  },
  windows: {
    walk: { from: 0, to: WALK_MS + STEP_MS, ...rows, events: [] },
  },
};

// One row per line, as the El Jamón fixture.
const text = JSON.stringify(fixture, null, 1).replace(
  /\[\s+(-?[\d.e+-]+(?:,\s+-?[\d.e+-]+)*)\s+\]/g,
  (_m, inner: string) => `[${inner.replace(/,\s+/g, ',')}]`
);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, text + '\n');
console.log(
  `walk: ${rows.pose.length} poses, ${rows.absolute.length} compass rows, ${rows.game.length} gyro rows`
);
