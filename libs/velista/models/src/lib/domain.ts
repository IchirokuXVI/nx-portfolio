import type {
  LineApprovalStatus,
  LineStatus,
  ListRole,
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
 * A zone the caller belongs to, with their standing in it and the summary the home
 * page renders.
 *
 * **The summary block does not exist on the API yet.** `MyZoneView` is still
 * `ZoneView` plus `myRole` and `myStatus`, and there is no endpoint that lists a
 * zone's members at all. `0003` section 5.2 records the requirement and the user
 * confirmed on 2026-08-26 that the backend work has not landed, so the in-memory
 * implementation serves these and the HTTP one leaves them undefined until it can.
 *
 * They are therefore **optional**, and every consumer has to render without them.
 * That is not a temporary shim: a summary that has not loaded yet looks the same as
 * one the backend cannot serve, and the page needs to cope with both regardless.
 */
export interface MyZone extends Zone {
  readonly myRole: ZoneRole;
  readonly myStatus: MembershipStatus;
  readonly summary?: ZoneSummary;
}

/** The counts `0003` draws on a zone card. See the note on {@link MyZone}. */
export interface ZoneSummary {
  readonly memberCount: number;
  readonly listCount: number;
  /** How many people are waiting to be let in. Zero hides the attention row. */
  readonly pendingRequestCount: number;
  /**
   * The **oldest** pending requester's name, which is what `0003` section 4.1
   * renders. Order matters: taking whoever arrives first makes the name change on
   * every reload and the row look broken.
   */
  readonly firstPendingRequesterName: string | null;
  /** A short preview of the zone's lists, enough to draw the card without a fan out. */
  readonly lists: readonly ListPreview[];
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

/** Who a list is shared with, and how. */
export interface ListAccessEntry {
  readonly membershipId: string;
  readonly role: ListRole;
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
  | { readonly kind: UserKind; readonly userId: string };

/** The token pair, as this app holds it. */
export interface SessionTokens {
  readonly userId: string;
  readonly kind: UserKind;
  readonly accessToken: string;
  /** Opaque, rotating, and single use. See plan 0004 section 5.4. */
  readonly refreshToken: string;
}
