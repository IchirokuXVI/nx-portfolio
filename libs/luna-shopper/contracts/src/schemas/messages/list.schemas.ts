import {
  COMMENT_PATTERNS,
  LINE_PATTERNS,
  LIST_PATTERNS,
} from '../../lib/messages/list.messages';
import {
  array,
  integer,
  JsonSchema,
  nonEmptyString,
  nullableString,
  object,
  paginated,
  ref,
  schemaId,
  string,
} from '../builders';
import { COMMON_IDS } from '../common.schemas';
import { ENUM_IDS } from '../enums.schemas';

export const LIST_SCHEMA_IDS = {
  listView: schemaId('list/ListView'),
  listCounts: schemaId('list/ListCounts'),
  listAccessEntry: schemaId('list/ListAccessEntry'),
  lineView: schemaId('list/LineView'),
  commentView: schemaId('list/CommentView'),
  listPage: schemaId('list/ListPage'),
  linePage: schemaId('list/LinePage'),
  commentPage: schemaId('list/CommentPage'),
  createListRequest: schemaId('msg/list.create/request'),
  setAccessRequest: schemaId('msg/list.setAccess/request'),
  updateListRequest: schemaId('msg/list.update/request'),
  listIdRequest: schemaId('msg/list.listId/request'),
  listListsRequest: schemaId('msg/list.list/request'),
  addLineRequest: schemaId('msg/line.add/request'),
  updateLineRequest: schemaId('msg/line.update/request'),
  setApprovalRequest: schemaId('msg/line.setApproval/request'),
  setStatusRequest: schemaId('msg/line.setStatus/request'),
  reorderRequest: schemaId('msg/line.reorder/request'),
  deleteLineRequest: schemaId('msg/line.delete/request'),
  listLinesRequest: schemaId('msg/line.list/request'),
  addCommentRequest: schemaId('msg/comment.add/request'),
  listCommentsRequest: schemaId('msg/comment.list/request'),
} as const;

/** Timestamps on every read model (plan 0017, section 7). */
const timestamps = {
  createdAt: string({ format: 'date-time' }),
  updatedAt: string({ format: 'date-time' }),
};
const timestampKeys = ['createdAt', 'updatedAt'];

const listCounts = object(
  LIST_SCHEMA_IDS.listCounts,
  {
    lineCount: integer({ minimum: 0 }),
    readyCount: integer({ minimum: 0 }),
  },
  ['lineCount', 'readyCount']
);

const listView = object(
  LIST_SCHEMA_IDS.listView,
  {
    id: nonEmptyString(),
    zoneId: nonEmptyString(),
    name: nonEmptyString(),
    createdByUserId: nonEmptyString(),
    counts: ref(LIST_SCHEMA_IDS.listCounts),
    ...timestamps,
  },
  ['id', 'zoneId', 'name', 'createdByUserId', 'counts', ...timestampKeys]
);

const listAccessEntry = object(
  LIST_SCHEMA_IDS.listAccessEntry,
  { membershipId: nonEmptyString(), role: ref(ENUM_IDS.listRole) },
  ['membershipId', 'role']
);

const lineView = object(
  LIST_SCHEMA_IDS.lineView,
  {
    id: nonEmptyString(),
    listId: nonEmptyString(),
    content: string(),
    quantity: integer(),
    itemId: nullableString(),
    position: integer(),
    approvalStatus: ref(ENUM_IDS.lineApprovalStatus),
    status: ref(ENUM_IDS.lineStatus),
    createdByUserId: nonEmptyString(),
    approvedByUserId: nullableString(),
    version: integer(),
    ...timestamps,
  },
  [
    'id',
    'listId',
    'content',
    'quantity',
    'itemId',
    'position',
    'approvalStatus',
    'status',
    'createdByUserId',
    'approvedByUserId',
    'version',
    ...timestampKeys,
  ]
);

const commentView = object(
  LIST_SCHEMA_IDS.commentView,
  {
    id: nonEmptyString(),
    lineId: nonEmptyString(),
    authorUserId: nonEmptyString(),
    body: string(),
    createdAt: string({ format: 'date-time' }),
  },
  ['id', 'lineId', 'authorUserId', 'body', 'createdAt']
);

const listPage = paginated(LIST_SCHEMA_IDS.listPage, LIST_SCHEMA_IDS.listView);
const linePage = paginated(LIST_SCHEMA_IDS.linePage, LIST_SCHEMA_IDS.lineView);
const commentPage = paginated(
  LIST_SCHEMA_IDS.commentPage,
  LIST_SCHEMA_IDS.commentView
);

const createListRequest = object(
  LIST_SCHEMA_IDS.createListRequest,
  { userId: nonEmptyString(), zoneId: nonEmptyString(), name: nonEmptyString() },
  ['userId', 'zoneId', 'name']
);
const setAccessRequest = object(
  LIST_SCHEMA_IDS.setAccessRequest,
  {
    userId: nonEmptyString(),
    listId: nonEmptyString(),
    entries: array(ref(LIST_SCHEMA_IDS.listAccessEntry)),
  },
  ['userId', 'listId', 'entries']
);
const updateListRequest = object(
  LIST_SCHEMA_IDS.updateListRequest,
  { userId: nonEmptyString(), listId: nonEmptyString(), name: string() },
  ['userId', 'listId']
);
const listIdRequest = object(
  LIST_SCHEMA_IDS.listIdRequest,
  { userId: nonEmptyString(), listId: nonEmptyString() },
  ['userId', 'listId']
);
const listListsRequest = object(
  LIST_SCHEMA_IDS.listListsRequest,
  {
    userId: nonEmptyString(),
    zoneId: nonEmptyString(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId', 'zoneId']
);
const addLineRequest = object(
  LIST_SCHEMA_IDS.addLineRequest,
  {
    userId: nonEmptyString(),
    listId: nonEmptyString(),
    content: string(),
    quantity: integer({ minimum: 1 }),
    // Optional opaque catalog Item reference (plan 0012); null or absent = none.
    itemId: nullableString(),
  },
  ['userId', 'listId', 'content']
);
const updateLineRequest = object(
  LIST_SCHEMA_IDS.updateLineRequest,
  {
    userId: nonEmptyString(),
    lineId: nonEmptyString(),
    content: string(),
    quantity: integer({ minimum: 1 }),
    // Set or clear the catalog Item reference (plan 0012); null clears it.
    itemId: nullableString(),
  },
  ['userId', 'lineId']
);
const setApprovalRequest = object(
  LIST_SCHEMA_IDS.setApprovalRequest,
  {
    userId: nonEmptyString(),
    lineId: nonEmptyString(),
    approvalStatus: ref(ENUM_IDS.lineApprovalStatus),
  },
  ['userId', 'lineId', 'approvalStatus']
);
const setStatusRequest = object(
  LIST_SCHEMA_IDS.setStatusRequest,
  {
    userId: nonEmptyString(),
    lineId: nonEmptyString(),
    status: ref(ENUM_IDS.lineStatus),
  },
  ['userId', 'lineId', 'status']
);
const reorderRequest = object(
  LIST_SCHEMA_IDS.reorderRequest,
  {
    userId: nonEmptyString(),
    listId: nonEmptyString(),
    orderedLineIds: array(nonEmptyString()),
  },
  ['userId', 'listId', 'orderedLineIds']
);
const deleteLineRequest = object(
  LIST_SCHEMA_IDS.deleteLineRequest,
  { userId: nonEmptyString(), lineId: nonEmptyString() },
  ['userId', 'lineId']
);
const listLinesRequest = object(
  LIST_SCHEMA_IDS.listLinesRequest,
  {
    userId: nonEmptyString(),
    listId: nonEmptyString(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId', 'listId']
);
const addCommentRequest = object(
  LIST_SCHEMA_IDS.addCommentRequest,
  { userId: nonEmptyString(), lineId: nonEmptyString(), body: nonEmptyString() },
  ['userId', 'lineId', 'body']
);
const listCommentsRequest = object(
  LIST_SCHEMA_IDS.listCommentsRequest,
  {
    userId: nonEmptyString(),
    lineId: nonEmptyString(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId', 'lineId']
);

export const listSchemas: JsonSchema[] = [
  listCounts,
  listView,
  listAccessEntry,
  lineView,
  commentView,
  listPage,
  linePage,
  commentPage,
  createListRequest,
  setAccessRequest,
  updateListRequest,
  listIdRequest,
  listListsRequest,
  addLineRequest,
  updateLineRequest,
  setApprovalRequest,
  setStatusRequest,
  reorderRequest,
  deleteLineRequest,
  listLinesRequest,
  addCommentRequest,
  listCommentsRequest,
];

export const listMessageContracts: Record<
  string,
  { request: string; response: string }
> = {
  [LIST_PATTERNS.create]: {
    request: LIST_SCHEMA_IDS.createListRequest,
    response: LIST_SCHEMA_IDS.listView,
  },
  [LIST_PATTERNS.setAccess]: {
    request: LIST_SCHEMA_IDS.setAccessRequest,
    response: COMMON_IDS.listIdResult,
  },
  [LIST_PATTERNS.update]: {
    request: LIST_SCHEMA_IDS.updateListRequest,
    response: LIST_SCHEMA_IDS.listView,
  },
  [LIST_PATTERNS.delete]: {
    request: LIST_SCHEMA_IDS.listIdRequest,
    response: COMMON_IDS.idResult,
  },
  [LIST_PATTERNS.list]: {
    request: LIST_SCHEMA_IDS.listListsRequest,
    response: LIST_SCHEMA_IDS.listPage,
  },
  [LINE_PATTERNS.add]: {
    request: LIST_SCHEMA_IDS.addLineRequest,
    response: LIST_SCHEMA_IDS.lineView,
  },
  [LINE_PATTERNS.update]: {
    request: LIST_SCHEMA_IDS.updateLineRequest,
    response: LIST_SCHEMA_IDS.lineView,
  },
  [LINE_PATTERNS.setApproval]: {
    request: LIST_SCHEMA_IDS.setApprovalRequest,
    response: LIST_SCHEMA_IDS.lineView,
  },
  [LINE_PATTERNS.setStatus]: {
    request: LIST_SCHEMA_IDS.setStatusRequest,
    response: LIST_SCHEMA_IDS.lineView,
  },
  [LINE_PATTERNS.reorder]: {
    request: LIST_SCHEMA_IDS.reorderRequest,
    response: COMMON_IDS.listIdResult,
  },
  [LINE_PATTERNS.delete]: {
    request: LIST_SCHEMA_IDS.deleteLineRequest,
    response: COMMON_IDS.idResult,
  },
  [LINE_PATTERNS.list]: {
    request: LIST_SCHEMA_IDS.listLinesRequest,
    response: LIST_SCHEMA_IDS.linePage,
  },
  [COMMENT_PATTERNS.add]: {
    request: LIST_SCHEMA_IDS.addCommentRequest,
    response: LIST_SCHEMA_IDS.commentView,
  },
  [COMMENT_PATTERNS.list]: {
    request: LIST_SCHEMA_IDS.listCommentsRequest,
    response: LIST_SCHEMA_IDS.commentPage,
  },
};
