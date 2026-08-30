import {
  ListPermission,
  type CommentView,
  type LineView,
  type ListCounts,
  type ListView,
} from '@portfolio/luna-shopper/contracts';
import type { LineComment, ListLine, ShoppingList } from '../entities';

/** A list with no lines yet, which is every list at the moment it is created. */
export const EMPTY_LIST_COUNTS: ListCounts = { lineCount: 0, readyCount: 0 };

/**
 * Maps a list entity to the client view. The counts are passed in rather than
 * looked up here: they ride the query that fetched the list (plan 0017, section
 * 4.2), so a mapper that fetched them itself would reintroduce the per row round
 * trip the whole design avoids.
 *
 * `myPermissions` arrives the same way and for the same reason (plan 0036,
 * section 7). It is per caller data, so a mapper that resolved it itself would be
 * one membership lookup and one `list_access` lookup **per row of a page**, which
 * is the exact N+1 the counts were designed out of. Every caller already knows
 * the answer: the single list paths resolved it to authorize the request at all,
 * and `ListService.list` resolves the caller's membership once for the whole page
 * and fetches its rows for the page's ids in one more query.
 *
 * Sorted into the enum's own order rather than whatever a `Set` or a Postgres
 * array happened to yield, so two responses describing the same access compare
 * equal and a client diffing them sees no change where there was none.
 */
export function toListView(
  list: ShoppingList,
  counts: ListCounts,
  myPermissions: ReadonlySet<ListPermission>
): ListView {
  return {
    id: list.id,
    zoneId: list.zoneId,
    name: list.name,
    createdByUserId: list.createdByUserId,
    counts,
    autoApproveLines: list.autoApproveLines,
    myPermissions: PERMISSION_ORDER.filter((p) => myPermissions.has(p)),
    createdAt: list.createdAt.toISOString(),
    updatedAt: list.updatedAt.toISOString(),
  };
}

/** The canonical order `myPermissions` is reported in. Weakest to strongest. */
const PERMISSION_ORDER: readonly ListPermission[] = [
  ListPermission.READ,
  ListPermission.WRITE,
  ListPermission.DECIDE,
  ListPermission.MANAGE,
];

export function toLineView(line: ListLine): LineView {
  return {
    id: line.id,
    listId: line.listId,
    content: line.content,
    quantity: line.quantity,
    itemId: line.itemId,
    position: line.position,
    approvalStatus: line.approvalStatus,
    status: line.status,
    createdByUserId: line.createdByUserId,
    approvedByUserId: line.approvedByUserId,
    version: line.version,
    createdAt: line.createdAt.toISOString(),
    updatedAt: line.updatedAt.toISOString(),
  };
}

/**
 * A comment on the wire.
 *
 * `recording` is built from the comment's own columns and never from
 * `comment_audio`, which is the whole reason those columns exist: a listing draws
 * a player, a length and a transcription state without the bytes ever entering the
 * query (plan 0045, section 2).
 *
 * `audioContentType` is the single test for "this is a voice comment". A typed
 * comment answers null for both `recording` and `transcription`, which is what
 * tells a client there is nothing to play and no transcript to wait for.
 */
export function toCommentView(comment: LineComment): CommentView {
  return {
    id: comment.id,
    lineId: comment.lineId,
    authorUserId: comment.authorUserId,
    body: comment.body,
    recording:
      comment.audioContentType === null
        ? null
        : {
            contentType: comment.audioContentType,
            byteLength: comment.audioByteLength ?? 0,
            durationSeconds: comment.audioDurationSeconds ?? null,
          },
    transcription: comment.transcription,
    createdAt: comment.createdAt.toISOString(),
  };
}
