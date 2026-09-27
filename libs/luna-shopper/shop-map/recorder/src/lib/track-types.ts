/**
 * A positioning mode id, recorder plan 0002 section 4: `pdr:<steps>:<heading>`
 * with an optional `:snap`, or `vio`, or `gps`.
 */
export type ModeId = string;

export interface TrackPoint {
  t: number;
  x: number;
  y: number;
}

export interface TrackSegment {
  fromIndex: number;
  toIndex: number;
  confidence: number;
}

export interface Track {
  mode: ModeId;
  /** Aligned (section 5.6) unless `options.align === false`. */
  points: TrackPoint[];
  steps: number;
  turns: number;
  distanceMetres: number;
  /** Radians applied by alignment, counterclockwise positive. */
  rotation: number;
  /** Degrees clockwise from north of aligned +y, when the mode knows it. */
  bearing?: number;
  /** Between turns, with confidence (5.4 step 5). One segment for non snap modes. */
  segments: TrackSegment[];
}

export interface TrackOptions {
  stepModel?: 'fixed' | 'weinberg';
  /** Overrides `settings.stepMetres` for the fixed model. */
  stepMetres?: number;
  /** 0.48 by default. */
  weinbergK?: number;
  /** true by default. */
  align?: boolean;
}

export interface TrackMetrics {
  steps: number;
  turns: number;
  distanceMetres: number;
  endToStartMetres: number;
  checkpoints: { label: string; count: number; errorMetres: number }[];
}

export interface ModeDescription {
  steps?: 'own' | 'hw';
  heading?: 'gyro' | 'game' | 'absolute';
  snap: boolean;
  kind: 'pdr' | 'vio' | 'gps';
}
