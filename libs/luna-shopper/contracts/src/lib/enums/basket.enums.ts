/**
 * The basket, after it stopped storing its rows (plan 0136).
 *
 * A basket holds a header, a rule saying which lists it covers and the people on
 * it. Its rows are read from `list_lines` on every request, so every value here
 * describes something **derived** at read time rather than a column somebody
 * wrote. That is the rule the three unions below are shaped by: none of them may
 * ever become a stored state, because the thing they describe is recomputed.
 */

/**
 * What this basket is (plan 0133, section 2).
 *
 * The two kinds are not two flavours of one row: they answer differently to
 * every "is somebody still shopping this" question in core. A `GENERATED`
 * basket is a trip, so it claims lines, the sweep finishes it, and it appears in
 * the history. A `LIVE` one is a door onto the lists its owner can write, so it
 * never ends and none of those questions is about it.
 *
 * It lived in `generated-list.enums.ts` until plan 0136, which is the file the
 * deleted basket line was described in. The kind is a fact about the basket
 * itself, so it moved here with the rest of the basket's vocabulary.
 */
export enum BasketKind {
  /** One per person, covering every list they can write. Never finished (plan 0136). */
  LIVE = 'LIVE',
  /** Made on purpose, with a name, sources and people. Finished by its owner. */
  GENERATED = 'GENERATED',
}

/**
 * Where one row of a basket has got to (plan 0130, section 4).
 *
 * Computed on every read from the row's entries and the purchases in scope, and
 * **never stored**: a column holding this would be the copy plan 0136 exists to
 * remove.
 *
 * All six values are declared now although this plan produces four of them. The
 * other two arrive with the plans named beside them, and declaring the union
 * whole means those plans change which value a row carries rather than changing
 * the wire shape, so a client written against this today keeps parsing.
 */
export enum BasketRowState {
  /** Something is still left to buy, and nothing has been said about it. */
  WANTED = 'WANTED',
  /** Some units were bought and some are still left. */
  PARTLY = 'PARTLY',
  /** Nothing is left: every unit was bought. */
  DONE = 'DONE',
  /** The newest act on this row said the shop did not have it, and units remain. */
  NOT_AVAILABLE = 'NOT_AVAILABLE',
  /** Put off for this trip. Never produced before plan 0137. */
  SKIPPED = 'SKIPPED',
  /** Taken off the basket. Never produced before plan 0138. */
  REMOVED = 'REMOVED',
}

/**
 * A fact about a row's past worth saying beside it (plan 0130, section 4).
 *
 * One value today, and a union rather than a boolean for the same reason
 * {@link BasketRowState} is declared whole: the shape does not move when the
 * second value arrives.
 */
export enum BasketRowNote {
  /** This row was skipped earlier on this trip. Never produced before plan 0137. */
  SKIPPED_EARLIER = 'SKIPPED_EARLIER',
}

/**
 * What changed about this row since the reader last looked (plan 0138).
 *
 * `mark` is null on every row until that plan lands. It is declared here so the
 * change log changes values rather than the wire shape.
 */
export enum BasketRowMark {
  ADDED = 'ADDED',
  CHANGED = 'CHANGED',
  REMOVED = 'REMOVED',
}
