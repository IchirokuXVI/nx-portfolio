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
export enum GeneratedListStatus {
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
export function isOpenBasket(status: GeneratedListStatus): boolean {
  return status === GeneratedListStatus.OPEN;
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
 * themselves with no name prompt, and the unique index over (`generatedListId`,
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
