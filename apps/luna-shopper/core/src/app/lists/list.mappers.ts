import type {
  CommentView,
  LineView,
  ListView,
} from '@portfolio/luna-shopper/contracts';
import type { LineComment, ListLine, ShoppingList } from '../entities';

export function toListView(list: ShoppingList): ListView {
  return {
    id: list.id,
    zoneId: list.zoneId,
    name: list.name,
    createdByUserId: list.createdByUserId,
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
