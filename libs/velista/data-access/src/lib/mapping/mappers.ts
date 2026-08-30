import {
  COMMENT_TRANSCRIPTION_FALLBACK,
  COMMENT_TRANSCRIPTIONS,
  LINE_APPROVAL_STATUS_FALLBACK,
  LINE_APPROVAL_STATUSES,
  LINE_STATUS_FALLBACK,
  LINE_STATUSES,
  LIST_PERMISSIONS,
  MEMBERSHIP_STATUS_FALLBACK,
  MEMBERSHIP_STATUSES,
  USER_KIND_FALLBACK,
  USER_KINDS,
  ZONE_ROLE_FALLBACK,
  ZONE_ROLES,
  ZONE_STATUS_FALLBACK,
  ZONE_STATUSES,
  type AssistantReference,
  type AssistantReply,
  type Comment,
  type CommentRecording,
  type CommentTranscription,
  type Line,
  type ListAccessEntry,
  type ListPermission,
  type ListPresence,
  type ListPreview,
  type ListResolution,
  type Membership,
  type MyZone,
  type Page,
  type PresenceEditor,
  type PresenceUser,
  type SessionTokens,
  type ShoppingList,
  type ShoppingListSummary,
  type UserProfile,
  type Zone,
  type ZoneCounts,
  type ZonePresence,
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
 * From `MyZoneView` (`GET /v1/zones`), which since backend plan 0017 carries the
 * counts and a preview of up to three lists.
 */
export function toMyZone(raw: unknown): MyZone | null {
  const zone = toZone(raw);
  if (zone === null || !isRecord(raw)) {
    return null;
  }

  return {
    ...zone,
    myRole: oneOf(raw['myRole'], ZONE_ROLES, ZONE_ROLE_FALLBACK),
    myStatus: oneOf(
      raw['myStatus'],
      MEMBERSHIP_STATUSES,
      MEMBERSHIP_STATUS_FALLBACK
    ),
    counts: toZoneCounts(raw['counts']),
    lists: mapArray(raw['lists'], toListPreview),
  };
}

/**
 * The counts block, which the gateway now always sends.
 *
 * Defaulted rather than required, because rule D4 does not stop applying once a field
 * is guaranteed: "always present" is a promise about the current deploy, and a phone
 * running a cached bundle against an older one would otherwise render a card with no
 * numbers at all instead of zeroes.
 *
 * The two governance fields keep their `null`, which is not a missing value: it means
 * the caller may not see who is waiting, and collapsing it to `0` would quietly turn
 * "you cannot see this" into "there is nothing to see".
 */
function toZoneCounts(raw: unknown): ZoneCounts {
  if (!isRecord(raw)) {
    return {
      memberCount: 0,
      listCount: 0,
      pendingRequestCount: null,
      firstPendingRequesterName: null,
    };
  }

  const pending = raw['pendingRequestCount'];

  return {
    memberCount: numOr(raw['memberCount'], 0),
    listCount: numOr(raw['listCount'], 0),
    pendingRequestCount:
      typeof pending === 'number' && Number.isFinite(pending) ? pending : null,
    firstPendingRequesterName: nullableStr(raw['firstPendingRequesterName']),
  };
}

/**
 * The line totals, from either of the two shapes that carry them.
 *
 * `ZoneListPreview` (inside `MyZoneView`) puts `lineCount` and `readyCount` at the top
 * level; `ListView` (from `GET /v1/zones/:id/lists`) nests the same two names under
 * `counts`. The **names** match deliberately so that one client shape serves both
 * (backend plan 0017, section 3.4), and this is the one function that has to know where
 * they sit. Everything above it reads a list the same way whichever call it came from.
 */
function readListCounts(raw: Record<string, unknown>): {
  lineCount: number;
  readyCount: number;
} {
  const nested = raw['counts'];
  const source = isRecord(nested) ? nested : raw;

  const lineCount = numOr(source['lineCount'], 0);
  const readyCount = numOr(source['readyCount'], 0);

  return {
    lineCount,
    // "7 of 5 ready" is worse than a slightly wrong number: it reads as a bug and
    // costs the user their trust in every other count on the page.
    readyCount: Math.min(readyCount, lineCount),
  };
}

/**
 * From `ZoneListPreview` **or** `ListView`.
 *
 * One mapper for both, which is what the contract's matching field names were for. The
 * group page's rows and the zone card's previews are the same row, so they are the same
 * model (plan 0010, section 5.1).
 */
export function toListPreview(raw: unknown): ListPreview | null {
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
    ...readListCounts(raw),
  };
}

/**
 * From `ListView`, with its counts.
 *
 * What `ListStore` holds. It is `toShoppingList` plus the two numbers rather than a
 * separate parse, so a rename of a field on the wire breaks one place.
 */
export function toShoppingListSummary(
  raw: unknown
): ShoppingListSummary | null {
  const list = toShoppingList(raw);
  if (list === null || !isRecord(raw)) {
    return null;
  }

  return {
    ...list,
    ...readListCounts(raw),
    myPermissions: toListPermissions(raw['myPermissions']),
  };
}

/**
 * A permission set off the wire, from `ListView.myPermissions` or an access entry.
 *
 * **Unrecognised members are dropped, and there is no fallback.** Rule D4 usually asks
 * for the least dangerous reading of a value this build has never heard of, and for a
 * single-valued enum something has to be picked. A set has a strictly correct answer
 * instead: keep the members it understood and ignore the rest (plan 0030, section 2).
 * That is also the safe direction twice over, since a client that does not know a
 * permission draws no control for it and the server would refuse what that control sent.
 *
 * An absent field, a `null`, a string, an object, anything that is not an array: the
 * **empty set**, which the page reads as read only. It is the one default here and it is
 * the conservative one. The old `canWrite` guessed the other way and found out from a
 * refused write, which was defensible with one control to be wrong about and is not with
 * nine.
 *
 * Duplicates are kept as they arrive rather than deduplicated: every reader asks
 * `includes`, so a repeated member costs nothing, and rewriting the server's answer to
 * tidy it would be the mapper deciding something.
 */
export function toListPermissions(raw: unknown): ListPermission[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter((member): member is ListPermission =>
    (LIST_PERMISSIONS as readonly string[]).includes(member as string)
  );
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
    // False for anything that is not literally `true`, which is the safe reading: a
    // list that is assumed to auto-approve would have its optimistic rows drawn already
    // approved and corrected a frame later, which is the defect backend plan 0037 is
    // about, in the other direction.
    autoApproveLines: raw['autoApproveLines'] === true,
    // Same reading, opposite safe direction and the same conclusion: a list assumed
    // shared would draw the switch on for a list nobody opened, and turning a switch
    // off that was never on is the one gesture here that cannot be undone by turning
    // it back on, because turning it on grants.
    sharedWithZone: raw['sharedWithZone'] === true,
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

  const recording = toCommentRecording(raw['recording']);

  return {
    id,
    lineId,
    authorUserId: strOr(raw['authorUserId'], ''),
    // Empty is not a missing field here since backend plan 0045: a voice comment
    // whose transcription failed carries no body and is still a real comment.
    body: strOr(raw['body'], ''),
    recording,
    // Only meaningful beside a recording. A typed comment from an older gateway
    // carries neither, and reading a transcription state onto one would have the
    // row waiting for a transcript that was never coming.
    transcription: recording === null ? null : toTranscription(raw),
    createdAt,
  };
}

/**
 * The recording metadata on a `CommentView`, or null for a typed comment.
 *
 * A missing or unreadable `contentType` is the single test for "no recording":
 * without it nothing can be played and the row must draw as an ordinary comment,
 * whatever else the object claimed.
 */
function toCommentRecording(raw: unknown): CommentRecording | null {
  if (!isRecord(raw)) {
    return null;
  }

  const contentType = str(raw['contentType']);
  if (contentType === null) {
    return null;
  }

  const durationSeconds = raw['durationSeconds'];

  return {
    contentType,
    byteLength: numOr(raw['byteLength'], 0),
    // Null rather than zero when the server has no figure, because zero is a
    // length the player would draw and "unknown" is not (plan 0039, section 4).
    durationSeconds:
      typeof durationSeconds === 'number' &&
      Number.isFinite(durationSeconds) &&
      durationSeconds > 0
        ? durationSeconds
        : null,
  };
}

function toTranscription(raw: Record<string, unknown>): CommentTranscription {
  return oneOf(
    raw['transcription'],
    COMMENT_TRANSCRIPTIONS,
    COMMENT_TRANSCRIPTION_FALLBACK
  );
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
    // Required on the wire since backend plan 0018, but defaulted rather than
    // required here: a pair written to storage before that landed has no username,
    // and rejecting it would sign out every existing session on deploy.
    username: strOr(raw['username'], ''),
    accessToken,
    refreshToken,
  };
}

/** From `UserProfileView` (`GET /v1/account/me`). */
export function toUserProfile(raw: unknown): UserProfile | null {
  if (!isRecord(raw)) {
    return null;
  }

  const userId = str(raw['userId']);
  if (userId === null) {
    return null;
  }

  return {
    userId,
    kind: oneOf(raw['kind'], USER_KINDS, USER_KIND_FALLBACK),
    username: strOr(raw['username'], ''),
    email: nullableStr(raw['email']),
    emailVerified: raw['emailVerified'] === true,
    displayName: nullableStr(raw['displayName']),
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

/**
 * From `ListAccessView` (`GET /v1/lists/:id/access`), which lands with backend plan
 * 0036 section 6 gated on `MANAGE`.
 *
 * It answers `{ listId, entries }`, and only the entries are read: the list id is the
 * one the caller asked about, so carrying it up would be handing the sheet back the
 * argument it passed in. A bare array is still accepted, because it is the same fact in
 * the same shape the `PUT` takes and refusing a payload this function could plainly read
 * would cost the caller the whole sheet.
 *
 * Group staff are absent from it by construction and that is not a gap: they hold all
 * four permissions on every list in the zone by derivation, and the sheet builds their
 * rows from `MembershipStore`, which is the fresher copy.
 *
 * An entry with no membership id is dropped, per the rule at the top of this file: it
 * names nobody, so no row can be drawn for it. An entry whose permissions are missing or
 * unreadable is **kept, with an empty set**, because a row with no access is a real row
 * in this sheet and dropping it would hide a member the caller can grant access to.
 */
export function toListAccessEntries(raw: unknown): readonly ListAccessEntry[] {
  const items = Array.isArray(raw)
    ? raw
    : isRecord(raw)
      ? raw['entries']
      : null;

  return mapArray(items, toListAccessEntry);
}

function toListAccessEntry(raw: unknown): ListAccessEntry | null {
  if (!isRecord(raw)) {
    return null;
  }

  const membershipId = str(raw['membershipId']);
  if (membershipId === null) {
    return null;
  }

  return {
    membershipId,
    permissions: toListPermissions(raw['permissions']),
  };
}

/**
 * `POST /v1/assistant` (backend `0039`, rule A3).
 *
 * The text is what the model wrote, and it is rendered as **text**: nothing here
 * parses it, and nothing downstream renders it as markdown. A reply with no readable
 * text is unrenderable, so this returns `null` and the panel says the turn failed,
 * which is honest — an empty bubble is not.
 *
 * `references` is the half rule A3 exists for. Every entry the panel draws a link from
 * came out of a tool result in the same turn, so the target exists and the caller can
 * see it. That guarantee is only worth anything if a malformed entry is **dropped**
 * rather than defaulted: a reference missing its `listId` cannot address a list, and
 * inventing one would produce exactly the 404 the rule is written to prevent. So each
 * kind requires its own ids and nothing is filled in.
 */
export function toAssistantReply(raw: unknown): AssistantReply | null {
  if (!isRecord(raw)) {
    return null;
  }

  // `reply` on the wire, `text` in this app. The rename is here and nowhere else.
  const text = str(raw['reply']);
  if (text === null) {
    return null;
  }

  const resolution = LIST_RESOLUTIONS[strOr(raw['listResolution'], '')];

  return {
    text,
    references: mapArray(raw['references'], toAssistantReference),
    ...(resolution === undefined ? {} : { listResolution: resolution }),
  };
}

/**
 * `ListResolutionBranch` on the wire, this app's own words here.
 *
 * A lookup rather than `oneOf`, because the two vocabularies genuinely differ and the
 * map is the translation. An unrecognised branch, or an absent one, comes out
 * `undefined`: the field is optional by contract and nothing here behaves differently
 * for a value it does not know.
 */
const LIST_RESOLUTIONS: Readonly<Record<string, ListResolution | undefined>> = {
  NAMED: 'named',
  CONVERSATION: 'conversation',
  ONLY_LIST: 'onlyList',
  ASKED: 'asked',
};

/** `AssistantReferenceKind` on the wire, this app's own words here. */
const REFERENCE_KINDS: Readonly<
  Record<string, AssistantReference['kind'] | undefined>
> = {
  ZONE: 'zone',
  LIST: 'list',
  LINE: 'line',
};

function toAssistantReference(raw: unknown): AssistantReference | null {
  if (!isRecord(raw)) {
    return null;
  }

  // Unlike every other narrowing in this file, an unrecognised kind has no fallback to
  // land on. There is no generic reference the panel could link somewhere sensible, so
  // a kind from a newer backend is dropped and the reply renders with one link fewer.
  const kind = REFERENCE_KINDS[strOr(raw['kind'], '')];
  const label = strOr(raw['label'], '');
  const zoneId = str(raw['zoneId']);
  if (kind === undefined || zoneId === null) {
    return null;
  }

  if (kind === 'zone') {
    return { kind, zoneId, label };
  }

  // `listId` and `lineId` are **nullable** on the wire: the contract sets them per
  // kind and sends null for the ones that do not apply. `str` already collapses a null
  // to null, so this is the same check it always was, and it is what makes rule A3
  // hold: a reference this app cannot address is dropped rather than half built, and a
  // link that would 404 is never drawn.
  const listId = str(raw['listId']);
  if (listId === null) {
    return null;
  }

  if (kind === 'list') {
    return { kind, zoneId, listId, label };
  }

  const lineId = str(raw['lineId']);

  return lineId === null ? null : { kind, zoneId, listId, lineId, label };
}
