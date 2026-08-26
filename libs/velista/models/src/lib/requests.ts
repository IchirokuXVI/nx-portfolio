import type { LineStatus, ListRole, ZoneRole } from './enums';

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
}

export interface UpdateListRequest {
  readonly name?: string;
}

export interface SetListAccessRequest {
  readonly entries: readonly { membershipId: string; role: ListRole }[];
}

export interface AddLineRequest {
  readonly content: string;
  readonly quantity?: number;
  readonly itemId?: string;
}

export interface UpdateLineRequest {
  readonly content?: string;
  readonly quantity?: number;
  readonly itemId?: string | null;
}

export interface SetLineStatusRequest {
  readonly status: LineStatus;
}

export interface SetLineApprovalRequest {
  readonly approved: boolean;
}

export interface ReorderLinesRequest {
  readonly orderedLineIds: readonly string[];
}

export interface AddCommentRequest {
  readonly body: string;
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
