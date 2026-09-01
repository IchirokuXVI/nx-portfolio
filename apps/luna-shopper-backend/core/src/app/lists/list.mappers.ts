import {
  ListPermission,
  type CommentView,
  type LineSettlementView,
  type LineView,
  type ListCounts,
  type ListView,
} from '@portfolio/luna-shopper/contracts';
import type {
  LineComment,
  LineSettlement,
  ListLine,
  ShoppingList,
} from '../entities';

/** A list with no lines yet, which is every list at the moment it is created. */
export const EMPTY_LIST_COUNTS: ListCounts = { lineCount: 0, wantedCount: 0 };

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
    sharedWithZone: list.sharedWithZone,
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

/**
 * A line on the wire.
 *
 * The product set arrives as a **parameter** rather than through a loaded
 * relation (plan 0048, section 1.1). A relation would default to undefined
 * wherever it had not been joined, and this mapper would then quietly report a
 * line with two products as a free text line: a wrong answer that looks like a
 * right one. An argument the compiler insists on means every caller has to say
 * what the set is, and there is exactly one service that calls this.
 */
export function toLineView(
  line: ListLine,
  itemIds: readonly string[]
): LineView {
  return {
    id: line.id,
    listId: line.listId,
    content: line.content,
    quantity: line.quantity,
    itemIds: [...itemIds],
    itemSetHash: line.itemSetHash,
    position: line.position,
    approvalStatus: line.approvalStatus,
    createdByUserId: line.createdByUserId,
    approvedByUserId: line.approvedByUserId,
    version: line.version,
    createdAt: line.createdAt.toISOString(),
    updatedAt: line.updatedAt.toISOString(),
  };
}

/**
 * A settlement on the wire (plan 0047, section 3).
 *
 * Three stored columns do not appear, and their absence is the point.
 * `generatedListLineId` is the basket the purchase came out of, which is private
 * where the purchase itself is a zone fact (section 3.1); `pricePaidCents` and
 * `supermarketLocationId` are declared for backlog 0004 and written by nothing
 * yet, so serving them would promise a number this plan never fills in.
 */
export function toLineSettlementView(
  settlement: LineSettlement
): LineSettlementView {
  return {
    id: settlement.id,
    lineId: settlement.lineId,
    listId: settlement.listId,
    itemId: settlement.itemId,
    outcome: settlement.outcome,
    quantity: settlement.quantity,
    settledByUserId: settlement.settledByUserId,
    settledAt: settlement.settledAt.toISOString(),
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
