import type { ParticipantKind } from '../enums/basket.enums';

/**
 * Sharing a basket with people who have no account (plan 0051).
 *
 * Separate from `basket.messages.ts` because it is a separate feature
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
 * stored retrievably and {@link BasketShareLinkView} carries it on every
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
export const BASKET_SHARING_PATTERNS = {
  /** The share sheet: the live link and its secret, minting one if there is none. */
  linkEnsure: 'basket.shareLink.ensure',
  /** The live link if there is one, without minting (section 3). */
  linkGet: 'basket.shareLink.get',
  /** Revoke the live link, optionally cascading to its guests (section 3.4). */
  linkRevoke: 'basket.shareLink.revoke',
  /** What the join screen may know before anybody joins (section 4, step 1). */
  linkPreview: 'basket.shareLink.preview',
  /** Mint a participant from a link, or attach a registered caller (section 4). */
  join: 'basket.participant.join',
  /** Everybody on the basket, for the owner's share sheet and for presence. */
  participantList: 'basket.participant.list',
  /** Revoke exactly one participant: the lost phone (section 3.4). */
  participantRevoke: 'basket.participant.revoke',
  /** Add one of the owner's contacts to the basket (plan 0114, section 4). */
  participantAdd: 'basket.participant.add',
  /** A registered participant leaves the basket (plan 0114, section 6). */
  participantLeave: 'basket.participant.leave',
  /**
   * Turn a presented credential into a participant, for the gateway's guard.
   *
   * The per request check, and section 3.3 is emphatic about its shape: **one
   * indexed lookup**, reading `revokedAt` on that row, with no cache, because
   * revocation has to bite immediately. The link's state is never consulted here,
   * which is what lets section 3.4 revoke a link without evicting the people
   * already shopping.
   */
  participantResolve: 'basket.participant.resolve',
  /** Exchange a live participant credential for a fresh socket token (section 9). */
  participantRefresh: 'basket.participant.refresh',
} as const;

/**
 * The bounds sharing has to satisfy, stated once so the DTO, the JSON Schema and
 * the service enforce the same numbers.
 *
 * **How long a link lives is not here and is not a limit** (plan 0140,
 * section 2). `defaultLinkTtlDays: 30` was a cap a caller could ask under, and
 * both halves of that are gone: the product owner decided the number, so it is
 * configuration read by the service (`BASKET_LINK_TTL`), and no request may name
 * another. The other half of plan 0051 section 11's leaning, that a link stops
 * accepting people once the basket is finished, is still a predicate in the
 * service rather than a number here.
 */
export const BASKET_SHARING_LIMITS = {
  displayNameMaxLength: 40,
  /** A basket is a shopping trip, not a mailing list. */
  maxParticipants: 50,
} as const;

// --- Views -----------------------------------------------------------------

/**
 * The live share link, as its owner's share sheet sees it (plan 0051, section 3).
 *
 * **A basket has zero share links or one.** It starts with zero, pressing
 * share mints one, revoking returns it to zero, and sharing again mints a fresh
 * one. Several concurrent links with per link labels were in the first draft and
 * were dropped at review: one link at a time is easier to understand and costs
 * nothing, because the one link can be handed to any number of people.
 */
export interface BasketShareLinkView {
  id: string;
  basketId: string;
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
  /**
   * When the invitation stops accepting people: twelve hours after
   * {@link createdAt}, always (plan 0140, section 4).
   *
   * Not nullable any more. A link with no end was a link to a household's whole
   * shopping for ever, and the share sheet draws a countdown from this.
   */
  expiresAt: string;
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
export interface BasketShareLinkResult {
  link?: BasketShareLinkView;
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
export interface BasketParticipantView {
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
   * already see each other's faces and typed names. What stays
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
  /**
   * When they joined and when they were last seen, present **only** for a reader
   * who passes section 5.2, beside {@link userAgent} (plan 0114, section 11).
   *
   * Absent rather than null for everybody else, guests included: when somebody
   * arrived is part of inspecting them, as the device string is. Both were served
   * to every reader until plan 0114, against the mapper's own comment.
   */
  joinedAt?: string;
  lastSeenAt?: string;
  /**
   * The link this person came by. Null for the owner, who arrived by owning the
   * basket, and for a person the owner added from their groups (plan 0114,
   * section 3), who arrived with no link and so is not reached by revoking one.
   */
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
  /**
   * When this person's access ends, and null when it does not (plan 0140,
   * section 8).
   *
   * Null for the owner and for a person the owner added by name. Set, to twelve
   * hours after their own join, for everybody a link let in, guest or signed in
   * alike.
   *
   * **Served to every reader**, which is deliberate: the people sheet offers
   * "keep" for everybody who carries one, and the shopper themselves needs the
   * warning. It is a moment to display and never a decision: whether it has
   * passed is the server's answer, read by asking again.
   */
  expiresAt: string | null;
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
export interface BasketLinkPreview {
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
 * {@link BasketJoinResult}, which is this plus that.
 */
export interface BasketJoinCoreResult {
  basketId: string;
  participant: BasketParticipantView;
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
export interface BasketJoinResult {
  basketId: string;
  participant: BasketParticipantView;
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
export interface BasketParticipantContext {
  participantId: string;
  basketId: string;
  kind: ParticipantKind;
  /** Set for `OWNER` and `REGISTERED`, null for a `GUEST`. */
  userId: string | null;
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
  /** The one basket this token is good for, and nothing else. */
  aud: string;
  kind: ParticipantKind;
  iat?: number;
  exp?: number;
}

// --- Requests --------------------------------------------------------------

/** Every sharing request core answers is scoped to one basket. */
export interface BasketShareRequest {
  /** The caller the gateway's verified token resolved to. */
  userId: string;
  basketId: string;
}

/**
 * Mint the live link, or hand back the one that is already live (section 3).
 *
 * Idempotent by the partial unique index over `basketId` where
 * `revokedAt` is null, so a double tap on share cannot produce two live links
 * and does not need to be defended against in the service.
 *
 * **It names no lifetime** (plan 0140, section 2). Every link lasts twelve
 * hours from the moment it was minted, the number is configuration, and a field
 * nobody sets is a field somebody sets to a year. A basket whose link expired
 * gets a fresh one from this same call.
 */
export interface EnsureShareLinkRequest extends BasketShareRequest {
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
export interface RevokeShareLinkRequest extends BasketShareRequest {
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
 * name prompt, and the unique index over (`basketId`, `userId`) makes a
 * second link they open resolve to the same row.
 */
export interface JoinBasketRequest {
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
  basketId: string;
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
  participant: BasketParticipantView;
}

/**
 * Revoke one participant and nobody else (plan 0051, section 3.4): the lost
 * phone, and the guest who should not have been given it.
 */
export interface RevokeParticipantRequest extends BasketShareRequest {
  participantId: string;
}

/**
 * Add one of the owner's contacts to the basket (plan 0114, section 4).
 *
 * Owner only, like every request on {@link BasketShareRequest}, and the
 * person must share an approved group with the owner at this moment. What
 * happens to a row they already have is section 4's table.
 */
export interface AddBasketParticipantRequest extends BasketShareRequest {
  /** The person to add. Never the owner. */
  memberUserId: string;
  /**
   * That person's global username, resolved by the gateway from auth (section
   * 9). Core owns no usernames, so it is told this one, and uses it only when the
   * two people share no approved group or more than one.
   */
  globalUsername?: string | null;
}

/**
 * Leave a basket (plan 0114, section 6), as the participant the gateway's guard
 * resolved. A registered participant only: a guest is refused, and so is the
 * owner, whose standing comes from owning the basket.
 */
export interface LeaveBasketRequest {
  basketId: string;
  participantId: string;
}

/**
 * What a person's own sessions hear when a basket is shared with them, or stops
 * being (plan 0114, section 10): the basket's id and nothing else.
 */
export interface BasketAccessEvent {
  basketId: string;
}

/** Everybody on a basket, for the share sheet and for presence. */
export interface ListParticipantsRequest {
  basketId: string;
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
export interface BasketParticipantListResult {
  participants: BasketParticipantView[];
}

// --- Settling from the basket ----------------------------------------------

// --- Reopening a settled line ----------------------------------------------

// --- Renaming a basket line ------------------------------------------------

/** One list where the new name is taken (plan 0113, section 4). */
export interface BasketLineMergeRequiredListDetails {
  listId: string;
  listName: string;
  zoneName: string;
  /** The line of that list that already carries the name. */
  otherContent: string;
  otherQuantity: number;
}

/** The basket line that already carries the name (plan 0113, section 4). */
export interface BasketLineMergeRequiredBasketDetails {
  otherLineId: string;
  otherContent: string;
  otherQuantity: number;
}

/**
 * The `details` a `line_merge_required` refusal of a basket rename carries
 * (plan 0113, section 4).
 *
 * Every name here belongs to a list the caller can write, because the rename is
 * refused before this point to anybody who cannot write every one of them.
 */
export interface BasketLineMergeRequiredDetails {
  lists: BasketLineMergeRequiredListDetails[];
  basket: BasketLineMergeRequiredBasketDetails | null;
}

// --- The basket, as a participant reads it ---------------------------------

// --- What a basket line is made of (plan 0057) -----------------------------

// --- A participant adds a line, and searches for one (plan 0055) -----------

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
 * Payload of {@link RealtimeEvent.PresenceBasketUpdated}: who is in the
 * shop right now (plan 0051, section 7).
 *
 * **One entry per socket, not per person**, which is where this departs from
 * `ZonePresence`'s "one entry per user however many sockets they hold". One
 * person on a phone and a laptop is two participants and appears twice. That is
 * truthful, since it is two sessions, and the alternative would be deduplicating
 * by typed name, which is exactly the mistake section 3.5 warns about: two guests
 * can both type "Dani" and are not the same person.
 */
export interface BasketPresence {
  basketId: string;
  present: ParticipantPresenceEntry[];
}
