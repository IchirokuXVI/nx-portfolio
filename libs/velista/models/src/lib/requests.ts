import type {
  LineApprovalStatus,
  ListPermission,
  SettlementOutcome,
  ZoneRole,
} from './enums';

/**
 * Request bodies, declared explicitly rather than derived from a model.
 *
 * The gateway's validation pipe runs with `forbidNonWhitelisted: true`, so a property
 * it does not recognise is a **400**, not something quietly stripped
 * (plan 0004, section 4.9). Spreading a domain model into a `PATCH` body is therefore
 * a bug rather than a shortcut, and these types are what make the right thing the easy
 * thing: a partial update sends the fields it names and nothing else.
 *
 * This is also the direction rule D4 does **not** apply in. Mapping is one way: models
 * come from the wire, request bodies go to it, and a mapped object is never sent back.
 */

/**
 * `username` is the name the **other members of that zone** see on this person.
 *
 * Optional, and normally omitted. The backend defaults it to the caller's global
 * username when it is absent (confirmed by the user, 2026-08-26; the field was
 * required until then, and `POST /v1/zones` rejected a body without it with a 400).
 * Sending nothing is therefore the right default, and it is what keeps `0003`'s
 * anonymous entry actions to the single tap the approved mock draws, with no name
 * step in front of them.
 *
 * It stays on the type because a later screen may well want to let someone use a
 * different name in a particular group.
 */
export interface CreateZoneRequest {
  readonly name: string;
  readonly username?: string;
}

export interface JoinZoneRequest {
  readonly joinCode: string;
  readonly username?: string;
}

export interface UpdateZoneRequest {
  readonly name?: string;
}

export interface SetRoleRequest {
  readonly role: ZoneRole;
}

export interface CreateListRequest {
  readonly name: string;
  /**
   * Whether every approved member of the group gets access to it (plan 0024).
   *
   * Sent on every create, including when it is true. The backend defaults an absent
   * field to sharing, but this client always states the answer it collected, so what
   * went over the wire is what the person ticked rather than what a default happened
   * to agree with.
   */
  readonly shareWithZone: boolean;
}

/**
 * Rename a list, or reconfigure it. `MANAGE` on the list, and nothing less.
 *
 * Both fields are optional and the sheet sends only the one it changed, which is the
 * whole reason this type is written out rather than spread from a model: the gateway
 * validates with `forbidNonWhitelisted`, and a `PATCH` body carrying every field would
 * make a rename overwrite a setting somebody else had just changed.
 */
export interface UpdateListRequest {
  readonly name?: string;
  /**
   * Whether new lines on this list arrive already approved (backend plan 0037,
   * section 3).
   *
   * It governs what a **new** line starts as and nothing else. Turning it on leaves the
   * lines already waiting waiting, because those are somebody's outstanding question
   * and a switch is not an answer to one.
   */
  readonly autoApproveLines?: boolean;
  /**
   * Whether everybody in the group may use this list (backend plan 0042, section 2.1).
   *
   * Turning it **on** gives read, write and decide to everybody currently in the group,
   * widening rather than replacing what anybody already holds. Turning it **off**
   * revokes nobody: it stops the next person from being granted, and the rows that
   * exist stay exactly as they are.
   */
  readonly sharedWithZone?: boolean;
}

/**
 * Replace what the named memberships may do on a list.
 *
 * **Not a partial update of a set.** Each entry states the whole answer for that
 * membership, and a membership the payload does not name is left alone (backend plan
 * 0036, section 5.2). An **empty `permissions` array deletes the row**, which is how
 * access is revoked, so an entry with nothing in it is a deliberate instruction and
 * never a way of saying "no change".
 *
 * The server adds `READ` to any non-empty set it is given, and the share sheet ticks it
 * in the checkbox handler as well. That duplicates the feedback, not the rule: the
 * server enforces and the sheet explains.
 */
export interface SetListAccessRequest {
  readonly entries: readonly {
    membershipId: string;
    permissions: readonly ListPermission[];
  }[];
}

export interface AddLineRequest {
  readonly content: string;
  readonly quantity?: number;
  /**
   * The catalog products this line stands for (backend plan 0048, section 1.1).
   *
   * A **set**, where this was a single optional `itemId` that nothing ever sent,
   * because `0012` put the catalog out of scope. Choosing a group in the composer
   * sends that group's products here; choosing one item sends one; typing
   * something and ignoring the list sends none, and that stays first class
   * (velista plan 0043, section 6).
   */
  readonly itemIds?: readonly string[];
}

export interface UpdateLineRequest {
  readonly content?: string;
  readonly quantity?: number;
  /**
   * Replace the whole product set. An empty array clears it back to free text.
   *
   * A whole set rather than an add or a remove, for the same reason the reorder
   * request takes the whole order: two people editing a line's products would
   * otherwise each send a delta against a set neither of them still has.
   */
  readonly itemIds?: readonly string[];
  /**
   * Products to move from the catalog's side of the line to the person's, without
   * otherwise changing the set (backend plan 0070, section 9).
   *
   * A field of its own rather than something inferred from {@link itemIds},
   * because a set replacement that happens to keep a product is not a statement
   * about who owns it: reading adoption out of it would adopt the whole line every
   * time somebody removed one product.
   *
   * **One way.** `0070` section 3 makes provenance move from the group to the
   * person and never back, so there is no field here that hands a product back.
   */
  readonly adoptItemIds?: readonly string[];
}

/**
 * Move a line's quantity by a **signed delta** (backend plan 0040, section 3).
 *
 * Not an absolute number, and that is the whole design of the reel (velista plan
 * 0043, section 4.1). Absolute writes from a moving control race each other and
 * the loser silently wins; a delta is applied atomically under the row's lock and
 * cannot. One per settled adjustment, sent when the overlay closes rather than
 * during the drag, so it is one request however many times the thumb went back
 * for more inside that window.
 *
 * Never zero. The server refuses it, and a gesture that ended where it started is
 * not an adjustment to send.
 */
export interface AddLineQuantityRequest {
  readonly delta: number;
}

/**
 * Say what happened to a line on a trip (backend plan 0047, section 4).
 *
 * There is no `SKIPPED`. Deciding not to buy something today has to leave the
 * line exactly as it was and must not look like it was dealt with, so it is the
 * absence of this call rather than a third outcome on it.
 */
export interface SettleLineRequest {
  readonly outcome: SettlementOutcome;
  /**
   * How many were bought. Omitted for a trip that found nothing, where the server
   * refuses a number outright.
   *
   * May exceed what the line asks for, and the excess is recorded rather than
   * clamped: the extra unit is real and belongs in the consumption history even
   * though it satisfies no demand.
   */
  readonly quantity?: number;
  /**
   * Which of the line's products was bought, on a line carrying more than one.
   *
   * Recorded on the settlement **as it was at the time**, because the line's set
   * can change afterwards and what somebody carried home cannot.
   */
  readonly itemId?: string;
}

/**
 * Deciding a suggested line.
 *
 * The status itself and **not** a boolean. `SetApprovalDto` takes `approvalStatus`, so
 * an `{ approved: true }` body is rejected by the whitelist before it reaches core.
 * The three way enum is also what the screen actually needs: staff can put a turned
 * down line back, which is a third outcome rather than the negation of a second
 * (plan 0012, section 3.4).
 */
export interface SetLineApprovalRequest {
  readonly approvalStatus: LineApprovalStatus;
}

export interface ReorderLinesRequest {
  readonly orderedLineIds: readonly string[];
}

export interface AddCommentRequest {
  readonly body: string;
}

/**
 * One entry of the transcript, in the gateway's words rather than this app's.
 *
 * `AssistantTurn` is what the panel holds; this is what `AssistantTurnDto` accepts.
 * They are two types on purpose: the wire says `USER` and `content`, the app says
 * `caller` and `text`, and exactly one function converts between them.
 *
 * There is deliberately no `SYSTEM` role to send. The operator prompt belongs to the
 * service, so a caller cannot contribute one: somebody who types "you are now in
 * developer mode" is sending `USER` text and it is handled as `USER` text all the way
 * down (backend `0039`, section 4).
 */
export interface AssistantMessageRequest {
  readonly role: 'USER' | 'ASSISTANT';
  readonly content: string;
}

/**
 * One conversation turn (`POST /v1/assistant`).
 *
 * The new message is its **own field** and is not the last entry of `transcript`. That
 * is the gateway's shape and it is worth not smoothing over: `transcript` is the
 * conversation so far, oldest first, and `message` is the thing being answered.
 */
export interface AssistantTurnRequest {
  readonly message: string;
  readonly transcript: readonly AssistantMessageRequest[];
}

export interface RegisterRequest {
  readonly email: string;
  readonly password: string;
  readonly displayName?: string;
}

export interface LoginRequest {
  readonly email: string;
  readonly password: string;
}

export interface RefreshRequest {
  readonly refreshToken: string;
}

/**
 * Consuming a confirmation link.
 *
 * The token is the raw one out of the email's query string. The server stores only a
 * hash of it, so this is the one moment it exists anywhere the client can see.
 */
export interface VerifyEmailRequest {
  readonly token: string;
}

/** Converting a guest in place. The user id comes from the token, never the body. */
export interface UpgradeRequest {
  readonly email: string;
  readonly password: string;
  readonly displayName?: string;
}

/**
 * Cursor pagination, as the gateway expects it.
 *
 * `limit` is validated to `[1, 100]` and **out of range is a 400**, not a clamp, so
 * nothing should pass a page size through from user input unchecked. The cursor is
 * opaque and carries the chosen `order`, so `order` must not change mid page.
 */
export interface PageRequest {
  readonly cursor?: string;
  readonly limit?: number;
  readonly order?: string;
}

/** Orders `GET /v1/zones` accepts. Anything else is rejected by the DTO. */
export const MY_ZONE_ORDERS = ['name', 'joined', 'recent'] as const;
export type MyZoneOrder = (typeof MY_ZONE_ORDERS)[number];

/** Orders `GET /v1/lists/:id/lines` accepts. */
export const LINE_ORDERS = ['position', 'created', 'updated'] as const;
export type LineOrder = (typeof LINE_ORDERS)[number];

/** Orders the list endpoints accept. */
export const LIST_ORDERS = ['name', 'created', 'updated'] as const;
export type ListOrder = (typeof LIST_ORDERS)[number];

/**
 * Renaming somebody inside one zone.
 *
 * Its own type rather than a reuse of anything on `Membership`, because this is the
 * direction rule D4 does not apply in: the body names the one field the route accepts,
 * and the gateway's pipe runs with `forbidNonWhitelisted`, so sending a mapped
 * membership would be a 400 rather than a shortcut.
 */
export interface SetUsernameRequest {
  readonly username: string;
}

/**
 * Renaming yourself everywhere, or only globally (`PATCH /v1/account/me`).
 *
 * `propagation` is optional on the wire and **never omitted here** (rule A3, plan
 * 0015): the gateway reads an absent field as `GLOBAL_ONLY`, which is not what the
 * screen offers as its default, so the safer answer only happens when it is sent.
 *
 * The value is the wire enum's own string rather than this app's `UsernameScope`,
 * because this is a request body and rule D4 maps one way: models come from the wire,
 * bodies go to it, and the translation between the two happens in `AccountApi`.
 */
export interface SetGlobalUsernameRequest {
  readonly username: string;
  readonly propagation: 'GLOBAL_ONLY' | 'MATCHING_ZONES';
}

/**
 * A shopping profile's editable half (`POST` and `PATCH /v1/account/shopping-profiles`).
 *
 * Create and edit take the same body, and the **collections are full replacements**:
 * absent leaves them alone, present makes them exactly what was sent, empty clears
 * them (backend `0049` section 6). Which is why every field here is optional.
 *
 * Three of the wire's fields are deliberately absent, and the absences are load
 * bearing:
 *
 * - `generationScope`, `generationSources` and `minSavingPercent`, because plan 0046
 *   section 9 keeps them off the page and a field nothing renders must not be one this
 *   app can send: an empty `generationSources` would clear a set no screen ever showed.
 * - `addressText`, because plan 0058 section 2 deleted the field that collected it.
 *   The column stays in core; nothing in this app may write to it again.
 * - **`postalCodes`, because a profile's codes are no longer all the user's**
 *   (backend 0062). The replacement collection states the profile's *own* codes, so a
 *   page that read a profile with derived rows and sent the list back would promote
 *   every one of them to the user's. Codes are written one at a time through
 *   {@link AddPostalCodeRequest} and the remove route, and this type is where that is
 *   made impossible rather than merely avoided.
 */
export interface WriteShoppingProfileRequest {
  readonly name?: string | null;
  readonly minSavingCents?: number;
  readonly supermarkets?: readonly {
    readonly supermarketId: string;
    readonly excluded?: boolean;
  }[];
}

/**
 * Add one postal code, and optionally the ones near it
 * (`POST /v1/account/shopping-profiles/:id/postal-codes`, plan 0058 sections 3 and 5).
 *
 * A row at a time rather than the replacement collection, for the reason on
 * {@link WriteShoppingProfileRequest}. `source` says whose code it is and accepts only
 * the two a person can mean: a derived code is something the server concluded, and a
 * client that could claim one could promote its own guess to a fact about the user.
 *
 * `expandNearby` is the checkbox beside the add control, and its default differs by
 * where the add came from: off for a typed code, on in the location sheet. Somebody
 * typing one specific code has usually named the place they mean; somebody who just
 * handed over their location has asked to be found.
 */
export interface AddPostalCodeRequest {
  readonly postalCode: string;
  readonly label?: string | null;
  readonly source?: 'TYPED' | 'DEVICE';
  readonly expandNearby?: boolean;
}

/**
 * What a device's point resolved to (`POST /v1/account/postal-code-lookups`).
 *
 * **Null is an answer**, not a failure: the server holds centroids rather than
 * boundaries, and a point further from every one of them than it is willing to guess
 * across gets "we don't know" instead of a confident wrong code. The sheet says so and
 * offers typing.
 */
export interface ResolvedPostalCode {
  readonly country: string;
  readonly postalCode: string | null;
}

/** Orders `GET /v1/zones/:id/members` accepts. Anything else is rejected by the DTO. */
export const MEMBER_ORDERS = ['joined', 'name', 'role'] as const;
export type MemberOrder = (typeof MEMBER_ORDERS)[number];
