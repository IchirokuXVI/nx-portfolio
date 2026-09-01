/**
 * Generated shopping list enums (plan 0050, sections 1 and 9). The constant sets
 * rule: a value a column holds is an enum here, and its string values are the
 * wire format.
 */

/**
 * Where a generated list has got to (plan 0050, section 1).
 *
 * `DRAFT` is a basket that has been composed and not yet taken to a shop,
 * `ACTIVE` is the one being worked through, `COMPLETED` is a trip that is over,
 * and `ARCHIVED` hides a list from the default listing without deleting it
 * (section 7).
 *
 * `ACTIVE` is the only value carrying a rule beyond display: the overlap check in
 * section 3 refuses to put one zone line in two live baskets at once, which is
 * how a household ends up with two of everything.
 */
export enum GeneratedListStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  ARCHIVED = 'ARCHIVED',
}

/**
 * The statuses of a basket somebody is still going to shop (plan 0052, section
 * 3), which is the set the line claim in plan 0052 derives from.
 *
 * `DRAFT` is in it, and that is the whole reason this constant exists rather than
 * a comparison against `ACTIVE` written out at each call site. A run composes a
 * `DRAFT`, so a claim that counted only `ACTIVE` would announce nothing at
 * generation time and plan 0052 section 3.1 asks for the opposite: the lines a
 * run took are claimed the moment it took them, because that is the moment two
 * people in one household would otherwise both put the milk in a trolley.
 *
 * `GeneratedListSharingService.listAccepts` draws the same line for a different
 * reason (plan 0051, section 11), and the two agreeing is not a coincidence: a
 * basket that may still take people is a basket somebody is still going to shop.
 */
export const LIVE_GENERATED_LIST_STATUSES: readonly GeneratedListStatus[] = [
  GeneratedListStatus.DRAFT,
  GeneratedListStatus.ACTIVE,
] as const;

/** Whether this basket is one somebody is still going to shop. */
export function isLiveGeneratedList(status: GeneratedListStatus): boolean {
  return LIVE_GENERATED_LIST_STATUSES.includes(status);
}

/**
 * How a line got into a generated list (plan 0050, section 1).
 *
 * `DERIVED` came from zone lines and carries a provenance row per contributing
 * line. `ADDED` was typed into the basket, and **exists nowhere else** until the
 * user names a target list for it (section 5), which is the distinction the write
 * back rule turns on.
 *
 * The value survives that promotion: a line typed here and then pushed into a
 * shared list keeps `ADDED`, because what is worth recording is where it came
 * from rather than where it ended up.
 */
export enum GeneratedLineOrigin {
  DERIVED = 'DERIVED',
  ADDED = 'ADDED',
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
