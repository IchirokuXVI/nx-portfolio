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
