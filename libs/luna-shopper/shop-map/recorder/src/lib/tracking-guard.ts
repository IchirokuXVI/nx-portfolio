/**
 * Recorder plan 0003: camera tracking and its guards.
 *
 * The camera is trusted while the compass agrees with it and the position
 * moves like a person, and not otherwise. This file touches no sensor: the
 * host (velista `0126`) owns the WebXR session and the compass listener, and
 * feeds their samples in here one at a time.
 *
 * Conventions:
 * - `t` is milliseconds on one clock shared by both streams.
 * - The map frame is the camera's: map `x` is the camera's `x` and map `y` is
 *   the camera's `z`, with the camera's `y` (up) ignored.
 * - A heading is degrees in [0, 360), 0 along map `+y` and clockwise as seen
 *   from above, so heading `h` points along `(-sin h, cos h)`. That is the
 *   same sense as a compass bearing, so compass minus camera heading stays
 *   put while the person turns, and only moves when the camera frame does.
 */
import {
  forwardBearing,
  multiplyQuaternions,
  normalizeQuaternion,
  type Quaternion,
} from './estimators';
import { normalizeDegrees } from './geometry';

/**
 * Poses stop for longer than this, and tracking is lost. Plan 0003 section 1.
 * On 2026-09-29 the last pose before the loss was at 920.43 s and ARCore
 * reported it lost at 920.51 s.
 */
export const LOST_AFTER_NO_POSE_MS = 500;

/**
 * Tracking lost for this long stops the walk. Plan 0003 section 1. The loss
 * of 2026-09-29 lasted 1.5 s (920.5 s to 922.0 s), so it resumed on its own.
 */
export const STOP_AFTER_LOST_MS = 3_000;

/**
 * The window of the compass minus camera heading median. Plan 0003 section 1.
 * With it the flipped frame of 2026-09-29 is caught 1.8 s after it came back.
 */
export const HEADING_WINDOW_MS = 5_000;

/**
 * How far that median may move from the baseline. Plan 0003 section 1. On
 * 2026-09-29 compass minus camera movement was −85.5 degrees (standard
 * deviation 19) before the loss, +76.9 in the flipped frame and −84.5 after
 * the jump back, so the flip moved it by about 160 degrees.
 */
export const HEADING_LIMIT_DEGREES = 45;

/**
 * One frame moving further than this is not a person walking. Plan 0003
 * section 1. On 2026-09-29 one frame at 1013.4 s moved 28.8 m, while a frame
 * of ordinary walking moves about 0.05 m at 30 Hz.
 */
export const JUMP_METRES = 2;

/**
 * The baseline is learned over this much unbroken good tracking. Plan 0003
 * section 1. On 2026-09-29 the first minute of good tracking on the second
 * El Jamón walk gave a baseline of 316.6 degrees (compass minus camera
 * heading), and the camera frame held until the loss at 920.5 s.
 */
export const BASELINE_MS = 60_000;

/** A path point is kept this far from the last kept one. Plan 0003 section 2. */
export const PATH_STEP_METRES = 0.25;

/** ...or this long after it, whichever comes first. Plan 0003 section 2. */
export const PATH_STEP_MS = 1_000;

/** A resume stands this far behind the mark it picked. Plan 0003 section 3. */
export const RESUME_BACK_METRES = 0.5;

/** One camera pose: the pose stream row of plan 0002 plus whether it is tracked. */
export interface PoseSample {
  t: number;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  /**
   * False when the pose is not tracked: WebXR's `emulatedPosition === true`,
   * or an ARCore tracking state other than tracking. An untracked sample only
   * needs `t`; its position and orientation are ignored.
   */
  tracked: boolean;
}

/** One compass sample: the `absolute` stream row of plan 0002. */
export interface CompassSample {
  t: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

export type TrackingStateKind = 'good' | 'lost' | 'suspect';

/** The `reason` of the walk log's `stopped` entry that a guard stop writes. */
export type TrackingStopReason = 'tracking-lost' | 'frame-moved';

/** Why the guard entered `suspect`. */
export type SuspectCause = 'returned' | 'heading' | 'jump';

export interface TrackingState {
  kind: TrackingStateKind;
  /** When the current kind was entered. */
  since: number;
  /** Why the state is `suspect`: the rule that fired last. */
  cause?: SuspectCause;
  /**
   * True while `suspect` came from poses returning after a loss shorter than
   * a stop. Path points kept meanwhile are the unconfirmed segment.
   */
  automaticResume: boolean;
  /** A stop the guard decided that the person has not answered yet. */
  stopped?: TrackingStopReason;
  /**
   * The circular median of compass minus camera heading over the first 60 s
   * of good tracking, in degrees. Store it with the walk, so a resume reuses it.
   */
  baseline?: number;
  /** The circular median of compass minus camera heading over the last 5 s. */
  offset?: number;
  /** True after `discard`: the walk stopped, and the guard reads nothing more. */
  ended: boolean;
}

/** What the guard decided, in the order it decided it. */
export type TrackingEvent =
  | { t: number; kind: 'lost'; cause: 'emulated' | 'no-pose' }
  | {
      t: number;
      kind: 'suspect';
      cause: SuspectCause;
      automaticResume: boolean;
      /** For `jump`: how far the frame moved. */
      metres?: number;
      /** For `heading`: the 5 s median minus the baseline, in (−180, 180]. */
      drift?: number;
    }
  | {
      t: number;
      kind: 'stopped';
      reason: TrackingStopReason;
      /**
       * True when the stop ends an unconfirmed segment: path points kept
       * since an automatic resume that nobody confirmed. They may be in a
       * moved frame (a `frame-moved` stop during an automatic resume is
       * exactly that), so the host drops them and saves the walk only up to
       * the loss. Absent when there is nothing unconfirmed to drop.
       */
      unconfirmedDropped?: true;
    }
  | { t: number; kind: 'baseline'; degrees: number }
  | { t: number; kind: 'confirmed' }
  | { t: number; kind: 'discarded' };

export interface TrackingGuardOptions {
  /** The baseline stored with the walk, for a resumed session. */
  baseline?: number;
}

export interface TrackingGuard {
  /** Feeds one camera pose. Answers what it decided, usually nothing. */
  pushPose(sample: PoseSample): TrackingEvent[];
  /** Feeds one compass sample. Answers what it decided, usually nothing. */
  pushCompass(sample: CompassSample): TrackingEvent[];
  /** The person said the unconfirmed path is right: back to `good`. */
  confirm(t: number): TrackingEvent[];
  /** The person said "No, stop here": the walk stops at the problem. */
  discard(t: number): TrackingEvent[];
  state(): TrackingState;
  /** Everything decided since the guard was created. */
  events(): readonly TrackingEvent[];
}

/** An angle in (−180, 180]. */
export function wrapDegrees(a: number): number {
  const r = normalizeDegrees(a);
  return r > 180 ? r - 360 : r;
}

/**
 * The circular median of angles in degrees: the median of their differences
 * from the circular mean, added back to the mean. Answers undefined for none.
 */
export function circularMedian(degrees: readonly number[]): number | undefined {
  if (degrees.length === 0) return undefined;
  let c = 0;
  let s = 0;
  for (const d of degrees) {
    c += Math.cos((d * Math.PI) / 180);
    s += Math.sin((d * Math.PI) / 180);
  }
  const mean = (Math.atan2(s, c) * 180) / Math.PI;
  const diffs = degrees.map((d) => wrapDegrees(d - mean)).sort((a, b) => a - b);
  const mid = diffs.length >> 1;
  const median =
    diffs.length % 2 === 1 ? diffs[mid] : (diffs[mid - 1] + diffs[mid]) / 2;
  return normalizeDegrees(mean + median);
}

/** A pose's position in the map frame. */
export function mapPoint(pose: Pick<PoseSample, 'x' | 'z'>): {
  x: number;
  y: number;
} {
  return { x: pose.x, y: pose.z };
}

/**
 * Where the phone points, as a heading of the map frame. The camera's `-z`,
 * or its `+y` when the phone lies flat, by the rule of plan 0002 section 5.3
 * (`-z` once `+y` points more than 45 degrees up or down).
 */
export function cameraHeading(
  pose: Pick<PoseSample, 'qx' | 'qy' | 'qz' | 'qw'>
): number {
  const [x, y, z, w] = normalizeQuaternion([
    pose.qx,
    pose.qy,
    pose.qz,
    pose.qw,
  ]);
  // The camera's +y and -z in the camera world, where y is up.
  const up = [
    2 * (x * y - z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z + x * w),
  ];
  const back = [
    2 * (x * z + y * w),
    2 * (y * z - x * w),
    1 - 2 * (x * x + y * y),
  ];
  const f = Math.abs(up[1]) > Math.SQRT1_2 ? back.map((v) => -v) : up;
  // Heading h points along (-sin h, cos h) in map (x, y) = camera (x, z).
  return normalizeDegrees((Math.atan2(-f[0], f[2]) * 180) / Math.PI);
}

/** The compass bearing of where the phone points, degrees clockwise from north. */
export function compassHeading(
  sample: Pick<CompassSample, 'qx' | 'qy' | 'qz' | 'qw'>
): number {
  const bearing = forwardBearing([sample.qx, sample.qy, sample.qz, sample.qw]);
  return normalizeDegrees((bearing * 180) / Math.PI);
}

export function createTrackingGuard(
  options: TrackingGuardOptions = {}
): TrackingGuard {
  let kind: TrackingStateKind = 'good';
  let since: number | undefined;
  let cause: SuspectCause | undefined;
  let automaticResume = false;
  let stopped: TrackingStopReason | undefined;
  let ended = false;
  let baseline =
    options.baseline === undefined
      ? undefined
      : normalizeDegrees(options.baseline);

  let lastTracked: PoseSample | undefined;
  let lostFrom: number | undefined;
  let compass: number | undefined;
  let window: { t: number; offset: number }[] = [];
  let offset: number | undefined;
  let learning: { t: number; offset: number }[] = [];
  let disagreeing = false;
  /** An automatic resume kept points that nobody has confirmed yet. */
  let unconfirmed = false;
  const log: TrackingEvent[] = [];

  function emit(out: TrackingEvent[], e: TrackingEvent): void {
    out.push(e);
    log.push(e);
  }

  function enter(next: TrackingStateKind, t: number): void {
    if (kind !== next) since = t;
    // The baseline needs 60 s of unbroken good tracking. Tracking that comes
    // back after a loss can be in another frame, so a stretch cut short is
    // thrown away rather than added to.
    if (kind === 'good' && next !== 'good' && baseline === undefined) {
      learning = [];
    }
    kind = next;
  }

  function stop(out: TrackingEvent[], t: number, reason: TrackingStopReason) {
    if (stopped !== undefined) return;
    stopped = reason;
    automaticResume = false;
    const dropped = unconfirmed;
    unconfirmed = false;
    emit(out, {
      t,
      kind: 'stopped',
      reason,
      ...(dropped ? { unconfirmedDropped: true as const } : {}),
    });
  }

  function lose(out: TrackingEvent[], t: number, why: 'emulated' | 'no-pose') {
    enter('lost', t);
    cause = undefined;
    automaticResume = false;
    lostFrom = t;
    lastTracked = undefined;
    emit(out, { t, kind: 'lost', cause: why });
  }

  /** The two clock rules: no pose for 0.5 s, and lost for 3 s. */
  function clock(out: TrackingEvent[], t: number): void {
    if (
      kind !== 'lost' &&
      lastTracked !== undefined &&
      t - lastTracked.t > LOST_AFTER_NO_POSE_MS
    ) {
      lose(out, lastTracked.t + LOST_AFTER_NO_POSE_MS, 'no-pose');
    }
    if (
      kind === 'lost' &&
      lostFrom !== undefined &&
      t - lostFrom >= STOP_AFTER_LOST_MS
    ) {
      stop(out, lostFrom + STOP_AFTER_LOST_MS, 'tracking-lost');
    }
  }

  /** The heading and jump rules: the frame moved. */
  function frameMoved(
    out: TrackingEvent[],
    t: number,
    rule: 'heading' | 'jump',
    detail: { metres?: number; drift?: number }
  ): void {
    enter('suspect', t);
    cause = rule;
    const resuming = automaticResume && stopped === undefined;
    emit(out, {
      t,
      kind: 'suspect',
      cause: rule,
      automaticResume: resuming,
      ...detail,
    });
    stop(out, t, 'frame-moved');
  }

  function heading(out: TrackingEvent[], sample: PoseSample): void {
    if (compass === undefined) return;
    const o = normalizeDegrees(compass - cameraHeading(sample));
    window.push({ t: sample.t, offset: o });
    window = window.filter((p) => p.t > sample.t - HEADING_WINDOW_MS);
    offset = circularMedian(window.map((p) => p.offset));

    if (baseline === undefined && kind === 'good') {
      learning.push({ t: sample.t, offset: o });
      if (sample.t - learning[0].t >= BASELINE_MS) {
        baseline = circularMedian(learning.map((p) => p.offset));
        learning = [];
        if (baseline !== undefined) {
          emit(out, { t: sample.t, kind: 'baseline', degrees: baseline });
        }
      }
    }
    if (baseline === undefined || offset === undefined) return;
    const drift = wrapDegrees(offset - baseline);
    const disagrees = Math.abs(drift) > HEADING_LIMIT_DEGREES;
    if (disagrees && !disagreeing) {
      frameMoved(out, sample.t, 'heading', { drift });
    }
    disagreeing = disagrees;
  }

  return {
    pushPose(sample) {
      const out: TrackingEvent[] = [];
      if (ended) return out;
      since ??= sample.t;
      clock(out, sample.t);
      if (!sample.tracked) {
        if (kind !== 'lost') lose(out, sample.t, 'emulated');
        clock(out, sample.t);
        return out;
      }
      if (kind === 'lost') {
        enter('suspect', sample.t);
        cause = 'returned';
        // A loss short of a stop resumes on its own; after a stop, the walk
        // has stopped and only the person resumes it.
        automaticResume = stopped === undefined;
        if (automaticResume) unconfirmed = true;
        lostFrom = undefined;
        emit(out, {
          t: sample.t,
          kind: 'suspect',
          cause: 'returned',
          automaticResume,
        });
      } else if (lastTracked !== undefined) {
        const metres = Math.hypot(
          sample.x - lastTracked.x,
          sample.z - lastTracked.z
        );
        if (metres > JUMP_METRES) {
          frameMoved(out, sample.t, 'jump', { metres });
        }
      }
      lastTracked = sample;
      heading(out, sample);
      return out;
    },

    pushCompass(sample) {
      const out: TrackingEvent[] = [];
      if (ended) return out;
      since ??= sample.t;
      compass = compassHeading(sample);
      clock(out, sample.t);
      return out;
    },

    confirm(t) {
      const out: TrackingEvent[] = [];
      if (ended || kind !== 'suspect') return out;
      enter('good', t);
      cause = undefined;
      automaticResume = false;
      unconfirmed = false;
      stopped = undefined;
      // A compass that still disagrees fires again on the next pose.
      disagreeing = false;
      emit(out, { t, kind: 'confirmed' });
      return out;
    },

    discard(t) {
      const out: TrackingEvent[] = [];
      if (ended) return out;
      ended = true;
      automaticResume = false;
      unconfirmed = false;
      emit(out, { t, kind: 'discarded' });
      return out;
    },

    state() {
      return {
        kind,
        since: since ?? 0,
        ...(cause === undefined ? {} : { cause }),
        automaticResume,
        ...(stopped === undefined ? {} : { stopped }),
        ...(baseline === undefined ? {} : { baseline }),
        ...(offset === undefined ? {} : { offset }),
        ended,
      };
    },

    events() {
      return log;
    },
  };
}

/** A point of the walked path, in map metres, with its time in milliseconds. */
export interface PathPoint {
  t: number;
  x: number;
  y: number;
}

/**
 * Plan 0003 section 2: whether the walk log keeps `next`. A point is kept
 * 0.25 m or more from the last kept one, or one second after it, whichever
 * comes first, and only while the state is `good` or `suspect` with an
 * automatic resume. The first point is kept when the state allows it.
 */
export function keepPathPoint(
  previous: PathPoint | null | undefined,
  next: PathPoint,
  state: Pick<TrackingState, 'kind' | 'automaticResume'>
): boolean {
  const allowed =
    state.kind === 'good' ||
    (state.kind === 'suspect' && state.automaticResume);
  if (!allowed) return false;
  if (!previous) return true;
  return (
    next.t - previous.t >= PATH_STEP_MS ||
    Math.hypot(next.x - previous.x, next.y - previous.y) >= PATH_STEP_METRES
  );
}

/**
 * A 2D rigid transform of the map frame: rotate by `rotation` degrees (the
 * heading sense, clockwise from above) about the origin, then move by `x, y`.
 */
export interface RigidTransform {
  rotation: number;
  x: number;
  y: number;
}

export interface AlignSessionInput {
  /** The mark the person picked, in the walk's frame. `MapMark` fits. */
  mark: { x: number; y: number; heading: number };
  /** Where the person stands, in the new session's map frame (`mapPoint`). */
  standingAt: { x: number; y: number };
  /** The new session's compass minus camera heading (`state().offset`). */
  compassOffset: number;
  /** The walk's baseline (`state().baseline` of the first session). */
  baseline: number;
}

/**
 * Plan 0003 section 3. The rotation is the new session's compass offset minus
 * the walk's baseline, and the translation puts the person on the mark moved
 * 0.5 m back along its heading.
 */
export function alignSession(input: AlignSessionInput): RigidTransform {
  const rotation = normalizeDegrees(input.compassOffset - input.baseline);
  const h = (input.mark.heading * Math.PI) / 180;
  const target = {
    x: input.mark.x + RESUME_BACK_METRES * Math.sin(h),
    y: input.mark.y - RESUME_BACK_METRES * Math.cos(h),
  };
  const turned = applyRigid({ rotation, x: 0, y: 0 }, input.standingAt);
  return { rotation, x: target.x - turned.x, y: target.y - turned.y };
}

/** Applies a rigid transform to a point of the map frame. */
export function applyRigid(
  transform: RigidTransform,
  point: { x: number; y: number }
): { x: number; y: number } {
  const r = (transform.rotation * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return {
    x: c * point.x - s * point.y + transform.x,
    y: s * point.x + c * point.y + transform.y,
  };
}

/**
 * Applies a rigid transform to a camera pose: its position in the map frame
 * and its orientation about the vertical, so `cameraHeading` of the answer is
 * the pose's heading plus the rotation. Height is kept as it is.
 */
export function alignPose(
  transform: RigidTransform,
  pose: PoseSample
): PoseSample {
  const p = applyRigid(transform, mapPoint(pose));
  // Turning a heading clockwise from above is a negative turn about +y.
  const half = -(transform.rotation * Math.PI) / 180 / 2;
  const turn: Quaternion = [0, Math.sin(half), 0, Math.cos(half)];
  const [qx, qy, qz, qw] = multiplyQuaternions(turn, [
    pose.qx,
    pose.qy,
    pose.qz,
    pose.qw,
  ]);
  return { ...pose, x: p.x, z: p.y, qx, qy, qz, qw };
}
