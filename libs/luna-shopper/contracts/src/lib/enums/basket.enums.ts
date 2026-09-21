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
 * It lived in `basket.enums.ts` until plan 0136, which is the file the
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

// --- The status, the people and the refusals (plans 0050, 0051, 0114) --------
/**
 * Generated shopping list enums (plan 0050, sections 1 and 9). The constant sets
 * rule: a value a column holds is an enum here, and its string values are the
 * wire format.
 */

/**
 * Where a basket has got to (plan 0133, section 3).
 *
 * Three values, where there were four and two of them were one state with two
 * spellings. A run wrote `DRAFT`, nothing in core ever wrote `ACTIVE`, and every
 * reader folded the pair back together through a constant. Plan 0092 section 3.2
 * had already found the overlap check testing `ACTIVE` and therefore never
 * firing, which is what a state nobody writes buys.
 *
 * The word "live" moved to {@link BasketKind}, so a status claiming it as well
 * would now say two different things at once.
 */
export enum BasketStatus {
  /** Somebody is still going to shop it, or is shopping it now. */
  OPEN = 'OPEN',
  /** The trip is over. Refuses every write, and its owner can open it again. */
  FINISHED = 'FINISHED',
  /** Finished and hidden from the default listing. */
  ARCHIVED = 'ARCHIVED',
}

/**
 * Whether this basket still takes writes.
 *
 * A function over one value rather than a set, because a set of one value is not
 * a set. It stays a function so that a call site reads as it did before, and so
 * that a fourth status, if one is ever added, has one place to be decided in.
 *
 * **It says nothing about the kind.** A `LIVE` basket is always open and is
 * never a trip, so a question about claims, sweeps or history asks
 * `OPEN_GENERATED_BASKET` instead (plan 0133, section 6).
 */
export function isOpenBasket(status: BasketStatus): boolean {
  return status === BasketStatus.OPEN;
}

/**
 * What kind of person is acting on a shared basket (plan 0051, section 3).
 *
 * The split that makes the whole feature safe: **a link is an invitation and a
 * participant is an identity**, so one link handed to three people mints three
 * participants, and an edit made in the shop is attributed to a person rather
 * than to a URL.
 *
 * `OWNER` is whoever generated the basket. They get a participant row at
 * generation time even though they arrived by owning it rather than by a link,
 * which costs one insert and buys a single foreign key for every attribution
 * field in the plan (`lastEditedByParticipantId`, `createdByParticipantId`,
 * `settledByParticipantId`, presence) instead of a nullable pair of a user id and
 * a participant id, checked for exactly one being set, in five places
 * (section 3.2).
 *
 * `REGISTERED` opened the link holding an account token. They are attached as
 * themselves with no name prompt, and the unique index over (`basketId`,
 * `userId`) makes a second link they open resolve to the same row (section 4).
 *
 * `GUEST` has no account and gets none through this route: opening a link must
 * never create one (section 11). A guest holds a session secret, is shown by the
 * name they typed or as "Guest N" when they skipped it, and **never** passes the
 * zone visibility rule in section 5.2, having no account to hold access with.
 */
export enum ParticipantKind {
  OWNER = 'OWNER',
  REGISTERED = 'REGISTERED',
  GUEST = 'GUEST',
}

/**
 * Why a participant row stopped being live (plan 0114, section 3).
 *
 * Set together with `revokedAt` and never without it. The reason decides what
 * the share link does for that person afterwards: somebody who left may come
 * back through it, and somebody the owner removed, or whose link was revoked
 * with its people, may not (section 7).
 *
 * Never on the wire. A client learns that a person is gone from the event, and
 * nothing it draws depends on why.
 */
export enum ParticipantEndedReason {
  /** The owner removed this one person. Every row revoked before plan 0114. */
  REMOVED = 'REMOVED',
  /** The owner revoked the link this person came by, and its people with it. */
  LINK_REVOKED = 'LINK_REVOKED',
  /** The person left on their own. */
  LEFT = 'LEFT',
  /**
   * Their twelve hours ran out and the sweep wrote it down (plan 0140,
   * section 7).
   *
   * Beside {@link LEFT} as a reason the link can undo: nobody refused them, so
   * a fresh link brings the same row back with a new expiry. The row is ended
   * by a clock rather than by a person, which is why the owner is not the one
   * who has to take it back.
   */
  EXPIRED = 'EXPIRED',
}

/**
 * Why a list holding the same thing cannot be put into a basket line (plan 0057,
 * section 3.2, as plan 0092 section 3.2 revised it).
 *
 * A candidate carrying one of these is **served rather than filtered out**, which
 * is the one place this codebase deliberately answers with something the caller
 * cannot act on. "The parents' house also wants milk and somebody else is already
 * buying it" is a fact worth knowing while standing in a dairy aisle, and it is a
 * fact about lists this reader has already been found entitled to. Velista draws
 * it as a caption with no control beside it, so the **control** is absent and the
 * information is present, which is what keeps plan 0030's rule intact.
 *
 * ## Only one of these is produced
 *
 * Plan 0092 made a pending line and a line at zero **adoptable**, because a
 * pending origin is still claimed and still settled, and a list at zero is a list
 * that can be asked again. {@link NOT_APPROVED} and {@link SETTLED} are kept so a
 * client still drawing their captions keeps reading this enum, and velista 0068
 * is where they stop being drawn. Nothing on the server answers with either.
 *
 * `CLAIMED` is **gone rather than kept**, because plan 0133 section 7 deleted the
 * rule behind it. A line another basket of the owner's carries is now adoptable,
 * so nothing can answer the reason and no client can be handed it again.
 */
export enum OriginUnavailableReason {
  /**
   * The household said no to it (plan 0091, section 3.1).
   *
   * A rejected line is a decision, and a basket must not raise a line the list
   * will never buy. It is the one refusal about the line's own state that
   * survives plan 0092.
   */
  REJECTED = 'REJECTED',
  /** No longer answered: a pending line is adoptable (plan 0092, section 3.2). */
  NOT_APPROVED = 'NOT_APPROVED',
  /** No longer answered: a line at zero is adoptable (plan 0092, section 3.2). */
  SETTLED = 'SETTLED',
}
