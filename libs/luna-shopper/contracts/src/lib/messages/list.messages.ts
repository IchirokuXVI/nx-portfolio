import type {
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
  addMany: 'line.addMany',
  update: 'line.update',
  addQuantity: 'line.addQuantity',
  setApproval: 'line.setApproval',
  setStatus: 'line.setStatus',
  reorder: 'line.reorder',
  delete: 'line.delete',
  list: 'line.list',
} as const;

/**
 * The bounds a line's quantity has to satisfy, stated once (plan 0040, section
 * 3.5).
 *
 * The ceiling used to live only in the gateway DTO, which was survivable while
 * every write carried an absolute value the gateway had already checked. A delta
 * is computed **inside core**, so core is now the only place that can check the
 * result, and a bound written in two files is a bound that disagrees with itself
 * the first time one of them moves.
 */
export const LINE_QUANTITY_MIN = 1;
export const LINE_QUANTITY_MAX = 100000;

/**
 * How many lines one `line.addMany` may carry (plan 0040, section 6.1).
 *
 * A bound rather than a budget: fifty is well past any spoken sentence and past
 * any plausible paste, and its job is to stop one request writing an unbounded
 * number of rows.
 */
export const LINE_BATCH_MAX_ITEMS = 50;

export const COMMENT_PATTERNS = {
  add: 'comment.add',
  list: 'comment.list',
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

/** One line of a {@link AddLinesRequest} batch (plan 0040, section 6.5). */
export interface AddLinesItem {
  content: string;
  quantity?: number;
  /** The same optional catalog Item reference {@link AddLineRequest} carries. */
  itemId?: string | null;
}

/**
 * Add up to {@link LINE_BATCH_MAX_ITEMS} lines in one transaction (plan 0040,
 * section 6).
 *
 * **All or nothing**, and the response is the created lines in request order.
 * Nothing that can fail for one item can succeed for its neighbour: access is a
 * property of the list and the caller, the approval rules are a property of their
 * permissions and the list's `autoApproveLines`, and the per item bounds have
 * already produced a 400 for the whole request at the gateway. So a per item
 * result envelope would be a new response idiom describing a partial failure the
 * design cannot produce.
 *
 * **It adds, and it does not merge** (section 6.3). Two items naming the same
 * thing produce two lines: merging is a decision about a person's intention, and
 * the caller pasting a list may well have meant two entries. The upsert rule
 * belongs to the assistant, which is where it lives.
 */
export interface AddLinesRequest {
  userId: string;
  listId: string;
  items: AddLinesItem[];
}

export interface UpdateLineRequest {
  userId: string;
  lineId: string;
  content?: string;
  quantity?: number;
  /** Set/clear the optional catalog Item reference (plan 0012). `null` clears it. */
  itemId?: string | null;
}

/**
 * Add units to a line, or take them off, without reading it first (plan 0040,
 * section 3).
 *
 * `delta` is a non zero integer and the **resulting** quantity is what
 * {@link LINE_QUANTITY_MIN} and {@link LINE_QUANTITY_MAX} apply to. It is
 * arithmetic in front of the edit that already exists, so it introduces no new
 * permission, no new transition and no new event: an approved line's quantity
 * still moves only for a caller holding `DECIDE`, adding to a rejected line still
 * returns it to `PENDING`, and a negative delta on an approved line still splits
 * the remainder exactly as an absolute lowering does.
 *
 * A negative delta is allowed on purpose (section 3.3). Refusing one would leave
 * "one less" as the single thing a caller still has to do with a read and a
 * write, which is precisely the lost update this message exists to remove.
 */
export interface AddLineQuantityRequest {
  userId: string;
  lineId: string;
  delta: number;
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
