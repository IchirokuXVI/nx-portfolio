import type {
  GeneratedLineOrigin,
  GeneratedListStatus,
  ParticipantKind,
} from '../enums/generated-list.enums';
import type { SettlementOutcome } from '../enums/list.enums';
import type { ItemView } from './catalog.messages';
import type {
  GeneratedListLineOriginView,
  GeneratedListSourceSnapshot,
} from './generated-list.messages';

/**
 * Sharing a generated list with people who have no account (plan 0051).
 *
 * Separate from `generated-list.messages.ts` because it is a separate feature
 * with a separate reader set: plan 0050 gave every basket exactly one reader, and
 * everything here is the widening of that.
 *
 * ## The idea the whole file turns on
 *
 * **A link is an invitation and a participant is an identity** (section 3). One
 * link shared with three people mints three participants, so an edit made in the
 * shop is attributed to a person rather than to a URL. That is why there are two
 * tables rather than one, and why revoking the link and revoking the people who
 * arrived through it are two different gestures (section 3.4).
 *
 * ## The two secrets are not the same kind of thing
 *
 * Neither is a JWT (section 3.1): both must be checked against the database on
 * every use, and a JWT you look up anyway is a JWT with no benefit and a signing
 * key's worth of risk.
 *
 * The **participant** session secret is a credential, so it is stored hashed and
 * returned exactly once. The **link** secret is an invitation the owner has to be
 * able to copy again tomorrow, from another device, for the next person, so it is
 * stored retrievably and {@link GeneratedListShareLinkView} carries it on every
 * read. The cost is named rather than hidden: a database leak hands over working
 * invitations, which mint guests until revoked or expired. It hands over no
 * participant's session, and a basket lives about as long as a shopping trip.
 *
 * ## The credential on the hot path is the participant's
 *
 * The link secret is presented **once**, at join (section 3.3). From then on the
 * client holds its own participant secret and the link secret is never
 * transmitted again, so the string that gets forwarded in a group chat and pasted
 * into a browser history has a single use job, and the long lived credential is
 * per person and individually revocable.
 */
export const GENERATED_LIST_SHARING_PATTERNS = {
  /** The share sheet: the live link and its secret, minting one if there is none. */
  linkEnsure: 'generatedList.shareLink.ensure',
  /** The live link if there is one, without minting (section 3). */
  linkGet: 'generatedList.shareLink.get',
  /** Revoke the live link, optionally cascading to its guests (section 3.4). */
  linkRevoke: 'generatedList.shareLink.revoke',
  /** What the join screen may know before anybody joins (section 4, step 1). */
  linkPreview: 'generatedList.shareLink.preview',
  /** Mint a participant from a link, or attach a registered caller (section 4). */
  join: 'generatedList.participant.join',
  /** Everybody on the basket, for the owner's share sheet and for presence. */
  participantList: 'generatedList.participant.list',
  /** Revoke exactly one participant: the lost phone (section 3.4). */
  participantRevoke: 'generatedList.participant.revoke',
  /**
   * Turn a presented credential into a participant, for the gateway's guard.
   *
   * The per request check, and section 3.3 is emphatic about its shape: **one
   * indexed lookup**, reading `revokedAt` on that row, with no cache, because
   * revocation has to bite immediately. The link's state is never consulted here,
   * which is what lets section 3.4 revoke a link without evicting the people
   * already shopping.
   */
  participantResolve: 'generatedList.participant.resolve',
  /** Exchange a live participant credential for a fresh socket token (section 9). */
  participantRefresh: 'generatedList.participant.refresh',
  /**
   * Settle a basket line back to the zone lines it came from (section 6).
   *
   * The one gesture here that reaches a zone list at all, and the replacement for
   * plan 0050 section 6's `applyStatuses`: a settlement is an append rather than
   * a contested update, so the version reconciliation that plan needed evaporated
   * with the trip status plan 0047 deleted.
   */
  settleLine: 'generatedList.settleLine',
  /**
   * Take a settled basket line back to outstanding (plan 0054, section 3).
   *
   * The reverse of {@link settleLine} and not a second kind of settle: it puts
   * back every unit this basket line took off an origin list, and marks the
   * settlements that took them rather than deleting them, because a settlement
   * is an append (plan 0047, section 3) and "somebody said they got this and
   * then took it back" is a truer history than a gap.
   *
   * Whole line rather than a number of units, because that is the gesture the
   * control makes and because a partial reopen has no honest answer to which of
   * several settlements it is undoing.
   */
  reopenLine: 'generatedList.reopenLine',
  /**
   * The basket as a **participant** sees it (section 5).
   *
   * Separate from `generatedList.get`, which resolves a basket by its owner's id
   * and therefore cannot answer a guest at all. The difference is not only the
   * credential: this projection is redacted per reader by section 5.2, so it
   * could not share a response shape with the owner's read even if it shared a
   * route.
   */
  basketGet: 'generatedList.basket.get',
  /**
   * Swap a line's pick to another of its options (section 6.1).
   *
   * On the participant surface rather than beside `generatedList.updateLine`,
   * because **anyone** holding the basket may do it, guests included: the options
   * are catalog products and never zone data, and the person at the shelf is
   * exactly who wants another brand.
   */
  setPick: 'generatedList.setPick',
} as const;

/**
 * The bounds sharing has to satisfy, stated once so the DTO, the JSON Schema and
 * the service enforce the same numbers.
 *
 * `defaultLinkTtlDays` implements section 11's leaning rather than settling it:
 * an absolute cap, because an unauthenticated read of somebody's shopping habits
 * should not outlive the trip. The other half of that leaning, that a link stops
 * accepting people once the basket is `COMPLETED` or `ARCHIVED`, is a predicate
 * in the service rather than a number here.
 */
export const GENERATED_LIST_SHARING_LIMITS = {
  /** Long enough for a weekly shop to be planned ahead, short of a standing key. */
  defaultLinkTtlDays: 30,
  displayNameMaxLength: 40,
  /** A basket is a shopping trip, not a mailing list. */
  maxParticipants: 50,
} as const;

// --- Views -----------------------------------------------------------------

/**
 * The live share link, as its owner's share sheet sees it (plan 0051, section 3).
 *
 * **A generated list has zero share links or one.** It starts with zero, pressing
 * share mints one, revoking returns it to zero, and sharing again mints a fresh
 * one. Several concurrent links with per link labels were in the first draft and
 * were dropped at review: one link at a time is easier to understand and costs
 * nothing, because the one link can be handed to any number of people.
 */
export interface GeneratedListShareLinkView {
  id: string;
  generatedListId: string;
  /**
   * The invitation itself, returned on **every** read rather than once.
   *
   * This is the deliberate asymmetry with a participant's session secret
   * (section 3.1): the owner has to be able to copy it again tomorrow, from
   * another device, for the next person, and a hashed link secret could not do
   * that.
   */
  secret: string;
  createdByParticipantId: string;
  createdAt: string;
  expiresAt: string | null;
  /** How many people arrived through this link, so the sheet can say so. */
  participantCount: number;
}

/**
 * Whether this basket is shared right now (plan 0051, section 3).
 *
 * A wrapper with an **optional** link rather than a bare nullable view, because
 * a basket having zero links or one is the ordinary state: absent means it is not
 * shared, and the shape stays a plain object that a schema and an OpenAPI
 * component can both describe without a top level union.
 */
export interface GeneratedListShareLinkResult {
  link?: GeneratedListShareLinkView;
}

/**
 * One person acting on a shared basket (plan 0051, section 3).
 *
 * `displayName` is what a guest typed and is **unverified text on an
 * unauthenticated link**, so it is what the screen shows and never what a record
 * keeps (section 3.5). Two guests can both type "Dani"; the participant id is
 * what distinguishes them. A guest who skipped the prompt has a null name and is
 * shown as "Guest N" from `guestNumber`, which is unique within the basket and
 * stable for the life of the participant. Clients must render a guest visibly as
 * a guest, never in a form that could be mistaken for a registered member.
 */
export interface GeneratedListParticipantView {
  id: string;
  kind: ParticipantKind;
  /** Null when a guest skipped the prompt; the client renders `Guest N`. */
  displayName: string | null;
  /**
   * The account holder's own name, for an `OWNER` or a `REGISTERED` participant
   * (plan 0054, section 2).
   *
   * A **separate field from {@link displayName}** rather than a value written
   * into it, because they are different facts: one is unverified text typed on
   * an unauthenticated link, the other is an account's own name. Merging them
   * would make a guest's typed "Dani" indistinguishable on the wire from an
   * account called Dani, which is the distinction section 3.5 rests on.
   *
   * Null for a `GUEST`, who has no account, and null on a row that predates the
   * plan until the next share backfills it. A client shows `displayName` first
   * when the person typed one, because they said it on purpose.
   *
   * Served to every reader of the basket, guests included, and that is a
   * deliberate disclosure: the people on one basket are shopping together and
   * already see each other's faces, join times and typed names. What stays
   * private is everything on the other side of the all or nothing rule, and a
   * username is not zone data.
   *
   * A **snapshot taken at join time**, as a zone membership's is: somebody who
   * changes their account name keeps the old one on baskets they have already
   * joined, because the alternative is a join at read time.
   */
  username: string | null;
  /** Monotonic per basket, so the fallback label is stable. Guests only. */
  guestNumber: number | null;
  /** Set for `OWNER` and `REGISTERED`, null for a `GUEST`. */
  userId: string | null;
  joinedAt: string;
  lastSeenAt: string;
  /** Null for the owner, who arrived by owning the basket rather than by a link. */
  shareLinkId: string | null;
  /**
   * The device string, present **only** for a reader who passes section 5.2.
   *
   * Section 7 is explicit that this is not presence data: it is shown on tap, to
   * participants who hold `WRITE` on every source, and guests do not get to
   * inspect each other. Absent rather than null when the reader may not see it,
   * so the two cases stay distinguishable.
   */
  userAgent?: string | null;
}

/**
 * What the join screen may know **before** anybody joins (plan 0051, section 4,
 * step 1).
 *
 * The first step must leak nothing: no lines, no zone names, no list names, no
 * member names. Somebody who finds a link in a chat log learns that a shopping
 * list exists and nothing else.
 *
 * ## Why a dead link is not a 404
 *
 * Sections 3.1 and 4 pull in opposite directions at first reading. 3.1 wants a
 * link that never existed and one that was revoked to get **the same answer**, so
 * nothing in the URL is enumerable. 4 wants a revoked or expired link to answer
 * **honestly**, so the join screen can say "this link is no longer accepting
 * people" instead of showing a spinner.
 *
 * Both hold at once if the preview never fails: a link that never existed, one
 * that was revoked, one that expired and one whose basket has been completed all
 * answer `joinable: false` **and nothing else**. The screen gets its honest
 * sentence, and the four cases are indistinguishable from each other, which is
 * the stronger of the two guarantees and the one an attacker would be probing.
 * `name` and `participantCount` are therefore present only when `joinable`.
 */
export interface GeneratedListLinkPreview {
  joinable: boolean;
  /** The basket's name, or null when it is unnamed. Only when joinable. */
  name?: string | null;
  /** How many people are already on it. Only when joinable. */
  participantCount?: number;
}

/**
 * What **core** answers a join with (plan 0051, section 4).
 *
 * It stops short of the socket token because core cannot mint one: the signing
 * key lives in auth, and core references users by an opaque id and holds no
 * credentials of any kind. The gateway asks auth for the token and returns
 * {@link GeneratedListJoinResult}, which is this plus that.
 */
export interface GeneratedListJoinCoreResult {
  generatedListId: string;
  participant: GeneratedListParticipantView;
  /**
   * The guest's own credential, returned **once** and stored hashed.
   *
   * Null for a `REGISTERED` participant and for the owner, who have an account
   * token already: a participant who can prove who they are by other means does
   * not get a password, which is why `sessionSecretHash` is nullable on the row.
   */
  sessionSecret: string | null;
}

/**
 * The result of joining, and the only time a guest's session secret exists
 * outside the database (plan 0051, sections 3.1 and 4).
 */
export interface GeneratedListJoinResult {
  generatedListId: string;
  participant: GeneratedListParticipantView;
  /**
   * The guest's own credential, returned **once** and stored hashed.
   *
   * Null for a `REGISTERED` participant, who has an account token already and
   * needs no second credential. That is why `sessionSecretHash` is nullable on
   * the row: a participant who can prove who they are by other means does not get
   * a password.
   */
  sessionSecret: string | null;
  /**
   * The short lived, list scoped socket token (section 9), for every kind of
   * participant including the owner, because presence entries are keyed by
   * participant and an account token names no participant.
   */
  socketToken: string;
  /** When {@link socketToken} lapses, so the client can refresh ahead of it. */
  socketTokenExpiresAt: string;
}

/**
 * A resolved participant, as the gateway attaches it to a request (plan 0051,
 * sections 3.3 and 5.2).
 *
 * The analogue of `CurrentUser` for the participant authenticated surface.
 */
export interface GeneratedListParticipantContext {
  participantId: string;
  generatedListId: string;
  kind: ParticipantKind;
  /** Set for `OWNER` and `REGISTERED`, null for a `GUEST`. */
  userId: string | null;
  /**
   * Whether this participant may see zone data, evaluated **at request time**
   * (section 5.2).
   *
   * True when they hold `WRITE` on every list the run drew from. The owner passes
   * by construction (section 2), a `GUEST` never passes, having no account to
   * hold access with, and a `REGISTERED` participant passes only if they
   * independently have `WRITE` everywhere the run drew from.
   *
   * **Never from the snapshot.** A basket outlives the access it was built with,
   * and a recipient's standing today is the only one that can be honestly
   * checked.
   */
  seesZoneData: boolean;
}

/**
 * The claims of the list scoped socket token (plan 0051, section 9).
 *
 * ## The rule this amends
 *
 * Plan 0035 established that **a token that names nobody is an invalid token**.
 * That was correct, and it was written when the only thing a token could name was
 * a user. This is the one legitimate token that names no user, so 0035's rule
 * becomes "names neither a user nor a live participant". The amendment is part of
 * plan 0051 rather than a surprise to be discovered at the guard.
 *
 * ## Why it exists at all
 *
 * Every socket today authenticates with an account JWT. A participant secret is
 * not one and names no user, so without this a guest could not open a connection
 * at all, and there would be no presence and no live basket.
 *
 * `sub` is **deliberately absent** rather than null: a participant is not a user
 * and must never be mistaken for one by a guard that reads `sub` and asks no
 * further questions. `aud` names the one basket, so the token is worthless
 * anywhere else, and it is refreshed by presenting the participant credential,
 * which is the database check that carries revocation.
 */
export interface ParticipantTokenClaims {
  participantId: string;
  /** The one generated list this token is good for, and nothing else. */
  aud: string;
  kind: ParticipantKind;
  iat?: number;
  exp?: number;
}

// --- Requests --------------------------------------------------------------

/** Every sharing request core answers is scoped to one basket. */
export interface GeneratedListShareRequest {
  /** The caller the gateway's verified token resolved to. */
  userId: string;
  generatedListId: string;
}

/**
 * Mint the live link, or hand back the one that is already live (section 3).
 *
 * Idempotent by the partial unique index over `generatedListId` where
 * `revokedAt` is null, so a double tap on share cannot produce two live links
 * and does not need to be defended against in the service.
 */
export interface EnsureShareLinkRequest extends GeneratedListShareRequest {
  /**
   * When the invitation should lapse. Defaults to
   * {@link GENERATED_LIST_SHARING_LIMITS.defaultLinkTtlDays} from now; an
   * explicit null asks for no expiry, which the service still caps.
   */
  expiresAt?: string | null;
  /**
   * The owner's own account name, so the row this call creates for them carries
   * it (plan 0054, section 2.3).
   *
   * Sharing is where the owner's participant row is minted, lazily, so it is
   * where the name has to arrive: core owns no usernames and the gateway holds
   * the token that resolves one. An owner row that predates the plan is
   * backfilled here on the next share, which is the same lazy repair plan 0051
   * chose for the row's existence in the first place.
   */
  username?: string | null;
}

/**
 * Revoke the live link (plan 0051, section 3.4).
 *
 * Two levels, and both are things somebody actually wants. Without
 * `revokeParticipants` no new participant may be minted, and **every existing
 * participant keeps working**, including opening the basket from that same URL,
 * because their session is what authorizes them and the link is only an
 * invitation they already accepted. That is the common case: stop it spreading,
 * do not throw out the people in the shop.
 *
 * With it, `revokedAt` is written onto every participant the link minted, which
 * is the explicit second choice the plan phrases as "revoke all guests from this
 * link?".
 */
export interface RevokeShareLinkRequest extends GeneratedListShareRequest {
  revokeParticipants?: boolean;
}

/** The preview is unauthenticated and carries the link secret alone. */
export interface PreviewShareLinkRequest {
  secret: string;
}

/**
 * Join a basket by its link (plan 0051, section 4).
 *
 * `userId` is set when the caller presented a valid account token, which is step
 * 3 rather than step 2: they are attached as a `REGISTERED` participant with no
 * name prompt, and the unique index over (`generatedListId`, `userId`) makes a
 * second link they open resolve to the same row.
 */
export interface JoinGeneratedListRequest {
  secret: string;
  /** What a guest typed. Absent means they skipped it and get `Guest N`. */
  displayName?: string;
  /** Set only when the caller presented a valid account token. */
  userId?: string;
  /**
   * The account holder's own name, resolved by the gateway from the verified
   * token (plan 0054, section 2.3).
   *
   * **Core is told the name and never asks for it**, which is plan 0018
   * section 9's rule for `CreateZoneRequest.username` applied unchanged: core
   * owns no usernames and may not reach into auth for one. Null or absent for a
   * guest, who has no account behind them.
   */
  username?: string | null;
  /** Captured at join, shown on tap to readers who pass section 5.2 alone. */
  userAgent?: string;
}

/**
 * Turn a presented credential into a participant (plan 0051, section 3.3).
 *
 * Exactly one of `sessionSecret` and `userId` is meaningful: a guest presents the
 * secret they were given at join, and a registered participant presents an
 * account token the gateway has already verified.
 */
export interface ResolveParticipantRequest {
  generatedListId: string;
  /** A guest's session secret, hashed before it is looked up. */
  sessionSecret?: string;
  /** The account a verified token resolved to. */
  userId?: string;
}

/** Exchange a live credential for a fresh socket token (section 9). */
export type RefreshParticipantTokenRequest = ResolveParticipantRequest;

/** A fresh socket token and when it lapses. */
export interface ParticipantTokenResult {
  socketToken: string;
  socketTokenExpiresAt: string;
  participant: GeneratedListParticipantView;
}

/**
 * Revoke one participant and nobody else (plan 0051, section 3.4): the lost
 * phone, and the guest who should not have been given it.
 */
export interface RevokeParticipantRequest extends GeneratedListShareRequest {
  participantId: string;
}

/** Everybody on a basket, for the share sheet and for presence. */
export interface ListParticipantsRequest {
  generatedListId: string;
  /**
   * The participant asking, so section 5.2 can decide whether `userAgent` is
   * included. Absent when the owner asks through an account authenticated route,
   * which passes by construction.
   */
  asParticipantId?: string;
  /** The owner asking through an account authenticated route. */
  userId?: string;
  /**
   * That owner's account name, for the same reason
   * {@link EnsureShareLinkRequest.username} carries it (plan 0054,
   * section 2.3): this read mints the owner's row when it is missing, so it is
   * the second place a name can reach a row nobody else can name.
   */
  username?: string | null;
}

/** The people on a basket, newest last, revoked ones omitted. */
export interface GeneratedListParticipantListResult {
  participants: GeneratedListParticipantView[];
}

// --- Settling from the basket ----------------------------------------------

/**
 * Settle a basket line (plan 0051, section 6): the half of the plan that does
 * real work, and the half plan 0047 was shaped to receive.
 *
 * ## Three gestures, one message
 *
 * Settle the whole outstanding amount, submit a number you type, or allocate per
 * source list by hand. They are one request because they are the same act with
 * progressively more of it supplied: no `quantity` means the whole outstanding
 * amount, a `quantity` means that many allocated by section 6.2, and
 * `allocations` means the caller supplied the allocation too.
 *
 * **A guest must never have to know which household a tin of tomatoes belongs
 * to.** They are in a shop with a list. So the first two ask for a number at
 * most, and the allocation is the system's problem.
 */
export interface SettleGeneratedListLineRequest {
  generatedListId: string;
  /** The basket line, not the zone line. */
  lineId: string;
  /** The actor, resolved from their credential by the gateway's guard. */
  participantId: string;
  outcome: SettlementOutcome;
  /**
   * Units settled. Absent means the whole outstanding amount.
   *
   * Ignored for `NOT_AVAILABLE`, which is an **outcome rather than a quantity**:
   * it closes the outstanding amount, writes settlements that decrement nothing,
   * and sets the indicator plan 0047 section 5 derives.
   */
  quantity?: number;
  /**
   * The allocation sheet (section 6.3), which is the accurate version of the same
   * act: the same operation with the allocation supplied instead of derived.
   *
   * It is the only way to say "two for us, one for my parents" correctly when the
   * default guessed otherwise. **Refused for a caller who does not pass
   * section 5.2**, because naming source lists is naming zone data.
   */
  allocations?: GeneratedListAllocationEntry[];
  /**
   * The product actually in the trolley, when it is not the line's current pick.
   *
   * Swapping the pick is a gesture any participant may make, guests included,
   * because options are catalog products and never zone data (section 6.1). The
   * settlement records what was bought rather than what was planned (plan 0047,
   * section 3.2).
   */
  itemId?: string;
}

/** One line of the allocation sheet (plan 0051, section 6.3). */
export interface GeneratedListAllocationEntry {
  listId: string;
  quantity: number;
}

/**
 * A settlement this act wrote, as the basket reports it (plan 0051, section 6.2).
 *
 * Every origin touched gets its own row, each carrying the basket line's id, so
 * the allocation is **auditable afterwards** rather than being a rule that ran
 * once and left no trace.
 */
export interface GeneratedListSettlementRef {
  settlementId: string;
  /** The zone line this landed on. */
  lineId: string;
  listId: string;
  quantity: number;
}

/**
 * An origin this act could not touch (plan 0051, section 6.4).
 *
 * Reported rather than failing the call, which is the one piece of plan 0050
 * section 6 that survives intact: a partial settle is a real outcome, and a
 * shopper who has already bought the thing should not be told the whole act
 * failed because one household's access moved last week.
 */
export interface GeneratedListSettleSkip {
  lineId: string;
  listId: string;
  /**
   * `ACCESS_GONE` when the basket's **owner** may no longer write that list, and
   * `ORIGIN_DELETED` when the zone line is not there any more.
   */
  reason: 'ACCESS_GONE' | 'ORIGIN_DELETED';
  /**
   * The list's own name, so a reader is told *which* origin was missed rather
   * than how many (plan 0053, section 4).
   *
   * Composed the way {@link GeneratedListSourceName} is, and carrying the same
   * redaction: the whole `skipped` array is absent for a reader who does not pass
   * section 5.2, so a guest keeps {@link GeneratedListSettleResult.skippedCount}
   * and gains nothing from this.
   *
   * Null when the list itself could not be read back, which is the ordinary case
   * for `ORIGIN_DELETED` reaching a list that has since gone: the settle still
   * happened and the count is still honest, and a name nobody can supply is
   * better absent than invented.
   */
  listName: string | null;
  /** The zone the list belongs to, e.g. "Flat 3B". Null under the same rule. */
  zoneName: string | null;
}

/**
 * What one basket settle did, projected for the participant who did it.
 *
 * ## Why the line is redacted and the two lists are optional
 *
 * This is answered on the **participant** surface, which a guest reaches. Every
 * field of `GeneratedListSettlementRef`, of `GeneratedListSettleSkip` and of
 * `GeneratedListLineView.origins` names a zone or a list, so returning them
 * whole would hand a guest exactly what section 5.2 spends its length refusing.
 * They are therefore present only for an actor who passes that rule, on the same
 * redact-by-absence principle as {@link GeneratedListBasketLineView}.
 *
 * ## Why the count survives the redaction
 *
 * Section 6.4 insists a partial settle is a real outcome and must be reported
 * rather than swallowed: a shopper who bought three and reached two households
 * needs to know. {@link skippedCount} is that report with the names taken out, so
 * a guest is told honestly that one origin could not be reached without being
 * told whose it was. A client that shows neither will silently under report what
 * the shopper actually bought, which is the failure `0051` section 6.4 names.
 */
export interface GeneratedListSettleResult {
  line: GeneratedListBasketLineView;
  /**
   * How many origins this act could not reach. Always present, for every reader,
   * because the fact is the actor's business and only the names are not.
   */
  skippedCount: number;
  /** Where the units landed. Absent for a reader who does not pass section 5.2. */
  settlements?: GeneratedListSettlementRef[];
  /** Which origins were missed, and why. Absent under the same rule. */
  skipped?: GeneratedListSettleSkip[];
}

// --- Reopening a settled line ----------------------------------------------

/**
 * Take a settled basket line back to outstanding (plan 0054, section 3).
 *
 * The whole line, so there is no quantity to send: a partial reopen has no
 * honest answer to which of several settlements it is undoing, and the control
 * on the row is a switch rather than a dial.
 *
 * ## Who may
 *
 * **The same authorization the settle has, and no more**: any live participant,
 * guests included (section 3.5). A reopen is not a wider act than a settle, it
 * touches exactly the origins this basket line's own settlements touched, and
 * refusing it to the person who just made the mistake would leave the mistake
 * standing.
 */
export interface ReopenGeneratedListLineRequest {
  generatedListId: string;
  /** The basket line, not the zone line. */
  lineId: string;
  /** The actor, resolved from their credential by the gateway's guard. */
  participantId: string;
}

/**
 * What one reopen did, projected for the participant who did it (plan 0054,
 * section 3.5).
 *
 * **It names nothing**, which is why it is a smaller shape than
 * {@link GeneratedListSettleResult} rather than the same one: the line and a
 * count of origins it could not reach, with no settlement refs and no list
 * names. That is what lets the act itself sit outside the all or nothing rule,
 * which gates naming zone data rather than touching it.
 *
 * {@link skippedCount} is the same report {@link GeneratedListSettleResult}
 * makes with the names taken out (plan 0051, section 6.4): an origin whose zone
 * line has since been deleted has nothing to put back, and the caller has to
 * know something did not land.
 */
export interface GeneratedListReopenResult {
  line: GeneratedListBasketLineView;
  /**
   * How many origins this act could not put units back on. Always present, for
   * every reader, because the fact is the actor's business.
   */
  skippedCount: number;
}

/**
 * What the basket's own room hears when a line moves (plan 0051, section 10):
 * a settle, or a pick swapped at the shelf.
 *
 * **Redacted to the least privileged reader in the room, always.** A basket room
 * holds the owner and every guest at once, and a broadcast cannot be projected
 * per socket, so it carries only what a guest may see. Nothing is lost by that:
 * the three redacted fields (`origins`, `targetListId`, `origin`) do not change
 * when a line is settled or its pick is swapped, so a client that passes
 * section 5.2 merges the mutable fields onto the line it already holds and keeps
 * its own captions.
 *
 * The settlements and the skipped origins are deliberately **not** here at all,
 * for any reader. They are the acting participant's own feedback and belong in
 * their HTTP response, not in a broadcast to everybody in the shop.
 */
export interface GeneratedListLineMovedEvent {
  generatedListId: string;
  line: GeneratedListBasketLineView;
}

// --- The basket, as a participant reads it ---------------------------------

/**
 * One line of a basket, projected for the participant reading it (plan 0051,
 * section 5).
 *
 * ## Why this is not `GeneratedListLineView`
 *
 * Section 5.2 redacts **by absence**, not by a flag the client is trusted to
 * honour. `origins`, `targetListId` and `origin` all name zone data, so for a
 * reader who does not pass the rule they are not present in the payload at all,
 * and a guest's basket therefore cannot leak a list name through a field
 * somebody forgot to hide in a template.
 *
 * The alternative, making those three optional on the shared line view, would
 * have made every existing owner-side reader defensive about fields that are
 * always there for it. A different reader set gets a different projection, which
 * is what section 5.2 describes.
 */
export interface GeneratedListBasketLineView {
  id: string;
  content: string;
  /** How many the basket is asking for, summed across the origins. */
  quantity: number;
  /** How many have been settled so far. Outstanding is the difference. */
  settledQuantity: number;
  /** The pick: the exact product this line means. Null for a free text line. */
  itemId: string | null;
  /** The products the pick may be switched between. Catalog data, never zone data. */
  options: string[];
  position: number;
  /**
   * Who last edited or settled this line, so the row can say who got the bread
   * (plan 0044, section 4.3).
   *
   * A participant id and never a name: two guests can both type "Dani", so the
   * client resolves it against the participant list and renders a guest visibly
   * as a guest. Null when nobody has touched it since it was generated.
   */
  lastEditedByParticipantId: string | null;
  /** When {@link lastEditedByParticipantId} last touched it. Null with it. */
  lastEditedAt: string | null;
  /**
   * What the most recent settle on this line said, or null if there has been
   * none (velista `0044`, section 4.2).
   *
   * **Without it a `NOT_AVAILABLE` line is indistinguishable from a bought one.**
   * That outcome closes the outstanding amount without buying anything, so
   * `settledQuantity` reaches `quantity` exactly as a purchase would, and a row
   * reading the numbers alone would caption "Marc got it" over a shop that did
   * not have it. The analogue of `LineSettlementSummary.lastOutcome`, which plan
   * 0047 section 5 put on a zone line for the same reason.
   */
  lastOutcome: SettlementOutcome | null;
  /**
   * Where this line came from. **Absent** for a reader who does not pass
   * section 5.2, rather than empty: a tin of tomatoes never names its household.
   */
  origins?: GeneratedListLineOriginView[];
  /** Zone data, so absent under the same rule as {@link origins}. */
  targetListId?: string | null;
  /** Zone data, so absent under the same rule as {@link origins}. */
  origin?: GeneratedLineOrigin;
}

/**
 * A shared basket and everybody on it, as one participant reads it (plan 0051,
 * section 5; velista `0044`, section 4).
 *
 * One request rather than three, because the basket screen cannot draw a single
 * row without all of it: a line's attribution is a participant id, so the people
 * are not a second screen's data but this screen's vocabulary.
 *
 * `seesZoneData` is stated rather than inferred so the client can decide what to
 * **draw** without guessing from which fields happened to arrive. It is the same
 * value the redaction was performed with, evaluated at request time, and it is
 * never the authority for anything: the server has already removed what this
 * reader may not have, and refuses the allocation sheet on its own.
 */
export interface GeneratedListBasketView {
  id: string;
  /** Null is not missing: the client renders the generation date (plan 0050). */
  name: string | null;
  status: GeneratedListStatus;
  generatedAt: string;
  lines: GeneratedListBasketLineView[];
  /** Everybody live on this basket, for attribution and for presence. */
  participants: GeneratedListParticipantView[];
  /** The reader's own row, so the screen can tell "you" from everybody else. */
  me: GeneratedListParticipantView;
  /** Whether this reader passes section 5.2, evaluated on this request. */
  seesZoneData: boolean;
  /** What the run drew from. Zone data, so absent unless {@link seesZoneData}. */
  sourceSnapshot?: GeneratedListSourceSnapshot;
  /**
   * The names behind those ids, so a row can say "from Weekly shop" rather than
   * "from 0f3a…" (velista `0044`, section 4.1).
   *
   * Composed here rather than fetched by the client, because the client that
   * would fetch them is the one this plan is about: a registered participant who
   * passes the rule is not necessarily a member of anything the basket drew from
   * in a way that has loaded a zone store, and an owner would otherwise need
   * every source list on screen to caption one row.
   *
   * **Absent under exactly the same rule as {@link sourceSnapshot}**, and that is
   * the whole of its access control: a household's list name is the plainest
   * zone data there is, and it is the one field on this view whose leaking would
   * be legible to the person it leaked to.
   */
  sourceNames?: GeneratedListSourceName[];
}

/** One source list, named, for the "from" caption on a row. */
export interface GeneratedListSourceName {
  listId: string;
  /** The list's own name, e.g. "Weekly shop". */
  name: string;
  /** The zone it belongs to, e.g. "Flat 3B". Null when it could not be read. */
  zoneName: string | null;
}

/**
 * The basket as the **gateway** answers it: core's view, plus the products it
 * names (velista `0044`, section 4.4).
 *
 * Composed rather than stored, in the same way {@link GeneratedListJoinResult}
 * is: core holds the basket and references products by an opaque `itemId`,
 * catalog holds the products, and neither can answer this alone.
 *
 * ## Why the names travel with the basket rather than being fetched after it
 *
 * Every catalog route needs an account token, and the reader here may be a guest
 * who has none. Section 6.1 says a line's options are catalog products and never
 * zone data, so a guest is entitled to the names; carrying them here is how they
 * get them without a second public catalog surface, and it makes the whole screen
 * one request rather than one plus a fan out over every option.
 *
 * A product an id no longer names is simply absent, because a basket outlives the
 * catalog it was composed from. The client draws such a line with no product
 * caption rather than treating the page as broken.
 */
export interface GeneratedListBasketResult extends GeneratedListBasketView {
  /** Every product named by a line's pick or its options, deduplicated. */
  products: ItemView[];
}

/**
 * Read a basket as the participant the gateway's guard resolved.
 *
 * No `userId`: the participant id is the whole credential's worth of identity,
 * and an owner reading their own basket arrives here as their own participant
 * row like everybody else.
 */
export interface GetGeneratedListBasketRequest {
  generatedListId: string;
  participantId: string;
}

/**
 * Swap a line's pick (plan 0051, section 6.1).
 *
 * `itemId` must be one of the line's own options, which the service checks: the
 * options are the line's set rather than the whole catalog, so this cannot be
 * used to point a line at an arbitrary product.
 */
export interface SetGeneratedListPickRequest {
  generatedListId: string;
  lineId: string;
  participantId: string;
  itemId: string;
}

// --- Presence --------------------------------------------------------------

/**
 * One participant connected to a shared basket right now (plan 0051, section 7).
 *
 * **Deliberately not `PresenceUser`**, which is `{ userId }` and can describe none
 * of this: a guest has no user id at all, and a screen that says "Guest 2 got the
 * bread" needs the number and the kind as well as the id.
 *
 * `userAgent` and `joinedAt` are absent here even for a reader who could see them
 * on the participant list. Section 7 is explicit that the device string is not
 * presence data: it is shown on tap, from the participant list, to readers who
 * pass section 5.2. Putting it in a broadcast would hand it to every guest in the
 * shop, which is the thing that section forbids.
 */
export interface ParticipantPresenceEntry {
  participantId: string;
  kind: ParticipantKind;
  /** Null when a guest skipped the prompt; the client renders `Guest N`. */
  displayName: string | null;
  guestNumber: number | null;
  /** Present for `OWNER` and `REGISTERED`, null for a `GUEST`. */
  userId: string | null;
}

/**
 * Payload of {@link RealtimeEvent.PresenceGeneratedListUpdated}: who is in the
 * shop right now (plan 0051, section 7).
 *
 * **One entry per socket, not per person**, which is where this departs from
 * `ZonePresence`'s "one entry per user however many sockets they hold". One
 * person on a phone and a laptop is two participants and appears twice. That is
 * truthful, since it is two sessions, and the alternative would be deduplicating
 * by typed name, which is exactly the mistake section 3.5 warns about: two guests
 * can both type "Dani" and are not the same person.
 */
export interface GeneratedListPresence {
  generatedListId: string;
  present: ParticipantPresenceEntry[];
}
