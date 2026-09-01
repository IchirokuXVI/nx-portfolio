import type { Location } from '@angular/common';

/**
 * Whether there is an entry behind the current one that this document put there.
 *
 * The router stamps every history entry with the id of the navigation that wrote it,
 * counting from one, so an id above one means this document navigated at least once
 * before arriving here and `back` returns to that. Everything else reads as no: a null
 * state after a cold load, and any entry this app did not write.
 *
 * Both callers are wrong in the same safe direction. A sheet that guesses no replaces
 * an entry it could have popped; a page's back button that guesses no walks to its
 * parent rather than popping. Guessing yes when the answer is no is the expensive
 * mistake, because it sends somebody out of the app.
 */
export function hasEntryBehind(location: Location): boolean {
  const state = location.getState() as { navigationId?: unknown } | null;

  return typeof state?.navigationId === 'number' && state.navigationId > 1;
}
