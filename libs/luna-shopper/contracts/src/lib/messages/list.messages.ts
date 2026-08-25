import type {
  LineApprovalStatus,
  LineStatus,
  ListRole,
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
} as const;

export interface ListView {
  id: string;
  zoneId: string;
  name: string;
  createdByUserId: string;
}

export interface ListAccessEntry {
  membershipId: string;
  role: ListRole;
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
}

export interface CommentView {
  id: string;
  lineId: string;
  authorUserId: string;
  body: string;
  createdAt: string;
}

export interface CreateListRequest {
  userId: string;
  zoneId: string;
  name: string;
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

export type ListPage = Paginated<ListView>;
export type LinePage = Paginated<LineView>;
export type CommentPage = Paginated<CommentView>;

/** Orders a caller may choose for lists and lines (plan 0007, section 3). */
export const LIST_ORDERS = ['name', 'created', 'updated'] as const;
export type ListOrder = (typeof LIST_ORDERS)[number];

export const LINE_ORDERS = ['position', 'created', 'updated'] as const;
export type LineOrder = (typeof LINE_ORDERS)[number];
