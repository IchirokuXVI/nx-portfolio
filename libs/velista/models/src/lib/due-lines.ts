import { QUANTITY_REEL_IDLE_MS } from './limits';

/**
 * The lines a zone list suggests (velista `0089`, backend `0123`).
 *
 * A due line is never a new line and never a row of its own in the data. It is a line
 * at zero that the household is about to want again, drawn early under To buy with the
 * reason and a button that puts it back on the list.
 *
 * **Named "due lines" in code** and "suggested" only in copy, because the composer's
 * typeahead is called suggestions already (`CatalogSuggestion`, `lib-suggestion-list`),
 * and those are catalog products.
 */

/**
 * Why a line is due, upper case on the wire.
 *
 * `PERIOD`: the median time between its purchases has almost passed. `STAPLE`: the
 * list's recent baskets nearly always ask for it.
 */
export const DUE_LINE_REASONS = ['PERIOD', 'STAPLE'] as const;
export type DueLineReason = (typeof DUE_LINE_REASONS)[number];

/** One line the list offers to bring back. */
export interface DueLine {
  readonly lineId: string;
  readonly reason: DueLineReason;
  /** Every how many days the line is bought. `PERIOD` only, at least 1. */
  readonly periodDays: number | null;
  /** Whole days since the last purchase, for both reasons. */
  readonly daysSinceBought: number;
  /** In how many of the recent baskets the line was. `STAPLE` only. */
  readonly tripsWith: number | null;
  /** How many recent baskets were looked at. `STAPLE` only. */
  readonly tripsSeen: number | null;
  /** How many to add, at least 1: what the last basket asked, else the last purchase. */
  readonly quantity: number;
}

/**
 * How many due lines the section draws before "Show more suggestions" (velista `0089`,
 * section 2). The server answers every due line (backend `0125`), so the rest are
 * already held and showing them asks for nothing.
 */
export const DUE_LINES_SHOWN = 3;

/**
 * Whether changing a due row's quantity adds the line by itself (velista `0089`,
 * section 2).
 *
 * **Off in this version.** With it off, the stepper only chooses the amount and the Add
 * button puts the line on the list. With it on, a change that goes quiet for
 * {@link DUE_LINE_STEP_QUIET_MS} adds the line at the chosen amount, and the button stays
 * for somebody who wants the suggested amount as it is. The product owner expects to turn
 * it on in the next version once the section has proved itself.
 */
export const DUE_LINE_ADDS_ON_STEP = false;

/**
 * How long a due row waits after the last step before it adds by itself, when
 * {@link DUE_LINE_ADDS_ON_STEP} is on.
 *
 * The row leaves the section the moment its line is above zero, so adding on the first
 * press would take the stepper away from somebody who meant to press three times. The
 * reel's own idle window, so both controls commit after the same pause.
 */
export const DUE_LINE_STEP_QUIET_MS = QUANTITY_REEL_IDLE_MS;

/** One due row as `lib-due-line-row` draws it. */
export interface DueLineRowVm {
  readonly lineId: string;
  /** The line's name, from `LineStore`. */
  readonly name: string;
  /** The reason sentence, as a key and its arguments. */
  readonly reasonKey: string;
  readonly reasonArgs: Readonly<Record<string, string | number>>;
  /** The amount the stepper starts at. */
  readonly quantity: number;
}
