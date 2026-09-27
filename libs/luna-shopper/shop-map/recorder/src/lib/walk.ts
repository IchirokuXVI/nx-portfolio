/**
 * The recorder of plan 0001: samples in, a grid walk out.
 */

export type Heading = 'n' | 's' | 'e' | 'w';

/** A grid cell. `x` grows east, `y` grows north, like the local plane. */
export interface Cell {
  x: number;
  y: number;
}

/**
 * Plan 0001 marks, extended with `checkpoint` so that the checkpoints of a
 * walk file (plan 0002) survive `trackToWalk`. A checkpoint draws nothing.
 */
export type WalkMarkKind =
  | 'entrance'
  | 'exit'
  | 'checkout'
  | 'counter'
  | 'checkpoint';

export interface Walk {
  segments: {
    from: Cell;
    to: Cell;
    heading: Heading;
    steps: number;
    confidence: number;
  }[];
  marks: { kind: WalkMarkKind; at: Cell; label?: string }[];
  scans: { ean: string; at: Cell; heading: Heading }[];
  notes: { text: string; at: Cell }[];
  startedAt: number;
  finishedAt: number;
}

export interface MotionSample {
  t: number; // ms
  accel: { x: number; y: number; z: number }; // including gravity, m/s²
  yawRate: number; // rad/s around the vertical axis, positive is a left turn
}

export interface RecorderOptions {
  cellMetres?: number; // 0.5
  stepMetres?: number; // 0.7
  start: { x: number; y: number; heading: Heading }; // the entrance cell
  onStep?: (position: { x: number; y: number }) => void;
  onTurn?: (heading: Heading) => void;
}

export interface WalkRecorder {
  push(sample: MotionSample): void;
  /** Plan 0001's four kinds, and `checkpoint` (see `WalkMarkKind`). */
  mark(kind: WalkMarkKind, label?: string): void;
  scan(ean: string): void;
  note(text: string): void;
  position(): { x: number; y: number; heading: Heading };
  finish(): Walk;
}
