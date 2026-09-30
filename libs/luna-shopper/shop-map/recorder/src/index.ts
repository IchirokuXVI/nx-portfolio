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
  WalkFileError,
  parseWalkImport,
  readWalkFile,
  walkFileName,
} from './lib/walk-import';
export type { WalkFileErrorCode, WalkImport } from './lib/walk-import';

// Recorder plan 0003: camera tracking and its guards.
export {
  BASELINE_MS,
  HEADING_LIMIT_DEGREES,
  HEADING_WINDOW_MS,
  JUMP_METRES,
  LOST_AFTER_NO_POSE_MS,
  PATH_STEP_METRES,
  PATH_STEP_MS,
  RESUME_BACK_METRES,
  STOP_AFTER_LOST_MS,
  alignPose,
  alignSession,
  applyRigid,
  cameraHeading,
  circularMedian,
  compassHeading,
  createTrackingGuard,
  keepPathPoint,
  mapPoint,
  wrapDegrees,
} from './lib/tracking-guard';
export type {
  AlignSessionInput,
  CompassSample,
  PathPoint,
  PoseSample,
  RigidTransform,
  SuspectCause,
  TrackingEvent,
  TrackingGuard,
  TrackingGuardOptions,
  TrackingState,
  TrackingStateKind,
  TrackingStopReason,
} from './lib/tracking-guard';
