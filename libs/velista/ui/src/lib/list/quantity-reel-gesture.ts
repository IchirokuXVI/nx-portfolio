import {
  QUANTITY_REEL_TAP_MAX_MS,
  QUANTITY_REEL_TAP_SLOP_PX,
} from '@portfolio/velista/models';

/**
 * What a press on the reel turned out to be (velista `0079`, section 8).
 *
 * - `pending`: nothing is decided yet. Once the press has ended, it means it never
 *   became anything, which is how a long still press ends, and the reel drops it.
 * - `tap`: it ended where it began, inside the time a tap takes.
 * - `drag`: it went sideways past the slop, which is what the reel is for.
 * - `scroll`: it went up or down past the slop, which belongs to the page.
 */
export type ReelGesture = 'pending' | 'tap' | 'drag' | 'scroll';

export interface ReelGestureInput {
  /** Horizontal travel since the press, in pixels. The sign does not matter. */
  readonly dx: number;
  /** Vertical travel since the press, in pixels. The sign does not matter. */
  readonly dy: number;
  /** How long the pointer has been down. */
  readonly elapsedMs: number;
  /** Whether the pointer has lifted. Only an ended press can be a tap. */
  readonly ended: boolean;
}

/**
 * Tell a tap, a sideways drag and a vertical scroll apart.
 *
 * Pure, so the rule is tested without a pointer. The reel asks on every move until the
 * answer is something other than `pending` and then keeps that answer for the rest of
 * the press, which is what makes the first direction past the slop the one that counts.
 *
 * Sideways wins only while it is also the larger of the two, so a thumb that sets off
 * diagonally down a list is scrolling rather than dragging. Time never decides a drag
 * or a scroll: a hold that then moves is still a move.
 */
export function classifyReelGesture(input: ReelGestureInput): ReelGesture {
  const across = Math.abs(input.dx);
  const down = Math.abs(input.dy);

  if (across > QUANTITY_REEL_TAP_SLOP_PX && across > down) {
    return 'drag';
  }
  if (down > QUANTITY_REEL_TAP_SLOP_PX) {
    return 'scroll';
  }
  if (input.ended && input.elapsedMs <= QUANTITY_REEL_TAP_MAX_MS) {
    return 'tap';
  }
  return 'pending';
}
