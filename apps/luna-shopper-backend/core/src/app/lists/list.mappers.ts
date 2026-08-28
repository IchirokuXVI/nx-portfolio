import type {
  CommentView,
  LineView,
  ListCounts,
  ListView,
} from '@portfolio/luna-shopper/contracts';
import type { LineComment, ListLine, ShoppingList } from '../entities';

/** A list with no lines yet, which is every list at the moment it is created. */
export const EMPTY_LIST_COUNTS: ListCounts = { lineCount: 0, readyCount: 0 };

/**
 * Maps a list entity to the client view. The counts are passed in rather than
 * looked up here: they ride the query that fetched the list (plan 0017, section
 * 4.2), so a mapper that fetched them itself would reintroduce the per row round
 * trip the whole design avoids.
 */
export function toListView(list: ShoppingList, counts: ListCounts): ListView {
  return {
    id: list.id,
    zoneId: list.zoneId,
    name: list.name,
    createdByUserId: list.createdByUserId,
    counts,
    createdAt: list.createdAt.toISOString(),
    updatedAt: list.updatedAt.toISOString(),
  };
}

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

export function toCommentView(comment: LineComment): CommentView {
  return {
    id: comment.id,
    lineId: comment.lineId,
    authorUserId: comment.authorUserId,
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
  };
}
