import {
  GyroHeading,
  OwnStepDetector,
  segmentConfidence,
  Snapper,
} from './estimators';
import type {
  Cell,
  Heading,
  RecorderOptions,
  Walk,
  WalkMarkKind,
  WalkRecorder,
} from './walk';

const HEADINGS: readonly Heading[] = ['n', 'e', 's', 'w'];

/** Radians clockwise from +y (north) of a grid heading. */
export function headingRadians(h: Heading): number {
  return HEADINGS.indexOf(h) * (Math.PI / 2);
}

/** The grid heading nearest an angle in radians clockwise from +y. */
export function headingOf(radians: number): Heading {
  const quarter = Math.round(radians / (Math.PI / 2));
  return HEADINGS[((quarter % 4) + 4) % 4];
}

/** One cell along a grid heading. */
export function headingStep(h: Heading): Cell {
  switch (h) {
    case 'n':
      return { x: 0, y: 1 };
    case 's':
      return { x: 0, y: -1 };
    case 'e':
      return { x: 1, y: 0 };
    default:
      return { x: -1, y: 0 };
  }
}

/**
 * Plan 0001's recorder, which is mode `pdr:own:gyro:snap` of plan 0002 over
 * samples whose yaw rate the host already projected on gravity (the
 * `ω · g / |g|` of section 5.2, which for a phone held flat is its z rate).
 *
 * - The own step detector of 5.1 runs over `|accel|`, the heading integrates
 *   `psi -= yawRate · dt` from the start heading, and the snapper of 5.4 runs
 *   after every sample, before the step detector.
 * - The position is kept in metres from the start cell, one step length along
 *   the snapped grid heading per step, and the cell is the start cell plus
 *   that position divided by `cellMetres` and rounded. Rounding the whole
 *   position rather than each segment keeps the error under half a cell
 *   instead of adding one per segment, and since the heading is one of four,
 *   a segment is still a straight run of cells.
 * - A turn with no step since the previous one changes the current segment's
 *   heading instead of closing an empty segment.
 * - A segment's confidence is `exp(-seconds / 60)` from its start (a turn, or
 *   the first sample) to its end (the next turn, or the last sample).
 * - `startedAt` and `finishedAt` are the first and last sample's `t`.
 */
export function createWalkRecorder(options: RecorderOptions): WalkRecorder {
  const cellMetres = options.cellMetres ?? 0.5;
  const stepMetres = options.stepMetres ?? 0.7;
  const detector = new OwnStepDetector();
  const gyro = new GyroHeading();
  gyro.psi = headingRadians(options.start.heading);
  const snapper = new Snapper(gyro.psi);

  const walk: Walk = {
    segments: [],
    marks: [],
    scans: [],
    notes: [],
    startedAt: 0,
    finishedAt: 0,
  };
  let started = false;
  let lastT = 0;
  let segment = {
    from: { x: options.start.x, y: options.start.y },
    heading: options.start.heading,
    steps: 0,
    startT: 0,
  };
  let cell: Cell = { ...segment.from };
  let metres = { x: 0, y: 0 };

  function closeSegment(endT: number): void {
    walk.segments.push({
      from: { ...segment.from },
      to: { ...cell },
      heading: segment.heading,
      steps: segment.steps,
      confidence: segmentConfidence(segment.startT, endT),
    });
  }

  return {
    push(sample) {
      const dt = started ? (sample.t - lastT) / 1000 : 0;
      if (!started) {
        started = true;
        walk.startedAt = sample.t;
        segment.startT = sample.t;
      }
      lastT = sample.t;
      gyro.pushYawRate(sample.yawRate, dt);
      if (snapper.update(sample.t, gyro.psi, gyro.rate)) {
        const heading = headingOf(snapper.heading);
        if (segment.steps > 0) {
          closeSegment(sample.t);
          segment = { from: { ...cell }, heading, steps: 0, startT: sample.t };
        } else {
          segment.heading = heading;
        }
        options.onTurn?.(heading);
      }
      const { x, y, z } = sample.accel;
      if (detector.push(sample.t, Math.hypot(x, y, z))) {
        segment.steps += 1;
        const d = headingStep(segment.heading);
        metres = {
          x: metres.x + stepMetres * d.x,
          y: metres.y + stepMetres * d.y,
        };
        cell = {
          x: options.start.x + Math.round(metres.x / cellMetres),
          y: options.start.y + Math.round(metres.y / cellMetres),
        };
        options.onStep?.({ ...cell });
      }
    },
    mark(kind: WalkMarkKind, label?: string) {
      walk.marks.push({
        kind,
        at: { ...cell },
        ...(label !== undefined ? { label } : {}),
      });
    },
    scan(ean) {
      walk.scans.push({ ean, at: { ...cell }, heading: segment.heading });
    },
    note(text) {
      walk.notes.push({ text, at: { ...cell } });
    },
    position() {
      return { ...cell, heading: segment.heading };
    },
    finish() {
      if (segment.steps > 0 || walk.segments.length === 0) closeSegment(lastT);
      walk.finishedAt = lastT;
      return {
        segments: walk.segments.map((s) => ({ ...s })),
        marks: walk.marks.map((m) => ({ ...m })),
        scans: walk.scans.map((s) => ({ ...s })),
        notes: walk.notes.map((n) => ({ ...n })),
        startedAt: walk.startedAt,
        finishedAt: walk.finishedAt,
      };
    },
  };
}
