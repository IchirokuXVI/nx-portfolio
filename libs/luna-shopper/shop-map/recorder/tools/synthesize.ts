/**
 * A synthetic walker, for the fixtures of recorder plans 0001 and 0002 until
 * real phone recordings exist. It walks a script of legs and pivots and writes
 * what a phone held flat, screen up and top forward, would have recorded:
 *
 * - `motion` at 100 Hz: gravity on +z, a vertical bounce of one sine cycle per
 *   step (1.8 steps a second, amplitude 2.5 m/s²), a little forward and
 *   lateral sway, Gaussian noise, and a small constant gyro bias.
 * - `game` and `absolute` at 50 Hz: the true yaw plus the hand's sway and a
 *   little noise; `game` starts at an arbitrary yaw and drifts slowly,
 *   `absolute` starts at a known compass bearing.
 * - `steps` at each step, `location` at 1 Hz with an indoor error of several
 *   metres, and `pose` at 30 Hz: the true path in an AR frame, y up, with an
 *   arbitrary yaw.
 *
 * Turns are pivots in place followed by a short pause, which is kinder to
 * dead reckoning than a real person turning mid stride. Everything is seeded,
 * so a run writes the same bytes every time.
 */
import type { WalkFile, WalkMark } from '../src/index';

export type Action =
  | { walk: number }
  | { turn: number } // degrees, positive is a right (clockwise) turn
  | { stand: number } // ms
  | { mark: WalkMark['kind']; label?: string }
  | { scan: string };

export interface Script {
  id: string;
  name: string;
  startedAt: string;
  actions: Action[];
  /** Compass bearing in degrees of the first leg, for `absolute` and `location`. */
  bearing: number;
  streams: {
    absolute: boolean;
    location: boolean;
  };
  seed: number;
}

export interface Synthesized {
  walk: WalkFile;
  /** Plan 0001 samples: `[t, ax, ay, az, yawRate]` plus host actions. */
  trace: {
    samples: number[][];
    actions: { t: number; kind: string; label?: string; ean?: string }[];
  };
  truth: {
    steps: number;
    turns: number;
    distanceMetres: number;
    path: { t: number; x: number; y: number }[];
  };
}

const STEP_MS = 555;
const STEP_METRES = 0.7;
const BOUNCE = 2.5;
const G = 9.80665;
const PAUSE_AFTER_TURN_MS = 500;
const SWAY_YAW = 1.5 * (Math.PI / 180);
const GYRO_BIAS = [0.0006, -0.0004, 0.002];
const GAME_OFFSET = 37 * (Math.PI / 180);
const GAME_DRIFT = 0.0005; // rad/s
const AR_YAW = 70 * (Math.PI / 180);
const ORIGIN = { lat: 40.4168, lon: -3.7038 };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): () => number {
  return () => {
    const u = Math.max(rand(), 1e-12);
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

const r = (v: number, d: number) => {
  const k = 10 ** d;
  const out = Math.round(v * k) / k;
  return out === 0 ? 0 : out; // no negative zero in the file
};

/** One phase of the timeline. */
interface Phase {
  from: number;
  to: number;
  kind: 'stand' | 'walk' | 'turn';
  /** Heading at the start, radians clockwise from the first leg. */
  psi0: number;
  /** Turn angle for a turn, radians clockwise. */
  dpsi: number;
  x0: number;
  y0: number;
  steps: number;
}

function planPhases(script: Script): {
  phases: Phase[];
  marks: { t: number; kind: WalkMark['kind']; label?: string }[];
  scans: { t: number; ean: string }[];
  end: number;
} {
  const phases: Phase[] = [];
  const marks: { t: number; kind: WalkMark['kind']; label?: string }[] = [];
  const scans: { t: number; ean: string }[] = [];
  let t = 0;
  let psi = 0;
  let x = 0;
  let y = 0;
  for (const a of script.actions) {
    if ('stand' in a) {
      phases.push({
        from: t,
        to: t + a.stand,
        kind: 'stand',
        psi0: psi,
        dpsi: 0,
        x0: x,
        y0: y,
        steps: 0,
      });
      t += a.stand;
    } else if ('walk' in a) {
      const d = a.walk * STEP_MS;
      phases.push({
        from: t,
        to: t + d,
        kind: 'walk',
        psi0: psi,
        dpsi: 0,
        x0: x,
        y0: y,
        steps: a.walk,
      });
      x += a.walk * STEP_METRES * Math.sin(psi);
      y += a.walk * STEP_METRES * Math.cos(psi);
      t += d;
    } else if ('turn' in a) {
      const dpsi = a.turn * (Math.PI / 180);
      const d = Math.max(800, Math.round((1000 * Math.abs(a.turn)) / 90));
      phases.push({
        from: t,
        to: t + d,
        kind: 'turn',
        psi0: psi,
        dpsi,
        x0: x,
        y0: y,
        steps: 0,
      });
      t += d;
      psi += dpsi;
      phases.push({
        from: t,
        to: t + PAUSE_AFTER_TURN_MS,
        kind: 'stand',
        psi0: psi,
        dpsi: 0,
        x0: x,
        y0: y,
        steps: 0,
      });
      t += PAUSE_AFTER_TURN_MS;
    } else if ('mark' in a) {
      marks.push({ t, kind: a.mark, ...(a.label ? { label: a.label } : {}) });
    } else {
      scans.push({ t, ean: a.scan });
    }
  }
  return { phases, marks, scans, end: t };
}

interface State {
  x: number;
  y: number;
  /** True heading, clockwise from the first leg. */
  psi: number;
  /** d psi / dt, rad/s. */
  psiRate: number;
  /** Vertical acceleration of the bounce, and forward and lateral sway. */
  az: number;
  ay: number;
  ax: number;
  walking: boolean;
}

function stateAt(phases: Phase[], t: number): State {
  const p =
    phases.find((ph) => t >= ph.from && t < ph.to) ?? phases[phases.length - 1];
  const u = Math.min(1, Math.max(0, (t - p.from) / (p.to - p.from)));
  if (p.kind === 'walk') {
    const dist = ((t - p.from) / STEP_MS) * STEP_METRES;
    const cycle = ((t - p.from) % STEP_MS) / STEP_MS;
    return {
      x: p.x0 + dist * Math.sin(p.psi0),
      y: p.y0 + dist * Math.cos(p.psi0),
      psi: p.psi0,
      psiRate: 0,
      az: BOUNCE * Math.sin(2 * Math.PI * cycle),
      ay: 0.6 * Math.sin(2 * Math.PI * cycle + Math.PI / 3),
      ax: 0.35 * Math.sin(Math.PI * ((t - p.from) / STEP_MS)),
      walking: true,
    };
  }
  if (p.kind === 'turn') {
    const d = (p.to - p.from) / 1000;
    return {
      x: p.x0,
      y: p.y0,
      psi: p.psi0 + p.dpsi * (u - Math.sin(2 * Math.PI * u) / (2 * Math.PI)),
      psiRate: (p.dpsi * (1 - Math.cos(2 * Math.PI * u))) / d,
      az: 0,
      ay: 0,
      ax: 0,
      walking: false,
    };
  }
  return {
    x: p.x0,
    y: p.y0,
    psi: p.psi0 + p.dpsi,
    psiRate: 0,
    az: 0,
    ay: 0,
    ax: 0,
    walking: false,
  };
}

/** The hand's yaw sway while walking, and its rate. */
function sway(phases: Phase[], t: number): { yaw: number; rate: number } {
  const p = phases.find((ph) => t >= ph.from && t < ph.to);
  if (!p || p.kind !== 'walk') return { yaw: 0, rate: 0 };
  const w = Math.PI / (STEP_MS / 1000); // one sway cycle per two steps
  const s = (t - p.from) / 1000;
  return {
    yaw: SWAY_YAW * Math.sin(w * s),
    rate: SWAY_YAW * w * Math.cos(w * s),
  };
}

/** Rotation about world up by `theta` radians counterclockwise, as [x, y, z, w]. */
function yawQuaternion(theta: number): [number, number, number, number] {
  return [0, 0, Math.sin(theta / 2), Math.cos(theta / 2)];
}

/** A rotation matrix (columns are the images of device x, y, z) as [x, y, z, w]. */
function matrixToQuaternion(m: number[][]): [number, number, number, number] {
  const [m00, m01, m02] = m[0];
  const [m10, m11, m12] = m[1];
  const [m20, m21, m22] = m[2];
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    return [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}

export function synthesize(script: Script): Synthesized {
  const rand = mulberry32(script.seed);
  const noise = gaussian(rand);
  const { phases, marks, scans, end } = planPhases(script);
  const durationMs = end;

  const motion: number[][] = [];
  const samples: number[][] = [];
  for (let t = 0; t <= durationMs; t += 10) {
    const st = stateAt(phases, t);
    const sw = sway(phases, t);
    const ax = st.ax + 0.12 * noise();
    const ay = st.ay + 0.12 * noise();
    const az = G + st.az + 0.12 * noise();
    // A right turn (psi growing) is a clockwise rotation seen from above: -z.
    const wz = -(st.psiRate + sw.rate);
    const gx = GYRO_BIAS[0] + 0.008 * noise();
    const gy = GYRO_BIAS[1] + 0.008 * noise();
    const gz = wz + GYRO_BIAS[2] + 0.008 * noise();
    const row = [t, r(ax, 4), r(ay, 4), r(az, 4), r(gx, 5), r(gy, 5), r(gz, 5)];
    motion.push(row);
    samples.push([t, row[1], row[2], row[3], row[6]]);
  }

  const bearing0 = script.bearing * (Math.PI / 180);
  const game: number[][] = [];
  const absolute: number[][] = [];
  for (let t = 0; t <= durationMs; t += 20) {
    const st = stateAt(phases, t);
    const sw = sway(phases, t);
    const yaw = st.psi + sw.yaw;
    const gTheta =
      -(GAME_OFFSET + yaw + GAME_DRIFT * (t / 1000)) + 0.001 * noise();
    const aTheta = -(bearing0 + yaw) + 0.001 * noise();
    game.push([t, ...yawQuaternion(gTheta).map((v) => r(v, 6))]);
    absolute.push([t, ...yawQuaternion(aTheta).map((v) => r(v, 6))]);
  }

  const steps: number[] = [];
  for (const p of phases) {
    if (p.kind !== 'walk') continue;
    for (let i = 0; i < p.steps; i++) {
      steps.push(r(p.from + (i + 0.25) * STEP_MS + 120, 1));
    }
  }

  const pose: number[][] = [];
  const path: { t: number; x: number; y: number }[] = [];
  for (let k = 0; ; k++) {
    const t = r((k * 1000) / 30, 1);
    if (t > durationMs) break;
    const st = stateAt(phases, t);
    path.push({ t, x: st.x, y: st.y });
    const c = Math.cos(AR_YAW);
    const s = Math.sin(AR_YAW);
    const X = st.x * c - st.y * s;
    const negZ = st.x * s + st.y * c;
    const Y =
      1.2 + (st.walking ? 0.02 * Math.sin((2 * Math.PI * t) / STEP_MS) : 0);
    // Forward on the floor in AR coordinates, then right = forward × up.
    const psiAr = st.psi + sway(phases, t).yaw;
    const fx = Math.sin(psiAr) * c - Math.cos(psiAr) * s;
    const fNegZ = Math.sin(psiAr) * s + Math.cos(psiAr) * c;
    const f = [fx, 0, -fNegZ];
    const u = [0, 1, 0];
    const right = [
      f[1] * u[2] - f[2] * u[1],
      f[2] * u[0] - f[0] * u[2],
      f[0] * u[1] - f[1] * u[0],
    ];
    const m = [
      [right[0], f[0], u[0]],
      [right[1], f[1], u[1]],
      [right[2], f[2], u[2]],
    ];
    const q = matrixToQuaternion(m);
    pose.push([t, r(X, 4), r(Y, 4), r(-negZ, 4), ...q.map((v) => r(v, 6))]);
  }

  const location: number[][] = [];
  if (script.streams.location) {
    let ex = 0;
    let ey = 0;
    for (let t = 1000; t <= durationMs; t += 1000) {
      const st = stateAt(phases, t);
      ex = 0.8 * ex + 2 * noise();
      ey = 0.8 * ey + 2 * noise();
      const east = st.x * Math.cos(bearing0) + st.y * Math.sin(bearing0) + ex;
      const north = -st.x * Math.sin(bearing0) + st.y * Math.cos(bearing0) + ey;
      const lat = ORIGIN.lat + north / 111320;
      const lon =
        ORIGIN.lon + east / (111320 * Math.cos((ORIGIN.lat * Math.PI) / 180));
      location.push([t, r(lat, 7), r(lon, 7), r(8 + 6 * rand(), 1)]);
    }
  }

  let truthSteps = 0;
  let truthTurns = 0;
  for (const p of phases) {
    truthSteps += p.steps;
    if (p.kind === 'turn') truthTurns += 1;
  }

  const walk: WalkFile = {
    format: 'shop-walk',
    version: 1,
    id: script.id,
    name: script.name,
    startedAt: script.startedAt,
    durationMs,
    source: {
      platform: 'web',
      app: 'recorder-fixture-generator',
      appVersion: '1',
    },
    holding: 'flat',
    settings: { stepMetres: STEP_METRES, cellMetres: 0.5 },
    ...(location.length > 0
      ? {
          origin: {
            lat: location[0][1],
            lon: location[0][2],
            accuracyMetres: location[0][3],
          },
        }
      : {}),
    streams: {
      motion,
      game,
      ...(script.streams.absolute ? { absolute } : {}),
      steps,
      ...(location.length > 0 ? { location } : {}),
      pose,
    },
    poseSource: 'webxr',
    marks: marks.map((m) => ({ ...m })),
    events: [],
  };

  const actions = [
    ...marks.map((m) => ({
      t: m.t,
      kind: m.kind,
      ...(m.label ? { label: m.label } : {}),
    })),
    ...scans.map((s) => ({ t: s.t, kind: 'scan', ean: s.ean })),
  ].sort((a, b) => a.t - b.t);

  return {
    walk,
    trace: { samples, actions },
    truth: {
      steps: truthSteps,
      turns: truthTurns,
      distanceMetres: truthSteps * STEP_METRES,
      path,
    },
  };
}
