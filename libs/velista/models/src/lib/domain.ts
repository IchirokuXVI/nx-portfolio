import type {
  LineApprovalStatus,
  LineStatus,
  ListPermission,
  MembershipStatus,
  UserKind,
  ZoneRole,
  ZoneStatus,
} from './enums';

/**
 * The app's own domain models (rule D4, plan 0004 section 4.1).
 *
 * These are close to the gateway's view types, and that is fine: the rule asks that
 * the model be **ours**, not that it be different. What it buys is that a backend
 * rename breaks one mapper instead of every consumer, and that a value which arrives
 * missing or malformed is normalised here rather than three components deep.
 *
 * Two deliberate departures from the wire shape, both noted where they occur:
 * summary counts that the gateway does not serve yet, and a `Page<T>` that names its
 * cursor for what it is.
 */

/** A page of results. Mirrors the gateway's `Paginated<T>`, named for the client. */
export interface Page<T> {
  readonly items: readonly T[];
  /** The cursor for the next page, or `null` when there is no more data. */
  readonly nextCursor: string | null;
}

/** A group, as the user reads it. The code says zone throughout (rule N2, plan 0001). */
export interface Zone {
  readonly id: string;
  readonly name: string;
  readonly joinCode: string;
  readonly status: ZoneStatus;
  readonly ownerUserId: string | null;
}

/**
 * A zone the caller belongs to, with their standing in it and the numbers the home
 * page renders.
 *
 * `counts` and `lists` are **always present** (backend plan 0017, landed 2026-08-26).
 * They were optional here while the gateway could not serve them, which is what let
 * `0003` be built against the in-memory implementation; now that they are guaranteed,
 * making them required is what stops every consumer carrying a branch for data that
 * always arrives.
 */
export interface MyZone extends Zone {
  readonly myRole: ZoneRole;
  readonly myStatus: MembershipStatus;
  readonly counts: ZoneCounts;
  /**
   * At most `ZONE_LIST_PREVIEW_LIMIT` lists, newest activity first, filtered exactly
   * as `listCount` is.
   *
   * **Empty means the caller can read no list in this zone, never that the zone has
   * none.** The distinction matters on a card: "no lists yet" would be a lie told to
   * somebody who simply has not been given access to any.
   */
  readonly lists: readonly ListPreview[];
}

/**
 * How many lists a zone's preview carries.
 *
 * The server decides this: it is `ZONE_LIST_PREVIEW_LIMIT` in the core service's
 * `zones/zone-summary.sql.ts`, and this is a second declaration of the same number in
 * a separate deployable. They can drift, and a drift is survivable in both directions:
 * a client limit **lower** than the server's shows fewer rows than arrived, and a
 * **higher** one is never reached because the server never sends more. What the client
 * uses it for is deciding whether a newly created list has room in a preview it is
 * holding (plan 0019, section 5.2); it never uses it to trim what the server sent.
 */
export const ZONE_LIST_PREVIEW_LIMIT = 3;

/** The summary numbers on a zone card (backend plan 0017, section 3). */
export interface ZoneCounts {
  /** APPROVED memberships only. Somebody still pending is not a member yet. */
  readonly memberCount: number;
  /** Lists **the caller may read**, not the zone's total. */
  readonly listCount: number;
  /**
   * People waiting to be let in, or `null` for a caller who may not see that.
   *
   * The null is load bearing: who is waiting is governance data, and the backend
   * only fills it for an OWNER or ADMIN. So a non-null value **is** the permission,
   * and nothing in the UI needs to re-derive it from a role.
   */
  readonly pendingRequestCount: number | null;
  /**
   * The **oldest** pending requester's name, which is what `0003` section 4.1
   * renders. Null when there are none, or when the caller may not see governance
   * data. Oldest by creation with the id as a tie break, so it is stable across
   * refreshes rather than changing on every reload.
   */
  readonly firstPendingRequesterName: string | null;
}

/** Enough of a list to draw a row inside a zone card. */
export interface ListPreview {
  readonly id: string;
  readonly name: string;
  readonly lineCount: number;
  readonly readyCount: number;
}

/** Someone's membership of a zone. */
export interface Membership {
  readonly id: string;
  readonly zoneId: string;
  readonly userId: string;
  /**
   * The only human readable name the API exposes anywhere, and it is per zone.
   * There is no profile endpoint (plan 0004, section 11 item 2).
   */
  readonly username: string;
  readonly role: ZoneRole;
  readonly status: MembershipStatus;
}

/**
 * A shopping list.
 *
 * Named `ShoppingList` rather than `List` because `List` collides with too much in a
 * TypeScript file to be worth the four saved characters.
 */
export interface ShoppingList {
  readonly id: string;
  readonly zoneId: string;
  readonly name: string;
  readonly createdByUserId: string;
  /**
   * Whether a new line on this list arrives already approved (backend plan 0037).
   *
   * List **configuration**, not a fact about the caller, which is why it sits here
   * beside the name rather than with `myPermissions`: everybody looking at this list
   * gets the same answer, and it therefore rides on the realtime `list.updated` payload
   * like the name does.
   *
   * The client reads it for exactly one thing, and it is not a rule it enforces: an
   * optimistic row has to be drawn with the approval the server is about to give it, or
   * the person who typed the line watches an approve button appear on it and vanish
   * (velista plan 0030, section 5). The server decides; this is what lets the frame
   * before the response tell the truth.
   */
  readonly autoApproveLines: boolean;
}

/**
 * A shopping list with the two counts every screen that lists them renders.
 *
 * `ListView` nests them under `counts` and `ZoneListPreview` carries them flat, which
 * is the one place the two wire shapes differ; the field names inside are identical on
 * purpose, so one mapper reads both (backend plan 0017, section 3.4). That difference
 * is absorbed by the mapper and never reaches here: a list is a list whichever endpoint
 * it arrived from.
 */
export interface ShoppingListSummary extends ShoppingList {
  readonly lineCount: number;
  readonly readyCount: number;
  /**
   * What **this caller** may do on this list, including the derived group staff grant
   * (backend plan 0036, section 7).
   *
   * Here rather than on `ShoppingList` because it is the one field on the payload that
   * is about the reader and not about the list. `ShoppingList` is what a realtime
   * `list.created` or `list.updated` carries, and a broadcast to a room cannot say
   * something different to each person in it, so a per caller set on that shape would
   * be a field nothing could fill honestly.
   *
   * An empty set is no access at all, and the list page reads it as such rather than
   * offering controls and learning from a refusal (velista plan 0030, section 3.2).
   * That is why it is a plain array with no null: "not known yet" is not a state this
   * app has, because every endpoint that answers with a list answers with the set too.
   */
  readonly myPermissions: readonly ListPermission[];
}

/**
 * One line on a list.
 *
 * `version` is the only concurrency handle the product has: the backend is last write
 * wins with a version column (plan 0001, D6), and lines are where two people actually
 * edit the same record at the same time. It is what section 7.2's reconciliation
 * compares.
 */
export interface Line {
  readonly id: string;
  readonly listId: string;
  readonly content: string;
  readonly quantity: number;
  readonly itemId: string | null;
  readonly position: number;
  readonly approvalStatus: LineApprovalStatus;
  readonly status: LineStatus;
  readonly createdByUserId: string;
  readonly approvedByUserId: string | null;
  readonly version: number;
}

/** A comment on a line. The only view the API gives a timestamp. */
export interface Comment {
  readonly id: string;
  readonly lineId: string;
  readonly authorUserId: string;
  readonly body: string;
  readonly createdAt: Date;
}

/**
 * Who a list is shared with, and what they may do.
 *
 * Keyed by **membership** and not by user, because that is what `PUT .../access` names
 * and therefore what the share sheet has to send back.
 *
 * Group staff are absent by construction: they hold all four permissions on every list
 * in the zone, derived rather than stored, so there is no row for them to be in
 * (backend plan 0036, section 2.4). The sheet draws their rows from `MembershipStore`,
 * which is the fresher copy of that fact.
 *
 * An **empty `permissions` array is a revocation**, not "leave this row alone". It is
 * how the same call both grants and removes, which is what lets the sheet have one save
 * button (backend plan 0036, section 5, rule 5).
 */
export interface ListAccessEntry {
  readonly membershipId: string;
  readonly permissions: readonly ListPermission[];
}

/** Someone currently connected. Advisory only, see plan 0004 section 6.7. */
export interface PresenceUser {
  readonly userId: string;
  readonly username: string;
}

/** Someone currently editing a specific line. Advisory only. */
export interface PresenceEditor extends PresenceUser {
  readonly lineId: string;
}

/** Who is in a zone right now. */
export interface ZonePresence {
  readonly zoneId: string;
  readonly online: readonly PresenceUser[];
}

/** Who is looking at and editing a list right now. */
export interface ListPresence {
  readonly listId: string;
  readonly viewers: readonly PresenceUser[];
  readonly editors: readonly PresenceEditor[];
}

/**
 * The signed-in user, as far as the app can tell.
 *
 * Three states, and the middle one is a first class product state rather than an edge
 * case (plan 0001, D6). `anonymous` has no backend representation: it is the absence
 * of a token.
 *
 * There is no display name here because the API does not expose one. See plan 0004
 * section 11 item 2.
 */
export type Identity =
  | { readonly kind: 'anonymous' }
  | {
      readonly kind: UserKind;
      readonly userId: string;
      /**
       * The caller's global username, which the token pair now carries (backend
       * plan 0018). It is the only human readable name the app has without a
       * request, which is what lets the app bar show a real initial.
       */
      readonly username: string;
    };

/** The token pair, as this app holds it. */
export interface SessionTokens {
  readonly userId: string;
  readonly kind: UserKind;
  /** Global username (backend plan 0018). Empty for a pair stored before it landed. */
  readonly username: string;
  readonly accessToken: string;
  /** Opaque, rotating, and single use. See plan 0004 section 5.4. */
  readonly refreshToken: string;
}

/**
 * The signed-in user's profile, from `GET /v1/account/me`.
 *
 * Only needed by the account screen: everything the home page shows comes off the
 * token pair, so this page issues no extra request for it.
 */
export interface UserProfile {
  readonly userId: string;
  readonly kind: UserKind;
  readonly username: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly displayName: string | null;
}
