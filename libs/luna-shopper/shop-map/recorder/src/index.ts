// Recorder plan 0001: steps, turns and scans.
export { trackToWalk, walkToDocument } from './lib/draft';
export type { WalkToDocumentOptions } from './lib/draft';
export { createWalkRecorder } from './lib/recorder';
export type {
  Cell,
  Heading,
  MotionSample,
  RecorderOptions,
  Walk,
  WalkMarkKind,
  WalkRecorder,
} from './lib/walk';

// Recorder plan 0002: the walk file and the positioning modes.
export { computeTrack, createTrackEngine } from './lib/engine';
export type { TrackEngine } from './lib/engine';
export { walkToGeoJson } from './lib/geojson';
export { positionAt, trackMetrics } from './lib/metrics';
export { availableModes, describeMode } from './lib/modes';
export type {
  ModeDescription,
  ModeId,
  Track,
  TrackMetrics,
  TrackOptions,
  TrackPoint,
  TrackSegment,
} from './lib/track-types';
export type { StreamName, WalkFile, WalkMark } from './lib/walk-file';
export {
  MARK_DELETED,
  WalkFileError,
  parseWalkImport,
  readWalkFile,
  walkFileName,
  withoutDeletedMarks,
} from './lib/walk-import';
export type { WalkFileErrorCode, WalkImport } from './lib/walk-import';
