import {
  applyRigid,
  type RigidTransform,
} from '@portfolio/luna-shopper/shop-map/recorder';
import { SCRIPTED_WALK_FACING, SCRIPTED_WALK_PATH } from './scripted-walk-data';
import type {
  WalkPoseReading,
  WalkSensorListener,
  WalkSensorSession,
  WalkSensorsI,
} from './walk-sensors';

/** A moment the scripted camera loses its place. */
export interface ScriptedIncident {
  /** When, in milliseconds of the script. */
  readonly at: number;
  /** For how long no pose is tracked. Under 3 s the guard resumes by itself. */
  readonly lostMs: number;
  /**
   * The camera's frame after it comes back, relative to the walk's frame: what
   * ARCore did on 2026-09-29 when it came back turned 158.5 degrees.
   */
  readonly frame?: RigidTransform;
  /** How long the walker walks on after it comes back, before going to stand. */
  readonly walkMs?: number;
  /**
   * Then the walker stands where the path was at `pathMs`, facing what was marked
   * there, for `holdMs`, and walks on from there: the person standing next to a
   * mark for a manual resume.
   */
  readonly stand?: { readonly pathMs: number; readonly holdMs: number };
}

export interface ScriptedWalk {
  /** `[ms, x, y]`, metres in the walk's frame. */
  readonly path: readonly (readonly [number, number, number])[];
  /** `[ms, heading]`: when the walker faced what they marked. */
  readonly facing: readonly (readonly [number, number])[];
  readonly incidents: readonly ScriptedIncident[];
}

/**
 * The walk the browser check replays (velista `0126`): the first minutes of the
 * second El Jamón walk, with three incidents.
 *
 * 1. At 100 s tracking is lost for 1.5 s and comes back in the same frame: the
 *    automatic resume whose purple path is right.
 * 2. At 150 s it is lost for 1.5 s and comes back moved 2.5 m: the purple path
 *    runs beside the real one, so the person answers "No, stop here". The walker
 *    then goes to stand where "Menaje" was marked (109 s) for two minutes.
 * 3. At 330 s it is lost for 4 s, which stops the walk, and comes back turned
 *    158.5 degrees. The walker stands where "Horno de pan" was marked (79 s) for
 *    two minutes, then walks on.
 */
export const EL_JAMON_SCRIPT: ScriptedWalk = {
  path: SCRIPTED_WALK_PATH,
  facing: SCRIPTED_WALK_FACING,
  incidents: [
    { at: 100_000, lostMs: 1_500 },
    {
      at: 150_000,
      lostMs: 1_500,
      frame: { rotation: 0, x: 2.5, y: 1.5 },
      walkMs: 25_000,
      stand: { pathMs: 109_100, holdMs: 120_000 },
    },
    {
      at: 330_000,
      lostMs: 4_000,
      frame: { rotation: 158.5, x: 30, y: -10 },
      stand: { pathMs: 78_900, holdMs: 120_000 },
    },
  ],
};

/**
 * Compass minus camera heading in the walk's frame: the baseline the first
 * minute of the real walk learned.
 */
export const SCRIPTED_COMPASS_OFFSET = 316.6;

/** How often a pose and a compass reading are made, in milliseconds of the script. */
const SAMPLE_MS = 100;

/** How high the phone is held, in metres. */
const HEIGHT = 1.4;

/** A facing holds this long either side of its mark. */
const FACING_MS = 2_500;

type Segment =
  | {
      kind: 'walk';
      from: number;
      to: number;
      pathFrom: number;
      frame: RigidTransform;
    }
  | { kind: 'lost'; from: number; to: number }
  | {
      kind: 'stand';
      from: number;
      to: number;
      pathMs: number;
      frame: RigidTransform;
    };

const IDENTITY: RigidTransform = { rotation: 0, x: 0, y: 0 };

/** The script as segments of script time. Pure, for the spec. */
export function scriptSegments(script: ScriptedWalk): Segment[] {
  const segments: Segment[] = [];
  let s = 0;
  let p = 0;
  let frame = IDENTITY;
  for (const incident of script.incidents) {
    segments.push({
      kind: 'walk',
      from: s,
      to: incident.at,
      pathFrom: p,
      frame,
    });
    p += incident.at - s;
    s = incident.at;
    segments.push({ kind: 'lost', from: s, to: s + incident.lostMs });
    p += incident.lostMs;
    s += incident.lostMs;
    frame = incident.frame ?? frame;
    if (incident.walkMs !== undefined) {
      segments.push({
        kind: 'walk',
        from: s,
        to: s + incident.walkMs,
        pathFrom: p,
        frame,
      });
      p += incident.walkMs;
      s += incident.walkMs;
    }
    if (incident.stand !== undefined) {
      segments.push({
        kind: 'stand',
        from: s,
        to: s + incident.stand.holdMs,
        pathMs: incident.stand.pathMs,
        frame,
      });
      s += incident.stand.holdMs;
      p = incident.stand.pathMs;
    }
  }
  segments.push({
    kind: 'walk',
    from: s,
    to: Number.POSITIVE_INFINITY,
    pathFrom: p,
    frame,
  });
  return segments;
}

/** Where the path is at `ms`, interpolated, held at both ends. */
export function pathAt(
  path: ScriptedWalk['path'],
  ms: number
): { x: number; y: number } {
  if (path.length === 0) {
    return { x: 0, y: 0 };
  }
  if (ms <= path[0][0]) {
    return { x: path[0][1], y: path[0][2] };
  }
  for (let i = 1; i < path.length; i++) {
    const [t1, x1, y1] = path[i];
    if (ms <= t1) {
      const [t0, x0, y0] = path[i - 1];
      const f = t1 === t0 ? 1 : (ms - t0) / (t1 - t0);
      return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f };
    }
  }
  const last = path[path.length - 1];
  return { x: last[1], y: last[2] };
}

/** The heading the walker faces at path time `ms`, in the walk's frame. */
export function headingAt(
  script: ScriptedWalk,
  ms: number,
  previous: number
): number {
  for (const [at, heading] of script.facing) {
    if (Math.abs(at - ms) <= FACING_MS) {
      return heading;
    }
  }
  const a = pathAt(script.path, ms - 1_000);
  const b = pathAt(script.path, ms + 1_000);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.hypot(dx, dy) < 0.2) {
    return previous;
  }
  // Heading h points along (-sin h, cos h).
  return normalize((Math.atan2(-dx, dy) * 180) / Math.PI);
}

/**
 * The camera pose for a heading: a turn about the vertical, so the phone is
 * upright, by `a = 180 - h` (the recorder's `cameraHeading` reads the camera's
 * `-z`).
 */
export function uprightQuaternion(
  heading: number
): [number, number, number, number] {
  const a = ((180 - heading) * Math.PI) / 180;
  return [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
}

/** The absolute orientation for a compass bearing: the phone flat, turned `-b` about up. */
export function compassQuaternion(
  bearing: number
): [number, number, number, number] {
  const b = (-bearing * Math.PI) / 180;
  return [0, 0, Math.sin(b / 2), Math.cos(b / 2)];
}

function normalize(degrees: number): number {
  const r = degrees % 360;
  return r < 0 ? r + 360 : r;
}

/**
 * A walk replayed instead of the camera and the compass (velista `0126`), for
 * the specs and for the browser check, which have no phone and no WebXR. Dev
 * builds reach it through `?fakeWalk=1`.
 *
 * Every 100 ms of the script it makes one pose and one compass reading, on the
 * `performance.now()` clock from the start, and a timer plays the script at
 * `speed` times real time.
 */
export class ScriptedWalkSensors implements WalkSensorsI {
  private readonly _segments: Segment[];

  constructor(
    private readonly _document: Document,
    private readonly _options: {
      readonly speed: number;
      readonly script?: ScriptedWalk;
      /** How often the timer runs, in real milliseconds. */
      readonly tickMs?: number;
    }
  ) {
    this._segments = scriptSegments(this._script);
  }

  private get _script(): ScriptedWalk {
    return this._options.script ?? EL_JAMON_SCRIPT;
  }

  async supported(): Promise<boolean> {
    return true;
  }

  async start(
    _overlayRoot: Element | null,
    listener: WalkSensorListener
  ): Promise<WalkSensorSession> {
    const win = this._document.defaultView;
    const base = win?.performance.now() ?? Date.now();
    const tickMs = this._options.tickMs ?? 100;
    const step = tickMs * this._options.speed;
    let s = 0;
    let heading = 0;
    let running = true;

    const sample = (at: number) => {
      const segment =
        this._segments.find((one) => at >= one.from && at < one.to) ??
        this._segments[this._segments.length - 1];
      const t = base + at;
      const compass = () => {
        const [cx, cy, cz, cw] = compassQuaternion(
          heading + SCRIPTED_COMPASS_OFFSET
        );
        listener.compass({ t, qx: cx, qy: cy, qz: cz, qw: cw });
      };
      if (segment.kind === 'lost') {
        // The camera lost its place; the compass did not.
        listener.pose(untrackedAt(t));
        compass();
        return;
      }
      const pathMs =
        segment.kind === 'walk'
          ? segment.pathFrom + (at - segment.from)
          : segment.pathMs;
      heading = headingAt(this._script, pathMs, heading);
      const truth = pathAt(this._script.path, pathMs);
      const raw = applyRigid(segment.frame, truth);
      const [qx, qy, qz, qw] = uprightQuaternion(
        heading + segment.frame.rotation
      );
      listener.pose({
        t,
        x: raw.x,
        y: HEIGHT,
        z: raw.y,
        qx,
        qy,
        qz,
        qw,
        tracked: true,
      });
      compass();
    };

    const timer = setInterval(() => {
      if (!running) {
        return;
      }
      const until = s + step;
      for (; s < until; s += SAMPLE_MS) {
        sample(s);
      }
    }, tickMs);

    return {
      showing: () => running,
      end: () => {
        running = false;
        clearInterval(timer);
      },
    };
  }
}

function untrackedAt(t: number): WalkPoseReading {
  return { t, x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, tracked: false };
}
