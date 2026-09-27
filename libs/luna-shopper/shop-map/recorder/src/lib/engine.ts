import {
  GyroHeading,
  HeadingSource,
  OwnStepDetector,
  RotationHeading,
  segmentConfidence,
  Snapper,
  WEINBERG_K,
  weinbergLength,
} from './estimators';
import {
  alignPoints,
  METRES_PER_DEGREE,
  normalizeDegrees,
  pathLength,
} from './geometry';
import { describeMode } from './modes';
import type {
  ModeDescription,
  ModeId,
  Track,
  TrackOptions,
  TrackPoint,
  TrackSegment,
} from './track-types';
import type { StreamName, WalkFile } from './walk-file';

export interface TrackEngine {
  push(stream: StreamName, row: number[] | number): void;
  track(): Track;
}

/**
 * The order streams are fed at an equal `t`: the order of the keys of
 * `WalkFile['streams']` in section 2. Within one stream, file order.
 */
export const STREAM_ORDER: readonly StreamName[] = [
  'motion',
  'game',
  'absolute',
  'magnetic',
  'steps',
  'location',
  'pose',
  'pressure',
];

interface RawTrack {
  points: TrackPoint[];
  steps: number;
  turns: number;
  segments: TrackSegment[];
  /** true when the pre alignment +y is north (absolute modes and gps). */
  northUp: boolean;
}

interface ModeEngine {
  push(stream: StreamName, row: number[] | number): void;
  raw(): RawTrack;
}

/**
 * A PDR track (section 4). One engine per mode, fed rows in time order.
 *
 * - At each `motion` row: the gyro heading (when the mode uses it) and the
 *   snapper are updated first, then the own step detector runs, so a step
 *   detected at that row is placed with the heading after that row.
 * - At each `game` or `absolute` row the rotation heading and the snapper are
 *   updated.
 * - A step takes the snapped heading `H` (snap modes) or the raw `psi` at the
 *   moment it is processed. Its point carries the step's own `t` (for an own
 *   step, the time of its largest `s`, which is before the row that emitted
 *   it). A step that arrives before the heading source has its first sample is
 *   ignored and not counted.
 * - Step length: `fixed` is `options.stepMetres ?? settings.stepMetres`.
 *   `weinberg` over an own step uses that step's `smax` and `smin`. Over an
 *   `hw` step it uses the largest and smallest `s` of the own detector's low
 *   pass over the motion rows since the previous `hw` step (the window is
 *   reset at every `hw` step, taken or ignored); with no motion row in the
 *   window, it falls back to the fixed length.
 * - The start point is `{ t: 0, x: 0, y: 0 }`.
 */
class PdrEngine implements ModeEngine {
  private readonly detector = new OwnStepDetector();
  private readonly gyro = new GyroHeading();
  private readonly rotation: RotationHeading | null;
  private readonly heading: HeadingSource;
  private snapper: Snapper | null = null;
  private readonly points: TrackPoint[] = [{ t: 0, x: 0, y: 0 }];
  private readonly segments: TrackSegment[] = [];
  private segmentStart = 0;
  private hwWindow: { max: number; min: number } | null = null;
  private readonly fixedLength: number;
  private readonly weinberg: boolean;
  private readonly k: number;

  constructor(
    private readonly mode: Required<
      Pick<ModeDescription, 'steps' | 'heading'>
    > &
      ModeDescription,
    settings: WalkFile['settings'],
    options: TrackOptions
  ) {
    this.fixedLength = options.stepMetres ?? settings.stepMetres;
    this.weinberg = options.stepModel === 'weinberg';
    this.k = options.weinbergK ?? WEINBERG_K;
    if (mode.heading === 'gyro') {
      this.rotation = null;
      this.heading = this.gyro;
    } else {
      this.rotation = new RotationHeading(mode.heading === 'absolute');
      this.heading = this.rotation;
    }
  }

  push(stream: StreamName, row: number[] | number): void {
    if (stream === 'motion' && Array.isArray(row)) {
      this.onMotion(row);
    } else if (
      (stream === 'game' || stream === 'absolute') &&
      stream === this.mode.heading &&
      Array.isArray(row) &&
      this.rotation
    ) {
      this.rotation.push(row[0], row[1], row[2], row[3], row[4]);
      this.afterHeading(row[0]);
    } else if (stream === 'steps' && this.mode.steps === 'hw') {
      this.onHardwareStep(typeof row === 'number' ? row : row[0]);
    }
  }

  private onMotion(row: number[]): void {
    const [t, ax, ay, az, gx, gy, gz] = row;
    if (this.mode.heading === 'gyro') {
      this.gyro.push(t, ax, ay, az, gx, gy, gz);
      this.afterHeading(t);
    }
    const step = this.detector.push(t, Math.hypot(ax, ay, az));
    const s = this.detector.s;
    if (this.hwWindow) {
      if (s > this.hwWindow.max) this.hwWindow.max = s;
      if (s < this.hwWindow.min) this.hwWindow.min = s;
    } else {
      this.hwWindow = { max: s, min: s };
    }
    if (step && this.mode.steps === 'own') {
      const length = this.weinberg
        ? weinbergLength(step.smax, step.smin, this.k)
        : this.fixedLength;
      this.step(step.t, length);
    }
  }

  private onHardwareStep(t: number): void {
    const window = this.hwWindow;
    this.hwWindow = null;
    const length =
      this.weinberg && window
        ? weinbergLength(window.max, window.min, this.k)
        : this.fixedLength;
    this.step(t, length);
  }

  private afterHeading(t: number): void {
    if (!this.mode.snap) return;
    if (!this.snapper) this.snapper = new Snapper(this.heading.psi);
    if (this.snapper.update(t, this.heading.psi, this.heading.rate)) {
      this.closeSegment();
    }
  }

  private step(t: number, length: number): void {
    if (!this.heading.ready) return;
    const h = this.snapper ? this.snapper.heading : this.heading.psi;
    const last = this.points[this.points.length - 1];
    this.points.push({
      t,
      x: last.x + length * Math.sin(h),
      y: last.y + length * Math.cos(h),
    });
  }

  /** Closes the current segment at a turn, when it holds at least one step. */
  private closeSegment(): void {
    const last = this.points.length - 1;
    if (last <= this.segmentStart) return;
    this.segments.push(this.segment(this.segmentStart, last));
    this.segmentStart = last;
  }

  private segment(fromIndex: number, toIndex: number): TrackSegment {
    return {
      fromIndex,
      toIndex,
      confidence: segmentConfidence(
        this.points[fromIndex].t,
        this.points[toIndex].t
      ),
    };
  }

  raw(): RawTrack {
    const last = this.points.length - 1;
    const segments = this.mode.snap ? [...this.segments] : [];
    const from = this.mode.snap ? this.segmentStart : 0;
    if (last > from || segments.length === 0) {
      segments.push(this.segment(from, last));
    }
    return {
      points: this.points.map((p) => ({ ...p })),
      steps: last,
      turns: this.snapper?.turns ?? 0,
      segments,
      northUp: this.mode.heading === 'absolute',
    };
  }
}

/**
 * `vio`: every `pose` row, the floor plane as `(x, -z)`, translated so the
 * first row is the origin. `gps`: every `location` row, equirectangular around
 * the first row (`x = dLon · 111320 · cos lat0`, `y = dLat · 111320`). Both
 * have one segment of confidence 1, no steps and no turns. Before the first
 * row the track is the single point `{ t: 0, x: 0, y: 0 }`.
 */
class DirectEngine implements ModeEngine {
  private readonly points: TrackPoint[] = [];
  private first: number[] | null = null;

  constructor(private readonly kind: 'vio' | 'gps') {}

  push(stream: StreamName, row: number[] | number): void {
    if (!Array.isArray(row)) return;
    if (this.kind === 'vio' && stream === 'pose') {
      if (!this.first) this.first = row;
      this.points.push({
        t: row[0],
        x: row[1] - this.first[1],
        y: this.first[3] - row[3],
      });
    } else if (this.kind === 'gps' && stream === 'location') {
      if (!this.first) this.first = row;
      const lat0 = this.first[1];
      this.points.push({
        t: row[0],
        x:
          (row[2] - this.first[2]) *
          METRES_PER_DEGREE *
          Math.cos(lat0 * (Math.PI / 180)),
        y: (row[1] - lat0) * METRES_PER_DEGREE,
      });
    }
  }

  raw(): RawTrack {
    const points =
      this.points.length > 0
        ? this.points.map((p) => ({ ...p }))
        : [{ t: 0, x: 0, y: 0 }];
    return {
      points,
      steps: 0,
      turns: 0,
      segments: [{ fromIndex: 0, toIndex: points.length - 1, confidence: 1 }],
      northUp: this.kind === 'gps',
    };
  }
}

function finishTrack(
  mode: ModeId,
  raw: RawTrack,
  options: TrackOptions
): Track {
  const aligned =
    options.align === false
      ? { points: raw.points, rotation: 0 }
      : alignPoints(raw.points);
  const track: Track = {
    mode,
    points: aligned.points,
    steps: raw.steps,
    turns: raw.turns,
    distanceMetres: pathLength(aligned.points),
    rotation: aligned.rotation,
    segments: raw.segments,
  };
  if (raw.northUp) {
    track.bearing = normalizeDegrees((aligned.rotation * 180) / Math.PI);
  }
  return track;
}

/**
 * A live engine: push rows as they arrive, in time order, and ask for the
 * track at any moment. `computeTrack` is exactly a fresh engine fed every row
 * of the file merged by `t` (ties in `STREAM_ORDER`).
 */
export function createTrackEngine(
  mode: ModeId,
  walk: Pick<WalkFile, 'settings' | 'origin'>,
  options: TrackOptions = {}
): TrackEngine {
  const d = describeMode(mode);
  const engine: ModeEngine =
    d.kind === 'pdr' && d.steps && d.heading
      ? new PdrEngine(
          { ...d, steps: d.steps, heading: d.heading },
          walk.settings,
          options
        )
      : new DirectEngine(d.kind === 'vio' ? 'vio' : 'gps');
  return {
    push: (stream, row) => engine.push(stream, row),
    track: () => finishTrack(mode, engine.raw(), options),
  };
}

function rowTime(row: number[] | number): number {
  return typeof row === 'number' ? row : row[0];
}

/**
 * Calls `visit` with every row of every stream, merged by `t`. At an equal
 * `t` the stream earlier in `STREAM_ORDER` goes first; within a stream, file
 * order is kept.
 */
export function forEachRowMerged(
  streams: WalkFile['streams'],
  visit: (stream: StreamName, row: number[] | number) => void,
  only?: readonly StreamName[]
): void {
  const names = STREAM_ORDER.filter(
    (n) => (!only || only.includes(n)) && (streams[n]?.length ?? 0) > 0
  );
  const lists = names.map((n) => streams[n] as (number[] | number)[]);
  const cursor = names.map(() => 0);
  for (;;) {
    let best = -1;
    let bestT = 0;
    for (let i = 0; i < names.length; i++) {
      if (cursor[i] >= lists[i].length) continue;
      const t = rowTime(lists[i][cursor[i]]);
      if (best === -1 || t < bestT) {
        best = i;
        bestT = t;
      }
    }
    if (best === -1) return;
    visit(names[best], lists[best][cursor[best]]);
    cursor[best] += 1;
  }
}

function streamsFor(d: ModeDescription): StreamName[] {
  if (d.kind === 'vio') return ['pose'];
  if (d.kind === 'gps') return ['location'];
  const s: StreamName[] = ['motion'];
  if (d.steps === 'hw') s.push('steps');
  if (d.heading === 'game' || d.heading === 'absolute') s.push(d.heading);
  return s;
}

/**
 * The track of one mode over a whole file. A mode whose streams the file
 * lacks answers the start point alone.
 */
export function computeTrack(
  walk: WalkFile,
  mode: ModeId,
  options: TrackOptions = {}
): Track {
  const engine = createTrackEngine(mode, walk, options);
  forEachRowMerged(
    walk.streams ?? {},
    engine.push,
    streamsFor(describeMode(mode))
  );
  return engine.track();
}
