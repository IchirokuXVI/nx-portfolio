/**
 * The app's own enums, and the fallback each one uses for a value it does not know.
 *
 * Rule D4 (plan 0004, section 4.1): the frontend owns its models, so it owns its
 * enums too. These are unions of string literals rather than re-exports of the
 * backend's TypeScript `enum`s, for two reasons:
 *
 * - **A newer backend can send a value this build has never heard of.** A phone can
 *   be running a bundle cached days before the deploy that added a status. Mapping
 *   into a closed union with a defined fallback turns that from a crash or an
 *   unstyled string into a state the UI already handles.
 * - **A union of literals is a type, not a value.** Nothing here needs a runtime
 *   import from `@portfolio/luna-shopper/contracts`, so every contracts import in the
 *   app is `import type` and is erased at compile time, which is what keeps the ajv
 *   the contracts barrel re-exports out of the bundle (plan 0004, section 9.3).
 *
 * The values match the backend's enum member values exactly, which is what makes the
 * mappers a validation step rather than a translation step. Keeping them identical is
 * deliberate and allowed: rule D4 asks that the model be **ours**, not that it differ.
 *
 * Every fallback below is chosen to be the **least dangerous** reading of an unknown
 * value, never the most convenient one. Two of them have no fallback at all and each
 * says why where it is declared: one never maps **in** from the wire, and one is a set,
 * where an unknown member has a better answer than any default could be.
 */

/** A caller's role in a zone. Unknown falls back to the least privileged role. */
export const ZONE_ROLES = ['OWNER', 'ADMIN', 'MEMBER'] as const;
export type ZoneRole = (typeof ZONE_ROLES)[number];
export const ZONE_ROLE_FALLBACK: ZoneRole = 'MEMBER';

/**
 * A zone's lifecycle state.
 *
 * `UNKNOWN` is a member here rather than a fallback onto `ACTIVE`, because `0003`
 * open question 2 already defines a treatment for a zone that is not normal: render
 * it as a plain, non-tappable card. An unrecognised status gets that same treatment,
 * which is safe, whereas guessing `ACTIVE` would offer a tap into a zone the backend
 * may have already torn down.
 */
export const ZONE_STATUSES = [
  'ACTIVE',
  'MARKED_FOR_DELETION',
  'UNKNOWN',
] as const;
export type ZoneStatus = (typeof ZONE_STATUSES)[number];
export const ZONE_STATUS_FALLBACK: ZoneStatus = 'UNKNOWN';

/**
 * A membership's state.
 *
 * Unknown falls back to `PENDING`, which renders as "waiting to be let in": no list
 * content, not tappable through. Falling back to `APPROVED` would show a member data
 * the backend may not have granted them.
 */
export const MEMBERSHIP_STATUSES = [
  'PENDING',
  'APPROVED',
  'KICKED',
  'BANNED',
] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];
export const MEMBERSHIP_STATUS_FALLBACK: MembershipStatus = 'PENDING';

/**
 * What a caller may do on one list, as a **set** rather than a single value.
 *
 * `READ` is implied by every other member and is also stored, so a set that has any
 * permission in it has `READ` in it too (backend plan 0036, section 2.2). `WRITE` and
 * `DECIDE` are deliberately independent: the flatmate who puts olive oil on the list on
 * Tuesday and the flatmate who decides in the aisle on Saturday that it goes in the
 * trolley are two different people, and neither is a subset of the other.
 *
 * **There is no fallback, and that is the whole difference from the enums above.** A
 * role is one value, so something had to be picked for a value this build has never
 * heard of, and `LIST_ROLE_FALLBACK` picked the least dangerous one. A set has a
 * strictly correct answer instead: ignore the member it did not understand and keep the
 * ones it did (velista plan 0030, section 2). Dropping is also the safe direction, twice
 * over. A client that does not know a permission does not draw the control for it, and
 * the server would refuse whatever that control had sent.
 *
 * The empty set follows from the same rule and means read only, which is why an absent
 * or unreadable `myPermissions` maps to it rather than to anything optimistic.
 */
export const LIST_PERMISSIONS = ['READ', 'WRITE', 'DECIDE', 'MANAGE'] as const;
export type ListPermission = (typeof LIST_PERMISSIONS)[number];

/**
 * What one settling act said happened (backend plan 0047, section 3).
 *
 * It replaced `LineStatus`, and the replacement is not a rename. `READY` was a
 * fact about **one shopping trip** written onto a record that outlives every
 * trip, which is why a shared list filled up with ticked lines nobody could get
 * rid of except by deleting what they knew about the thing. This is a fact about
 * a moment, recorded once and never edited, and the line's own state is its
 * quantity (velista plan 0043, section 1).
 *
 * There is no fallback, and there is deliberately no `SKIPPED` member. "I decided
 * not to buy this today" writes nothing at all, because it has to leave the line
 * exactly as it was and must not look like it was dealt with, so it is the
 * absence of a settlement rather than a third kind of one.
 */
export const SETTLEMENT_OUTCOMES = ['BOUGHT', 'NOT_AVAILABLE'] as const;
export type SettlementOutcome = (typeof SETTLEMENT_OUTCOMES)[number];

/**
 * What an unrecognised outcome reads as, and it is the quiet one.
 *
 * `NOT_AVAILABLE` moves no quantity and counts as no purchase, so a value this
 * build has never heard of reports a trip that happened and claims nothing about
 * what the household now has. Reading it as `BOUGHT` would put a bought indicator
 * on a line over an outcome nobody here understands.
 */
export const SETTLEMENT_OUTCOME_FALLBACK: SettlementOutcome = 'NOT_AVAILABLE';

/**
 * Whether a catalog suggestion offers a group of products or one of them
 * (backend plan 0048, section 3).
 *
 * A group beats an item and the ranking is the **server's**, not a rule restated
 * here: somebody typing "milk" is offered the group rather than one brand of it,
 * and `item.searchOffers` already orders them that way (velista plan 0043,
 * section 6). Unknown falls back to `item`, which attaches one product instead of
 * several, and is the smaller thing to have to undo.
 */
export const CATALOG_SUGGESTION_KINDS = ['group', 'item'] as const;
export type CatalogSuggestionKind = (typeof CATALOG_SUGGESTION_KINDS)[number];
export const CATALOG_SUGGESTION_KIND_FALLBACK: CatalogSuggestionKind = 'item';

/**
 * How far a voice comment's transcript got (backend plan 0045, section 4.2).
 *
 * Four states rather than an empty body, because "nobody has transcribed this yet" and
 * "nothing could be transcribed from it" look identical on screen for about three
 * seconds and completely different after a minute, and there is nothing to poll that
 * would tell them apart.
 *
 * `FAILED` is the fallback for a state this build has never heard of, and it is the
 * safe direction: the row draws the neutral phrase and the player, and the recording
 * is the message either way. Reading an unknown state as `PENDING` would leave
 * somebody watching a spinner that resolves on no event.
 */
export const COMMENT_TRANSCRIPTIONS = [
  'PENDING',
  'READY',
  'FAILED',
  'UNAVAILABLE',
] as const;
export type CommentTranscription = (typeof COMMENT_TRANSCRIPTIONS)[number];
export const COMMENT_TRANSCRIPTION_FALLBACK: CommentTranscription = 'FAILED';

/** Whether a suggested line has been accepted. Unknown reads as still awaiting. */
export const LINE_APPROVAL_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
] as const;
export type LineApprovalStatus = (typeof LINE_APPROVAL_STATUSES)[number];
export const LINE_APPROVAL_STATUS_FALLBACK: LineApprovalStatus = 'PENDING';

/**
 * Whether the signed-in user has credentials of their own.
 *
 * Unknown falls back to `TEMPORARY`, so the guest banner in `0003` appears. Being
 * told to secure an account that is already secure is a small annoyance; not being
 * told, and then losing the phone, loses everything the user had.
 */
export const USER_KINDS = ['TEMPORARY', 'REGISTERED'] as const;
export type UserKind = (typeof USER_KINDS)[number];
export const USER_KIND_FALLBACK: UserKind = 'TEMPORARY';

/**
 * How far a rename travels, as **this app's** two valued question (plan 0015, rule A3).
 *
 * The wire enum `UsernamePropagation` has three values and this one has two, which is
 * the point rather than an omission. `ALL_ZONES` overwrites a name somebody
 * deliberately chose inside a group, and offering it honestly needs a screen listing
 * what it would overwrite; no endpoint returns that list, so the app cannot ask the
 * question fairly and therefore does not ask it at all.
 *
 * Named for what the person is deciding rather than for what the server does with it,
 * because the sheet is asking about other people's screens: the name you picked in one
 * group is not the name you use everywhere, so should this change follow it?
 *
 * The mapping to the wire lives in `AccountApi`, which is the boundary rule D4 puts it
 * at. There is no fallback because nothing maps **into** this type: it only ever goes
 * out, chosen by a radio group that has exactly these two options.
 */
export const USERNAME_SCOPES = ['MY_GROUPS_TOO', 'ONLY_HERE'] as const;
export type UsernameScope = (typeof USERNAME_SCOPES)[number];

/**
 * What the rename sheet arrives on, and it is **not** the wire default.
 *
 * `MATCHING_ZONES` can only ever change a name that already equalled the old global
 * one, so it cannot clobber a deliberate choice, while `GLOBAL_ONLY` leaves a person
 * renamed in one place and not in another, which reads as the rename half working. The
 * gateway defaults to `GLOBAL_ONLY` when the field is absent, so the safer answer only
 * happens if it is asked for, which is why the client always sends it explicitly.
 */
export const USERNAME_SCOPE_DEFAULT: UsernameScope = 'MY_GROUPS_TOO';

/**
 * What kind of person is acting on a shared basket (plan 0051, section 3).
 *
 * `UNKNOWN` is a member rather than a fallback onto one of the three, and it is
 * the safe direction for the same reason `ZONE_STATUSES` has one: every rule this
 * enum drives is about **widening** what somebody may see, and a kind this build
 * has never heard of must not be read as the owner. It renders like a guest,
 * which is the least the screen can offer anybody.
 *
 * Falling back to `GUEST` outright was the alternative and is worse: it would
 * claim a person is unverified when the server may have said the opposite, and
 * `0044` section 4.3 requires a guest to be *visibly* a guest. Saying that of
 * somebody who is not is the mistake in the direction that matters.
 */
export const PARTICIPANT_KINDS = [
  'OWNER',
  'REGISTERED',
  'GUEST',
  'UNKNOWN',
] as const;
export type ParticipantKind = (typeof PARTICIPANT_KINDS)[number];
export const PARTICIPANT_KIND_FALLBACK: ParticipantKind = 'UNKNOWN';

/**
 * Where a generated shopping list has got to (backend plan 0050, section 1).
 *
 * `DRAFT` is composed and not yet taken to a shop, `ACTIVE` is the one being worked
 * through, `COMPLETED` is a trip that is over, and `ARCHIVED` hides a trip from the
 * default listing without deleting it.
 *
 * `ACTIVE` is the only value this app derives anything from: it is what puts a basket
 * on the dashboard card and marks a row in the history as being shopped now. The other
 * three are carried so the history can be read back, and nothing branches on them.
 *
 * `UNKNOWN` is the fallback for a status this build does not recognise, following
 * `ZONE_STATUSES`: an unrecognised value must not read as `ACTIVE`, because that would
 * put a basket the server considers finished back on the dashboard.
 */
export const GENERATED_LIST_STATUSES = [
  'DRAFT',
  'ACTIVE',
  'COMPLETED',
  'ARCHIVED',
  'UNKNOWN',
] as const;
export type GeneratedListStatus = (typeof GENERATED_LIST_STATUSES)[number];
export const GENERATED_LIST_STATUS_FALLBACK: GeneratedListStatus = 'UNKNOWN';

/**
 * Where a basket line came from (backend `0055`, section 3; velista `0056`).
 *
 * `DERIVED` is a line the run composed out of the zone lists it drew from, and
 * `ADDED` is one a participant typed into the basket in an aisle. The difference
 * is not decoration: an `ADDED` line claims no household's line and can be sent to
 * one, and a `DERIVED` line already has its lists and cannot be sent anywhere.
 *
 * The mapper reads an absent or unrecognised value as `DERIVED`, which is the quiet
 * direction: a line the run composed offers no send control, so an unknown value
 * costs a gesture rather than offering one the server would refuse. It is stated at
 * the mapper rather than as a constant here because it is also what an **older
 * backend** means by omitting the field, and those are the same answer.
 */
export const BASKET_LINE_KINDS = ['DERIVED', 'ADDED'] as const;
export type BasketLineKind = (typeof BASKET_LINE_KINDS)[number];

/**
 * Why a list holding the same thing cannot be taken onto a basket line (backend
 * `0057`, section 4.3).
 *
 * `CLAIMED` is a line another basket is already carrying, `NOT_APPROVED` is one
 * still waiting for its list to accept it, and `SETTLED` is one that has already
 * been bought. Three reasons rather than one flag, because the sheet says which:
 * "somebody else is shopping this" and "this was already bought" send a person to
 * two different places.
 *
 * There is no fallback and there is no member for "it is fine", which is what the
 * wire omitting the field means. Null is the adoptable case, and it is a real value
 * here rather than a missing one.
 */
export const BASKET_ORIGIN_UNAVAILABLE_REASONS = [
  'CLAIMED',
  'NOT_APPROVED',
  'SETTLED',
] as const;
export type BasketOriginUnavailableReason =
  (typeof BASKET_ORIGIN_UNAVAILABLE_REASONS)[number];

/**
 * How much a shopping profile draws from when it generates a basket (backend `0049`,
 * section 1).
 *
 * `ALL` is not "every list I can see today": it means every list the caller may write
 * to, **including ones made later**, which is a different and better promise than
 * naming today's ids. `SELECTED` is the explicit set beside it.
 */
export const GENERATION_SCOPES = ['ALL', 'SELECTED'] as const;
export type GenerationScope = (typeof GENERATION_SCOPES)[number];

/**
 * What an unrecognised scope reads as, and it is the wide one.
 *
 * The scope only ever **prefills** a sheet somebody is about to look at, so being
 * wrong costs a tick they untick. `ALL` is what a fresh profile stores and what
 * somebody who has never narrowed anything means, and reading an unknown value as
 * `SELECTED` would prefill from a `sources` list this build could not interpret
 * either, which is a sheet that draws nothing ticked and a submit that refuses.
 */
export const GENERATION_SCOPE_FALLBACK: GenerationScope = 'ALL';
