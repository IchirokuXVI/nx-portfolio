import type {
  CommentTranscription,
  LineApprovalStatus,
  ListPermission,
  MembershipStatus,
  SettlementOutcome,
  UnitOfMeasure,
  UserKind,
  ZoneRole,
  ZoneStatus,
} from './enums';
import type { LocalizedName } from './shopping-profile';

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
  /**
   * How many of this list's lines the household currently wants: `quantity > 0`.
   *
   * It was `readyCount`, counting lines somebody had ticked on some trip, and the
   * rename is a change of subject rather than of wording (backend plan 0047,
   * section 2.3). "Four things needed" is the figure a card should have been
   * showing all along; "four things already bought" never was, and it stopped
   * being computable at all when the trip status was dropped.
   */
  readonly wantedCount: number;
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
  /**
   * Whether everybody in the group may use this list, people who join later included
   * (backend plan 0042, section 2.1).
   *
   * List configuration like `autoApproveLines` beside it, and for the same reason: it
   * is the same answer for everybody looking at the list, so it rides the realtime
   * `list.updated` payload rather than being a fact about the reader.
   *
   * It is here at all because sharing used to be an **action** taken once at creation
   * and then over. Nothing recorded it, so a member approved a minute later got nothing
   * and no screen could offer to change it. As state the settings sheet can read it and
   * flip it, which is what velista plan 0036 section 7 does with it.
   */
  readonly sharedWithZone: boolean;
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
  /**
   * How many of this list's lines the household currently wants: `quantity > 0`.
   *
   * It was `readyCount`, counting lines somebody had ticked on some trip, and the
   * rename is a change of subject rather than of wording (backend plan 0047,
   * section 2.3). "Four things needed" is the figure a card should have been
   * showing all along; "four things already bought" never was, and it stopped
   * being computable at all when the trip status was dropped.
   */
  readonly wantedCount: number;
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
  /**
   * How many of this the household wants **right now**, and the line's only
   * state (velista plan 0043, section 1).
   *
   * There is no `status` beside it any more, and its absence is the plan. A tick
   * was a fact about one shopping trip written onto a record that outlives every
   * trip, so a shared list filled with ticked lines and the only ways out were
   * deleting what you knew about the thing or resetting it by hand every week.
   * Buying decrements this instead, zero means stocked, and the line stays
   * exactly where it is holding everything it knows about itself.
   */
  readonly quantity: number;
  /**
   * The catalog products this line stands for, in the order they were attached
   * (backend plan 0048, section 1.1). Empty is a free text line, which stays
   * first class.
   *
   * A **set**, where this was a single nullable `itemId` that was null on every
   * line ever created, because `0012` put the catalog out of scope. Picking a
   * group in the composer copies that group's members here and the line
   * references no group afterwards: a line is its own hand made group, so
   * dropping a brand the household never buys is an ordinary edit rather than a
   * change to somebody else's taxonomy.
   */
  readonly itemIds: readonly string[];
  readonly position: number;
  readonly approvalStatus: LineApprovalStatus;
  /**
   * How many times this line has ever been bought (backend plan 0047, section 5).
   *
   * Half of an indicator rather than a number anything draws. `quantity = 0`
   * alone cannot tell a thing the household has just bought from a thing
   * somebody typed and has never needed, and those two rows are drawn
   * differently on purpose (section 3.2), so the count is what separates them.
   *
   * It is on the line because it cannot be computed from anything else the line
   * carries, and asking per row would be a request per line on a screen somebody
   * opens in a shop.
   */
  readonly boughtCount: number;
  /**
   * What the most recent settlement on this line said, or null when it has none.
   *
   * The most recent one and not a flag, which is the point: "they did not have
   * it" is a fact about the last trip and expires the moment somebody does buy
   * it, so there is nothing to store and nothing for anybody to clear.
   */
  readonly lastSettlementOutcome: SettlementOutcome | null;
  /**
   * Whether somebody is out buying this right now (backend plan 0052).
   *
   * The third indicator, and the one that is not derived from the line's own
   * history: the line is in a basket somebody has composed and not yet finished,
   * so putting it in a second trolley buys the household two of it.
   *
   * It is **on the line**, where velista `0043` held it beside them as presence.
   * Backend plan 0052 section 4 is the reason it moved: an event tells a
   * connected client what changed and tells a client that connects afterwards
   * nothing at all, and a shopping trip lasts an hour while a phone sleeps in a
   * pocket. An indicator that is right only for whoever happened to be watching
   * is worse than absent, because it is intermittently right.
   */
  readonly claimed: boolean;
  /**
   * Who is out buying it, or null.
   *
   * Null in two different situations and the row draws the same either way: the
   * line is not claimed at all, or it is claimed by somebody who has since left
   * the zone and whose name is therefore no longer this reader's to have. Pair it
   * with {@link claimed} to tell them apart.
   */
  readonly claimedByUserId: string | null;
  readonly createdByUserId: string;
  readonly approvedByUserId: string | null;
  readonly version: number;
}

/**
 * One thing that happened to a line on one trip (backend plan 0047, section 3).
 *
 * Written once and never edited, which is what makes it a history rather than a
 * state. Most rows are purchases and the screen calls the `BOUGHT` subset the buy
 * history, but a row saying the shop did not have it is not a purchase, and that
 * is why the type is named for the act rather than for the happy case.
 */
export interface LineSettlement {
  readonly id: string;
  readonly lineId: string;
  readonly listId: string;
  /**
   * Which product was bought, **as it was at the time**, or null on a free text
   * line.
   *
   * Copied onto the settlement rather than read back through the line, because a
   * line's product set can change afterwards and what somebody actually carried
   * home cannot (section 3.2).
   */
  readonly itemId: string | null;
  readonly outcome: SettlementOutcome;
  /** Units bought. Zero for a trip that found nothing. */
  readonly quantity: number;
  /**
   * Who settled it, or null when a shared basket did (backend plan 0051).
   *
   * Null does not mean nobody: it means the settle came off a basket, where the
   * person holding it may be a guest with no account. The row says "somebody"
   * rather than naming an id.
   */
  readonly settledByUserId: string | null;
  readonly settledAt: Date;
  /**
   * When this settlement was taken back, or null if it still stands (luna `0054`,
   * section 3.3).
   *
   * A reopen does **not** delete the settlements it undoes: a settlement is an append
   * (`0047` section 3), and that does not change. So a reverted row is excluded from
   * every consumption total on the server and is **still served by the history**,
   * marked, because "somebody said they got this and then took it back" is a truer
   * history than a gap, and reconciling two people's trips is the whole reason to open
   * that pane.
   *
   * Null for every row written before that plan.
   */
  readonly revertedAt: Date | null;
}

/**
 * One catalog product, as much of it as this app draws.
 *
 * Far narrower than the gateway's `ItemView`, and deliberately: the suggestion
 * row and the product chip need a name and a brand, and every price field on the
 * wire is out of scope until the backend's backlog `0004` exists (velista plan
 * 0043, section 9). Widening it later is a mapper change; carrying fields nothing
 * renders is a promise the screen cannot keep.
 */
export interface CatalogItem {
  readonly id: string;
  /**
   * The pair, resolved with `inLocale` where it is drawn.
   *
   * Not flattened in the mapper, which is the convention every other catalog name in
   * this app follows (`Supermarket`, `ProductGroup` beside it). The mapper has no
   * locale and should not be given one: it runs once per response, the reader can
   * change language without a refetch, and a name flattened at parse time would then
   * be the old language until something evicted the cache.
   */
  readonly name: LocalizedName;
  readonly brand: string | null;
  /**
   * How much of it is in the packet: `1` with {@link CatalogItem.unit} `LITER`,
   * `0.35` with `KILOGRAM`. Null when the catalog does not know.
   *
   * **Read because the catalog holds one record per size.** Without it a search
   * for "leche" offers the same name and the same brand three times over, once
   * per carton size, and the rows are indistinguishable. It is the same field
   * `BasketProduct.size` already reads, under the same name.
   */
  readonly size: number | null;
  /** What {@link CatalogItem.size} is counted in. Never null; see the fallback. */
  readonly unit: UnitOfMeasure;
  readonly productGroupId: string | null;
}

/** One catalog group: the thing "milk" means before it means a brand of it. */
export interface ProductGroup {
  readonly id: string;
  readonly name: LocalizedName;
}

/**
 * One row of the composer's dropdown (backend plan 0048, section 3).
 *
 * A discriminated union rather than an object with two nullable halves, because
 * every consumer of it does exactly one thing per kind and the wire's shape
 * (`{ kind, group, item }`, both nullable) makes "a group suggestion with no
 * group on it" representable. The mapper drops those; nothing downstream has to
 * consider them.
 */
export type CatalogSuggestion =
  | {
      readonly kind: 'group';
      readonly group: ProductGroup;
      /**
       * The group's products, which choosing it attaches to the line whole.
       *
       * The one place the size of a group is stated, and therefore what the row
       * says it will add. `ProductGroup` used to carry an `itemCount` beside it;
       * nothing on the wire ever set it, so every group row offered to add zero
       * products while attaching none.
       */
      readonly itemIds: readonly string[];
    }
  | { readonly kind: 'item'; readonly item: CatalogItem };

/**
 * A recording somebody just made, on its way to being sent (velista plan 0039).
 *
 * It lives here rather than beside the recorder because it crosses a component
 * boundary: the comment composer produces one and the sheet uploads it, and
 * neither should have to name a platform device to describe what it is holding.
 *
 * `AudioCapture` deliberately keeps no clock (backend plan 0041 built it that
 * way, since pausing is arithmetic rather than a device capability), so the
 * duration here is measured by whoever ran the recording.
 */
export interface RecordedAudio {
  blob: Blob;
  /** What the browser negotiated, taken from the blob itself. */
  mimeType: string;
  /** How long the recorder ran, in seconds. Never trusted by the server. */
  durationSeconds: number;
}

/** What a comment's recording weighs and how long it runs. */
export interface CommentRecording {
  readonly contentType: string;
  readonly byteLength: number;
  /**
   * How long it runs, or null when the server has no figure.
   *
   * It comes from the comment rather than from the file, which is what lets a row
   * be drawn correctly before anything is downloaded (plan 0039, section 4).
   */
  readonly durationSeconds: number | null;
}

/** A comment on a line. The only view the API gives a timestamp. */
export interface Comment {
  readonly id: string;
  readonly lineId: string;
  readonly authorUserId: string;
  /**
   * What was said.
   *
   * For a voice comment this is the transcript, which is the whole of plan 0039
   * section 3: a voice comment lands in the thread as text, in the same bubble,
   * read by the same row component, and it carries a recording that can be
   * played. **It can be empty**, and the row draws a neutral phrase rather than
   * an empty bubble when it is.
   */
  readonly body: string;
  /** The recording, when this comment is one. Null for a typed comment. */
  readonly recording: CommentRecording | null;
  /** Null for a typed comment, which has no transcript to wait for. */
  readonly transcription: CommentTranscription | null;
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
