import {
  LINE_APPROVAL_STATUS_FALLBACK,
  LINE_APPROVAL_STATUSES,
  LINE_STATUS_FALLBACK,
  LINE_STATUSES,
  MEMBERSHIP_STATUS_FALLBACK,
  MEMBERSHIP_STATUSES,
  USER_KIND_FALLBACK,
  USER_KINDS,
  ZONE_ROLE_FALLBACK,
  ZONE_ROLES,
  ZONE_STATUS_FALLBACK,
  ZONE_STATUSES,
  type Comment,
  type Line,
  type ListPresence,
  type ListPreview,
  type Membership,
  type MyZone,
  type Page,
  type PresenceEditor,
  type PresenceUser,
  type SessionTokens,
  type ShoppingList,
  type Zone,
  type ZonePresence,
  type ZoneSummary,
} from '@portfolio/velista/models';
import {
  date,
  isRecord,
  mapArray,
  nullableStr,
  numOr,
  oneOf,
  str,
  strOr,
} from './primitives';

/**
 * Every mapper in the app, and the **only** files that reference the wire shape.
 *
 * Rule D4 (plan 0004, section 4.1). Each function takes `unknown` and returns either
 * a model this app owns or `null`, and `null` means "this record is not renderable",
 * never "this record is empty".
 *
 * The contract types are deliberately **not** imported even as types here. They would
 * be documentation only, and importing them would put a second name for every field in
 * the file that exists to have exactly one. The gateway shapes these are built from
 * are cited per function instead, which stays accurate when a DTO is renamed and a
 * type import would not.
 *
 * The rule for what makes a record unrenderable: **an identifier that cannot be
 * defaulted**. A missing `name` can be an empty string and the card still works. A
 * missing `id` means nothing can be tapped, updated, or reconciled, so the record is
 * dropped.
 */

/** From `ZoneView` (`GET`/`PATCH /v1/zones/...`). */
export function toZone(raw: unknown): Zone | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = str(raw['id']);
  if (id === null) {
    return null;
  }

  return {
    id,
    name: strOr(raw['name'], ''),
    joinCode: strOr(raw['joinCode'], ''),
    status: oneOf(raw['status'], ZONE_STATUSES, ZONE_STATUS_FALLBACK),
    ownerUserId: nullableStr(raw['ownerUserId']),
  };
}

/**
 * From `MyZoneView` (`GET /v1/zones`).
 *
 * The summary block is absent from the API today (see the note on `MyZone`), so it is
 * mapped when present and left undefined otherwise rather than being defaulted to
 * zeroes. Zero members is a claim; absent is the truth.
 */
export function toMyZone(raw: unknown): MyZone | null {
  const zone = toZone(raw);
  if (zone === null || !isRecord(raw)) {
    return null;
  }

  const summary = toZoneSummary(raw['summary']);

  return {
    ...zone,
    myRole: oneOf(raw['myRole'], ZONE_ROLES, ZONE_ROLE_FALLBACK),
    myStatus: oneOf(
      raw['myStatus'],
      MEMBERSHIP_STATUSES,
      MEMBERSHIP_STATUS_FALLBACK
    ),
    ...(summary ? { summary } : {}),
  };
}

function toZoneSummary(raw: unknown): ZoneSummary | null {
  if (!isRecord(raw)) {
    return null;
  }

  return {
    memberCount: numOr(raw['memberCount'], 0),
    listCount: numOr(raw['listCount'], 0),
    pendingRequestCount: numOr(raw['pendingRequestCount'], 0),
    firstPendingRequesterName: nullableStr(raw['firstPendingRequesterName']),
    lists: mapArray(raw['lists'], toListPreview),
  };
}

function toListPreview(raw: unknown): ListPreview | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = str(raw['id']);
  if (id === null) {
    return null;
  }

  const lineCount = numOr(raw['lineCount'], 0);
  const readyCount = numOr(raw['readyCount'], 0);

  return {
    id,
    name: strOr(raw['name'], ''),
    lineCount,
    // "7 of 5 ready" is worse than a slightly wrong number: it reads as a bug and
    // costs the user their trust in every other count on the page.
    readyCount: Math.min(readyCount, lineCount),
  };
}

/** From `MembershipView`. Also arrives on every `member.*` realtime event. */
export function toMembership(raw: unknown): Membership | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = str(raw['id']);
  const zoneId = str(raw['zoneId']);
  const userId = str(raw['userId']);
  if (id === null || zoneId === null || userId === null) {
    return null;
  }

  return {
    id,
    zoneId,
    userId,
    username: strOr(raw['username'], ''),
    role: oneOf(raw['role'], ZONE_ROLES, ZONE_ROLE_FALLBACK),
    status: oneOf(
      raw['status'],
      MEMBERSHIP_STATUSES,
      MEMBERSHIP_STATUS_FALLBACK
    ),
  };
}

/** From `ListView`. Carries no timestamps, which is the API's shape, not an omission. */
export function toShoppingList(raw: unknown): ShoppingList | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = str(raw['id']);
  const zoneId = str(raw['zoneId']);
  if (id === null || zoneId === null) {
    return null;
  }

  return {
    id,
    zoneId,
    name: strOr(raw['name'], ''),
    createdByUserId: strOr(raw['createdByUserId'], ''),
  };
}

/** From `LineView`. `version` is what section 7.2's reconciliation compares. */
export function toLine(raw: unknown): Line | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = str(raw['id']);
  const listId = str(raw['listId']);
  if (id === null || listId === null) {
    return null;
  }

  return {
    id,
    listId,
    content: strOr(raw['content'], ''),
    quantity: numOr(raw['quantity'], 1),
    itemId: nullableStr(raw['itemId']),
    position: numOr(raw['position'], 0),
    approvalStatus: oneOf(
      raw['approvalStatus'],
      LINE_APPROVAL_STATUSES,
      LINE_APPROVAL_STATUS_FALLBACK
    ),
    status: oneOf(raw['status'], LINE_STATUSES, LINE_STATUS_FALLBACK),
    createdByUserId: strOr(raw['createdByUserId'], ''),
    approvedByUserId: nullableStr(raw['approvedByUserId']),
    // A missing version defaults to 0, which loses every reconciliation race rather
    // than winning one it should not. Overwriting somebody else's edit because a
    // field was absent is the one outcome worth defaulting against.
    version: numOr(raw['version'], 0),
  };
}

/** From `CommentView`. The only view the API gives a timestamp. */
export function toComment(raw: unknown): Comment | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = str(raw['id']);
  const lineId = str(raw['lineId']);
  const createdAt = date(raw['createdAt']);
  if (id === null || lineId === null || createdAt === null) {
    return null;
  }

  return {
    id,
    lineId,
    authorUserId: strOr(raw['authorUserId'], ''),
    body: strOr(raw['body'], ''),
    createdAt,
  };
}

export function toPresenceUser(raw: unknown): PresenceUser | null {
  if (!isRecord(raw)) {
    return null;
  }

  const userId = str(raw['userId']);
  if (userId === null) {
    return null;
  }

  return { userId, username: strOr(raw['username'], '') };
}

function toPresenceEditor(raw: unknown): PresenceEditor | null {
  const user = toPresenceUser(raw);
  if (user === null || !isRecord(raw)) {
    return null;
  }

  const lineId = str(raw['lineId']);
  return lineId === null ? null : { ...user, lineId };
}

/** From `ZonePresence`. Advisory only, see plan 0004 section 6.7. */
export function toZonePresence(raw: unknown): ZonePresence | null {
  if (!isRecord(raw)) {
    return null;
  }

  const zoneId = str(raw['zoneId']);
  if (zoneId === null) {
    return null;
  }

  return { zoneId, online: mapArray(raw['online'], toPresenceUser) };
}

/** From `ListPresence`. Advisory only. */
export function toListPresence(raw: unknown): ListPresence | null {
  if (!isRecord(raw)) {
    return null;
  }

  const listId = str(raw['listId']);
  if (listId === null) {
    return null;
  }

  return {
    listId,
    viewers: mapArray(raw['viewers'], toPresenceUser),
    editors: mapArray(raw['editors'], toPresenceEditor),
  };
}

/**
 * From `AuthTokens`.
 *
 * Every field is required: a token pair missing any part of itself is not a partially
 * usable session, it is a failed sign in, and treating it as anything else strands the
 * user in a state no screen is written for.
 */
export function toSessionTokens(raw: unknown): SessionTokens | null {
  if (!isRecord(raw)) {
    return null;
  }

  const userId = str(raw['userId']);
  const accessToken = str(raw['accessToken']);
  const refreshToken = str(raw['refreshToken']);
  if (userId === null || accessToken === null || refreshToken === null) {
    return null;
  }

  return {
    userId,
    kind: oneOf(raw['kind'], USER_KINDS, USER_KIND_FALLBACK),
    accessToken,
    refreshToken,
  };
}

/**
 * From `Paginated<T>`.
 *
 * A body that is not a page at all yields an empty page with no cursor, which reads to
 * a caller as "no more data" and stops a pagination loop rather than spinning it.
 */
export function toPage<T>(
  raw: unknown,
  mapItem: (item: unknown) => T | null
): Page<T> {
  if (!isRecord(raw)) {
    return { items: [], nextCursor: null };
  }

  return {
    items: mapArray(raw['items'], mapItem),
    nextCursor: nullableStr(raw['nextCursor']),
  };
}

/** From the `{ id }` acknowledgement several delete endpoints return. */
export function toDeletedId(raw: unknown): string | null {
  return isRecord(raw) ? str(raw['id']) : null;
}
