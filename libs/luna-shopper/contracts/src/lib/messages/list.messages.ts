import type {
  CommentTranscription,
  LineApprovalStatus,
  LineStatus,
  ListPermission,
} from '../enums/list.enums';
import type { PageQuery, Paginated } from '../pagination';

/**
 * Shopping list, line, and comment message contracts (plan 0007). The gateway
 * calls these on core; core authorizes each against its own membership and
 * list-access tables using the resolved `userId`.
 */
export const LIST_PATTERNS = {
  create: 'list.create',
  setAccess: 'list.setAccess',
  getAccess: 'list.getAccess',
  update: 'list.update',
  delete: 'list.delete',
  list: 'list.list',
} as const;

export const LINE_PATTERNS = {
  add: 'line.add',
  update: 'line.update',
  setApproval: 'line.setApproval',
  setStatus: 'line.setStatus',
  reorder: 'line.reorder',
  delete: 'line.delete',
  list: 'line.list',
} as const;

export const COMMENT_PATTERNS = {
  add: 'comment.add',
  list: 'comment.list',
  /**
   * A comment that is a recording (plan 0045). Its own subject rather than a
   * second shape on `comment.add`, for the reason section 3 gives about the
   * route: the typed path is the busiest write in the product and it is left
   * untouched.
   */
  addVoice: 'comment.addVoice',
  /** The bytes back, gated on `READ` of the comment's list (plan 0045, section 5). */
  getAudio: 'comment.getAudio',
  /**
   * The transcript, once the assistant has produced one (plan 0045, section 4.1).
   *
   * Called by the gateway after it has already answered the caller, which is what
   * makes a provider outage cost a transcript and never a message.
   */
  setTranscription: 'comment.setTranscription',
} as const;

/** The counts shown alongside a full list (plan 0017, section 3.4). */
export interface ListCounts {
  /** Every line, whatever its approval or item status. */
  lineCount: number;
  /** Lines whose `status` is `LineStatus.READY`. Drives "7 of 12 ready". */
  readyCount: number;
}

export interface ListView {
  id: string;
  zoneId: string;
  name: string;
  createdByUserId: string;
  /**
   * The line totals. Field names match `ZoneListPreview` deliberately, so the
   * frontend maps one shape whichever endpoint it came from (plan 0017, 3.4).
   */
  counts: ListCounts;
  /**
   * Whether a new line on this list is approved the moment it is added (plan
   * 0037, section 3). Configuration rather than a preference: changing it needs
   * `MANAGE`, and it governs only what a **new** line starts as.
   */
  autoApproveLines: boolean;
  /**
   * What the **caller** may do on this list (plan 0036, section 7), including the
   * derived grant a zone OWNER or ADMIN holds on every list in the zone.
   *
   * It rides here rather than on a request of its own because it is per caller
   * data about a resource the caller is already fetching, and two round trips
   * could disagree for exactly as long as it took. It is what lets the client
   * stop offering controls and discovering from a refusal which of them existed.
   */
  myPermissions: ListPermission[];
  /** ISO 8601 UTC (plan 0017, section 7). */
  createdAt: string;
  /** ISO 8601 UTC (plan 0017, section 7). */
  updatedAt: string;
}

/**
 * One membership's stored permissions on one list.
 *
 * An **empty array means no access**, and `setAccess` stores it by deleting the
 * row rather than by writing an empty set (plan 0036, section 2.2). Group staff
 * never appear as an entry: their grant is derived from `ZoneRole` and there is
 * nothing stored to return or to revoke (section 2.4).
 */
export interface ListAccessEntry {
  membershipId: string;
  permissions: ListPermission[];
}

/** The stored access table for one list, as `GET /v1/lists/:id/access` returns it. */
export interface ListAccessView {
  listId: string;
  entries: ListAccessEntry[];
}

export interface LineView {
  id: string;
  listId: string;
  content: string;
  quantity: number;
  itemId: string | null;
  position: number;
  approvalStatus: LineApprovalStatus;
  status: LineStatus;
  createdByUserId: string;
  approvedByUserId: string | null;
  version: number;
  /** ISO 8601 UTC (plan 0017, section 7). */
  createdAt: string;
  /** ISO 8601 UTC (plan 0017, section 7). */
  updatedAt: string;
}

/**
 * What a recording on a comment weighs and how long it runs (plan 0045).
 *
 * It lives on the comment and not on the audio row, so a comment listing can draw
 * a player without the bytes ever entering the query: the whole point of keeping
 * `comment_audio` in its own table (section 2).
 */
export interface CommentRecording {
  /** What the browser recorded in, from the accepted list. */
  contentType: string;
  /** The stored size. The only number anything enforces on. */
  byteLength: number;
  /**
   * What the client said it lasts, or null when it said nothing.
   *
   * **Never trusted** (section 6). It is metadata for drawing a row before the
   * file is fetched; nothing authorizes on it and nothing rejects on it.
   */
  durationSeconds: number | null;
}

export interface CommentView {
  id: string;
  lineId: string;
  authorUserId: string;
  /**
   * The comment's text, which for a voice comment is its transcript.
   *
   * **It can be empty**, which every reader has to hold (plan 0045, section 4.2):
   * a comment whose transcription failed is a valid comment, and the client draws
   * a neutral phrase in its place rather than an empty bubble.
   */
  body: string;
  /** The recording, when this comment is one. Null for a typed comment. */
  recording: CommentRecording | null;
  /** How far the transcript got. Null for a typed comment, which has no transcript. */
  transcription: CommentTranscription | null;
  createdAt: string;
}

/** The bytes, base64 encoded for the broker (plan 0045, section 3). */
export interface CommentAudioView {
  commentId: string;
  contentType: string;
  /** Base64. It is decoded once, at the gateway, on the way to the caller. */
  audio: string;
}

export interface CreateListRequest {
  userId: string;
  zoneId: string;
  name: string;
  /**
   * Give every approved member of the zone access to the new list (plan 0034).
   *
   * **Optional, and absent means true.** A list nobody but its creator can open is
   * the rarer thing somebody chooses on purpose, and the field was added after
   * clients existed that do not send it; both point the default the same way. So an
   * older client keeps getting the shared list it has no way to ask for, rather than
   * silently starting to create private ones the moment this shipped.
   */
  shareWithZone?: boolean;
}

export interface SetListAccessRequest {
  userId: string;
  listId: string;
  entries: ListAccessEntry[];
}

export interface UpdateListRequest {
  userId: string;
  listId: string;
  name?: string;
  /** Turn approval on a new line on or off (plan 0037, section 3). `MANAGE`. */
  autoApproveLines?: boolean;
}

/** Read a list's stored access table (plan 0036, section 6). `MANAGE` only. */
export interface GetListAccessRequest {
  userId: string;
  listId: string;
}

/**
 * The caller's own permissions on one list changed (plan 0036, section 8).
 *
 * Addressed to the person behind the membership rather than to the list room,
 * because the room event names nobody and, by construction, cannot reach the one
 * person it most needs to: somebody who has just been **granted** access was
 * never in the room to hear it.
 *
 * An empty `permissions` is somebody who has just lost the list entirely.
 */
export interface ListMyAccessChangedEvent {
  listId: string;
  zoneId: string;
  permissions: ListPermission[];
}

export interface ListIdRequest {
  userId: string;
  listId: string;
}

export interface ListListsRequest extends PageQuery {
  userId: string;
  zoneId: string;
}

export interface AddLineRequest {
  userId: string;
  listId: string;
  content: string;
  quantity?: number;
  /**
   * Optional opaque reference to a catalog Item (plan 0012). Validated as a UUID
   * in application code, never a database foreign key: catalog is a separate
   * service with its own database and core never joins to it.
   */
  itemId?: string | null;
}

export interface UpdateLineRequest {
  userId: string;
  lineId: string;
  content?: string;
  quantity?: number;
  /** Set/clear the optional catalog Item reference (plan 0012). `null` clears it. */
  itemId?: string | null;
}

export interface SetLineApprovalRequest {
  userId: string;
  lineId: string;
  approvalStatus: LineApprovalStatus;
}

export interface SetLineStatusRequest {
  userId: string;
  lineId: string;
  status: LineStatus;
}

export interface ReorderLinesRequest {
  userId: string;
  listId: string;
  orderedLineIds: string[];
}

export interface DeleteLineRequest {
  userId: string;
  lineId: string;
}

export interface ListLinesRequest extends PageQuery {
  userId: string;
  listId: string;
}

export interface AddCommentRequest {
  userId: string;
  lineId: string;
  body: string;
}

export interface ListCommentsRequest extends PageQuery {
  userId: string;
  lineId: string;
}

/**
 * Leave a comment that is a recording (plan 0045, section 4).
 *
 * There is no `body`: the transcript arrives later through
 * {@link COMMENT_PATTERNS.setTranscription}, and a comment with no body is a
 * valid comment in the meantime. Sending a guess at the words here would be the
 * one thing section 4 forbids.
 */
export interface AddVoiceCommentRequest {
  userId: string;
  lineId: string;
  /** Base64, because this crosses the broker (plan 0041, section 4.2). */
  audio: string;
  contentType: string;
  /** What the client claims it lasts, or null. Metadata only (section 6). */
  durationSeconds: number | null;
}

export interface GetCommentAudioRequest {
  userId: string;
  commentId: string;
}

/**
 * Fill in a voice comment's transcript, or record that it has none.
 *
 * `userId` is the comment's author and core checks it, so this cannot be used to
 * write words into somebody else's message even from inside the cluster. It only
 * ever moves a comment out of {@link CommentTranscription.PENDING}: a second call
 * on a settled comment changes nothing, which makes the gateway's retry safe.
 */
export interface SetCommentTranscriptionRequest {
  userId: string;
  commentId: string;
  /** Empty for every state but {@link CommentTranscription.READY}. */
  body: string;
  transcription: CommentTranscription;
}

/**
 * What a deployment accepts for a voice comment, unless its configuration says
 * otherwise (plan 0045, section 6; plan 0041, section 3.3).
 *
 * These are the defaults and the single place the numbers are written down; the
 * gateway and core both read their own configuration and fall back to here, so a
 * deployment can tighten them and neither service can hold a different idea of
 * what the other enforces.
 *
 * The list is what browsers actually produce through `MediaRecorder` (Chrome
 * gives WebM/Opus and will not negotiate Ogg, Firefox gives Ogg/Opus, Safari
 * gives MP4/AAC) plus the plain containers a provider documents. Anything else is
 * refused with a sentence rather than a stack trace, because "your browser
 * recorded in a format we cannot read" is a real thing that happens on some
 * device nobody tested.
 *
 * Parameters are stripped before the check, so `audio/webm;codecs=opus` is
 * `audio/webm`. The codec inside the container is not something this layer can
 * verify from a header anyway, so matching on it would be theatre.
 */
export const VOICE_COMMENT_CONTENT_TYPES: readonly string[] = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/aac',
  'audio/flac',
] as const;

/**
 * The byte cap, matching plan 0041's ceiling so one number governs both voice
 * features. Speech grade Opus is roughly two kilobytes a second, so this is a
 * long way past the sixty seconds velista 0039 lets somebody record.
 *
 * Enforced twice, at the multipart interceptor and again in core, for plan 0041
 * section 5's reason: a cap that is not on the interceptor is not a cap.
 */
export const VOICE_COMMENT_MAX_BYTES = 2 * 1024 * 1024;

/** Normalises a content type for the allowlist check: lowercase, no parameters. */
export function baseContentType(value: string): string {
  return (value.split(';')[0] ?? '').trim().toLowerCase();
}

export type ListPage = Paginated<ListView>;
export type LinePage = Paginated<LineView>;
export type CommentPage = Paginated<CommentView>;

/** Orders a caller may choose for lists and lines (plan 0007, section 3). */
export const LIST_ORDERS = ['name', 'created', 'updated'] as const;
export type ListOrder = (typeof LIST_ORDERS)[number];

export const LINE_ORDERS = ['position', 'created', 'updated'] as const;
export type LineOrder = (typeof LINE_ORDERS)[number];
