/**
 * What two fingers on the map mean (velista plan 0129, target 2). Pure, so
 * the rule is tested without a DOM.
 *
 * Two fingers always move the map: it follows the point between them. They
 * zoom it only once the distance between them has changed by more than a
 * dead zone from where the gesture started. Two fingers that drag together
 * never keep exactly the same distance, so without the dead zone the map
 * zooms in and out while it moves.
 */

/** The dead zone as a share of the distance the gesture started with. */
export const PINCH_DEAD_ZONE_RATIO = 0.12;
/** The dead zone's floor, in css pixels, for two fingers that start close. */
export const PINCH_DEAD_ZONE_PX = 24;

export interface Pinch {
  /** The distance between the fingers when the second one landed. */
  readonly start: number;
  /**
   * The distance at the moment the dead zone was left, which the scale is
   * measured from so the map does not jump. Null while the gesture is a move.
   */
  readonly zoomFrom: number | null;
}

/** A two finger gesture as it starts: a move. */
export function pinchStart(distance: number): Pinch {
  return { start: Math.max(distance, 1), zoomFrom: null };
}

/** How far the distance may change before the gesture becomes a zoom. */
export function pinchDeadZone(start: number): number {
  return Math.max(start * PINCH_DEAD_ZONE_RATIO, PINCH_DEAD_ZONE_PX);
}

/**
 * The gesture after the fingers moved to `distance` apart, and the factor
 * the scale takes against the scale the gesture started with. The factor is
 * 1 while the gesture is a move, and 1 in the frame it becomes a zoom. A zoom
 * stays a zoom until both fingers lift.
 */
export function pinchStep(
  pinch: Pinch,
  distance: number
): { pinch: Pinch; factor: number } {
  const d = Math.max(distance, 1);
  if (pinch.zoomFrom !== null) {
    return { pinch, factor: d / pinch.zoomFrom };
  }
  if (Math.abs(d - pinch.start) <= pinchDeadZone(pinch.start)) {
    return { pinch, factor: 1 };
  }
  return { pinch: { start: pinch.start, zoomFrom: d }, factor: 1 };
}
