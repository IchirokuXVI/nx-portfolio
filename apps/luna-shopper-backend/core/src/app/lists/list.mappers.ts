import {
  ListPermission,
  type CommentView,
  type LineClaim,
  type LineSettlementSummary,
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
 *
 * The settlement summary arrives the same way and for the same reasons, plus one
 * of its own: it is what the two indicators in plan 0047 section 5 are drawn
 * from, and a mapper that computed it would be an aggregate **per row of a page**
 * over the largest table in core.
 *
 * It has **no default**, deliberately, and {@link NO_LINE_SETTLEMENTS} is written
 * out at the two call sites where it is the truth. A default of "no settlements"
 * is exactly the wrong shape here: every event carries a whole line and a client
 * reconciles off it, so a call site that forgot to pass one would take the bought
 * indicator off a settled line on every phone in the household, silently, over an
 * unrelated edit. Making the compiler ask is what turns that from a bug nobody
 * would look for into a line somebody has to write.
 *
 * The claim arrives on the same terms and for the same reason (plan 0052,
 * section 4). It is derived from the live baskets carrying the line, so a mapper
 * that resolved it would be a join per row of a page, and an edit that announced
 * an unclaimed line because a call site forgot it would take the indicator off a
 * line somebody is holding in a shop right now.
 */
export function toLineView(
  line: ListLine,
  itemIds: readonly string[],
  settlements: LineSettlementSummary,
  claim: LineClaim
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
    boughtCount: settlements.boughtCount,
    lastSettlementOutcome: settlements.lastOutcome,
    claimed: claim.claimed,
    claimedByUserId: claim.claimedByUserId,
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
