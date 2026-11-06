/**
 * What one probe of a chain found (plan 0219, section 5).
 *
 * `RUNNING` while the probe reads. The first step that is not ok decides the
 * rest: a refusal is `BLOCKED`, a source that did not answer is `UNREACHABLE`,
 * a moved URL or a parser that read too little is `SHAPE_CHANGED`, and any
 * other exception is `ERROR`, a broken browser in our own image among them.
 * `ABORTED` is a probe that a shutdown or the reaper stopped, which says
 * nothing about the chain.
 */
export enum SourceProbeStatus {
  RUNNING = 'RUNNING',
  PASSED = 'PASSED',
  SHAPE_CHANGED = 'SHAPE_CHANGED',
  BLOCKED = 'BLOCKED',
  UNREACHABLE = 'UNREACHABLE',
  ERROR = 'ERROR',
  ABORTED = 'ABORTED',
}
