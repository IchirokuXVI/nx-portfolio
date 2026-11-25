/**
 * Where a change of product lands when "Lists and amounts" opened the change
 * sheet (velista `0200`, amended on 2026-11-25): back on the shopping list, past
 * the change sheet, the detailed view and the row's sheet, never on the detailed
 * view again.
 *
 * The detailed view writes the history depth (`AppHistory.depth`) of the basket
 * page into the navigation's state, and the change sheet walks back to it with
 * `PageNavigation.backTo` after a change, which pops only onto entries this
 * document pushed and otherwise replaces its own entry with the basket.
 *
 * Router state and not the URL, because the URL names what the sheet is about.
 * The state rides on the history entry, so it is still there when the change
 * sheet comes back from the catalog that chooses by a pop. A sheet opened from
 * anywhere else carries none and closes onto the row's sheet, as it always did.
 */
const LANDING_KEY = 'velistaChangeLanding';

/** The navigation state that asks the change sheet to land at `depth`. */
export function changeLandingState(depth: number): Record<string, unknown> {
  return { [LANDING_KEY]: depth };
}

/** The depth a navigation's state asks the change sheet to land at, or null. */
export function changeLandingOf(state: unknown): number | null {
  if (typeof state !== 'object' || state === null) {
    return null;
  }
  const depth = (state as Record<string, unknown>)[LANDING_KEY];
  return typeof depth === 'number' && Number.isInteger(depth) ? depth : null;
}
