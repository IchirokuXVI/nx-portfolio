import {
  COMMENT_PATTERNS,
  LINE_BATCH_MAX_ITEMS,
  LINE_ITEM_SET_MAX,
  LINE_PATTERNS,
  LINE_QUANTITY_MAX,
  LINE_QUANTITY_MIN,
  LIST_PATTERNS,
} from '../../lib/messages/list.messages';
import {
  array,
  boolean,
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
  listAccessView: schemaId('list/ListAccessView'),
  lineView: schemaId('list/LineView'),
  lineViewList: schemaId('list/LineViewList'),
  lineSettlementView: schemaId('list/LineSettlementView'),
  lineSettlementResult: schemaId('list/LineSettlementResult'),
  lineSettlementPage: schemaId('list/LineSettlementPage'),
  commentView: schemaId('list/CommentView'),
  commentRecording: schemaId('list/CommentRecording'),
  commentAudioView: schemaId('list/CommentAudioView'),
  listPage: schemaId('list/ListPage'),
  linePage: schemaId('list/LinePage'),
  commentPage: schemaId('list/CommentPage'),
  createListRequest: schemaId('msg/list.create/request'),
  setAccessRequest: schemaId('msg/list.setAccess/request'),
  getAccessRequest: schemaId('msg/list.getAccess/request'),
  updateListRequest: schemaId('msg/list.update/request'),
  listIdRequest: schemaId('msg/list.listId/request'),
  listListsRequest: schemaId('msg/list.list/request'),
  addLineRequest: schemaId('msg/line.add/request'),
  addLinesItem: schemaId('list/AddLinesItem'),
  addLinesRequest: schemaId('msg/line.addMany/request'),
  addLineQuantityRequest: schemaId('msg/line.addQuantity/request'),
  updateLineRequest: schemaId('msg/line.update/request'),
  setApprovalRequest: schemaId('msg/line.setApproval/request'),
  settleLineRequest: schemaId('msg/line.settle/request'),
  lineSettlementsRequest: schemaId('msg/line.settlements/request'),
  itemSettlementsRequest: schemaId('msg/line.itemSettlements/request'),
  reorderRequest: schemaId('msg/line.reorder/request'),
  deleteLineRequest: schemaId('msg/line.delete/request'),
  listLinesRequest: schemaId('msg/line.list/request'),
  addCommentRequest: schemaId('msg/comment.add/request'),
  listCommentsRequest: schemaId('msg/comment.list/request'),
  addVoiceCommentRequest: schemaId('msg/comment.addVoice/request'),
  getCommentAudioRequest: schemaId('msg/comment.getAudio/request'),
  setCommentTranscriptionRequest: schemaId(
    'msg/comment.setTranscription/request'
  ),
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
    wantedCount: integer({ minimum: 0 }),
  },
  ['lineCount', 'wantedCount']
);

const listView = object(
  LIST_SCHEMA_IDS.listView,
  {
    id: nonEmptyString(),
    zoneId: nonEmptyString(),
    name: nonEmptyString(),
    createdByUserId: nonEmptyString(),
    counts: ref(LIST_SCHEMA_IDS.listCounts),
    autoApproveLines: boolean(),
    sharedWithZone: boolean(),
    myPermissions: array(ref(ENUM_IDS.listPermission)),
    ...timestamps,
  },
  [
    'id',
    'zoneId',
    'name',
    'createdByUserId',
    'counts',
    'autoApproveLines',
    'sharedWithZone',
    'myPermissions',
    ...timestampKeys,
  ]
);

// An empty `permissions` is no access, which `setAccess` stores as a deleted row
// (plan 0036, section 2.2). So the array is allowed to be empty on the way in and
// never comes back out of `getAccess` that way.
const listAccessEntry = object(
  LIST_SCHEMA_IDS.listAccessEntry,
  {
    membershipId: nonEmptyString(),
    permissions: array(ref(ENUM_IDS.listPermission)),
  },
  ['membershipId', 'permissions']
);

const listAccessView = object(
  LIST_SCHEMA_IDS.listAccessView,
  {
    listId: nonEmptyString(),
    entries: array(ref(LIST_SCHEMA_IDS.listAccessEntry)),
  },
  ['listId', 'entries']
);

const lineView = object(
  LIST_SCHEMA_IDS.lineView,
  {
    id: nonEmptyString(),
    listId: nonEmptyString(),
    content: string(),
    quantity: integer(),
    // The product set and its digest (plan 0048, section 1.1). Both required and
    // both honest when empty: `[]` and `null` say "this is a free text line".
    itemIds: array(nonEmptyString()),
    itemSetHash: nullableString(),
    position: integer(),
    approvalStatus: ref(ENUM_IDS.lineApprovalStatus),
    createdByUserId: nonEmptyString(),
    approvedByUserId: nullableString(),
    version: integer(),
    // The two derived indicators (plan 0047, section 5). Both required, because a
    // line with no history answers them with 0 and null rather than by leaving
    // them out: an absent field would make "never bought" indistinguishable from
    // "this build of the server does not say".
    boughtCount: integer({ minimum: 0 }),
    lastSettlementOutcome: {
      anyOf: [ref(ENUM_IDS.settlementOutcome), { type: 'null' }],
    },
    ...timestamps,
  },
  [
    'id',
    'listId',
    'content',
    'quantity',
    'itemIds',
    'itemSetHash',
    'position',
    'approvalStatus',
    'createdByUserId',
    'approvedByUserId',
    'version',
    'boughtCount',
    'lastSettlementOutcome',
    ...timestampKeys,
  ]
);

// One origin line touched by one settling act (plan 0047, section 3).
// `generatedListLineId` is deliberately absent: it is stored and never served, so
// a reader learns that something was bought and not which basket it came out of
// (section 3.1).
const lineSettlementView = object(
  LIST_SCHEMA_IDS.lineSettlementView,
  {
    id: nonEmptyString(),
    lineId: nonEmptyString(),
    listId: nonEmptyString(),
    itemId: nullableString(),
    outcome: ref(ENUM_IDS.settlementOutcome),
    // Zero for `NOT_AVAILABLE`, and unbounded above by the line's own demand:
    // buying more than was asked for is recorded as it happened (section 4.2).
    quantity: integer({ minimum: 0 }),
    settledByUserId: nonEmptyString(),
    settledAt: string({ format: 'date-time' }),
  },
  [
    'id',
    'lineId',
    'listId',
    'itemId',
    'outcome',
    'quantity',
    'settledByUserId',
    'settledAt',
  ]
);

// Both halves of what a settle did, because neither is derivable from the other
// (plan 0047, section 8). It answers the write and it is the `line.settled`
// payload, so a client applies one shape from either direction.
const lineSettlementResult = object(
  LIST_SCHEMA_IDS.lineSettlementResult,
  {
    line: ref(LIST_SCHEMA_IDS.lineView),
    settlement: ref(LIST_SCHEMA_IDS.lineSettlementView),
  },
  ['line', 'settlement']
);

const commentRecording = object(
  LIST_SCHEMA_IDS.commentRecording,
  {
    contentType: nonEmptyString(),
    byteLength: integer({ minimum: 1 }),
    // Nullable rather than absent: the client may genuinely not know, and a
    // number here is metadata the server never trusts (plan 0045, section 6).
    durationSeconds: { type: ['number', 'null'] },
  },
  ['contentType', 'byteLength', 'durationSeconds']
);

// `body` is `string` and not `nonEmptyString`, which is the schema change plan
// 0045 section 8 asks for: a comment whose transcription failed carries no body
// and is still a valid comment. `recording` and `transcription` are both null for
// a typed comment, so the two are either both set or both absent in practice
// without the schema having to say so.
const commentView = object(
  LIST_SCHEMA_IDS.commentView,
  {
    id: nonEmptyString(),
    lineId: nonEmptyString(),
    authorUserId: nonEmptyString(),
    body: string(),
    recording: {
      oneOf: [ref(LIST_SCHEMA_IDS.commentRecording), { type: 'null' }],
    },
    transcription: {
      oneOf: [ref(ENUM_IDS.commentTranscription), { type: 'null' }],
    },
    createdAt: string({ format: 'date-time' }),
  },
  [
    'id',
    'lineId',
    'authorUserId',
    'body',
    'recording',
    'transcription',
    'createdAt',
  ]
);

const commentAudioView = object(
  LIST_SCHEMA_IDS.commentAudioView,
  {
    commentId: nonEmptyString(),
    contentType: nonEmptyString(),
    audio: nonEmptyString(),
  },
  ['commentId', 'contentType', 'audio']
);

/**
 * The batch add's answer: the created lines in request order (plan 0040, 6.1).
 *
 * A bare array rather than a page, because it is neither paginated nor open
 * ended: it is exactly as long as the request was, and `reorder` set the
 * precedent that a batch write on this resource answers in a shape every client
 * already knows how to read.
 */
const lineViewList: JsonSchema = {
  $id: LIST_SCHEMA_IDS.lineViewList,
  type: 'array',
  items: ref(LIST_SCHEMA_IDS.lineView),
};

const listPage = paginated(LIST_SCHEMA_IDS.listPage, LIST_SCHEMA_IDS.listView);
const lineSettlementPage = paginated(
  LIST_SCHEMA_IDS.lineSettlementPage,
  LIST_SCHEMA_IDS.lineSettlementView
);
const linePage = paginated(LIST_SCHEMA_IDS.linePage, LIST_SCHEMA_IDS.lineView);
const commentPage = paginated(
  LIST_SCHEMA_IDS.commentPage,
  LIST_SCHEMA_IDS.commentView
);

const createListRequest = object(
  LIST_SCHEMA_IDS.createListRequest,
  {
    userId: nonEmptyString(),
    zoneId: nonEmptyString(),
    name: nonEmptyString(),
  },
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
const getAccessRequest = object(
  LIST_SCHEMA_IDS.getAccessRequest,
  { userId: nonEmptyString(), listId: nonEmptyString() },
  ['userId', 'listId']
);
const updateListRequest = object(
  LIST_SCHEMA_IDS.updateListRequest,
  {
    userId: nonEmptyString(),
    listId: nonEmptyString(),
    name: string(),
    autoApproveLines: boolean(),
    sharedWithZone: boolean(),
  },
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
    quantity: integer({
      minimum: LINE_QUANTITY_MIN,
      maximum: LINE_QUANTITY_MAX,
    }),
    // The line's product set (plan 0048, section 1.1). Absent or empty is a free
    // text line, which is deliberately still the ordinary case.
    itemIds: { ...array(nonEmptyString()), maxItems: LINE_ITEM_SET_MAX },
  },
  ['userId', 'listId', 'content']
);
const addLinesItem = object(
  LIST_SCHEMA_IDS.addLinesItem,
  {
    content: nonEmptyString(),
    quantity: integer({
      minimum: LINE_QUANTITY_MIN,
      maximum: LINE_QUANTITY_MAX,
    }),
    itemIds: { ...array(nonEmptyString()), maxItems: LINE_ITEM_SET_MAX },
  },
  ['content']
);
const addLinesRequest = object(
  LIST_SCHEMA_IDS.addLinesRequest,
  {
    userId: nonEmptyString(),
    listId: nonEmptyString(),
    items: {
      ...array(ref(LIST_SCHEMA_IDS.addLinesItem)),
      minItems: 1,
      maxItems: LINE_BATCH_MAX_ITEMS,
    },
  },
  ['userId', 'listId', 'items']
);
const addLineQuantityRequest = object(
  LIST_SCHEMA_IDS.addLineQuantityRequest,
  {
    userId: nonEmptyString(),
    lineId: nonEmptyString(),
    // Signed, and bounded in both directions so neither can be used to write a
    // number nobody meant. Zero is refused in the DTO rather than here: JSON
    // Schema states "not zero" only as a `not`, which reads far worse than the
    // one decorator that says it (plan 0040, section 3.7).
    delta: integer({ minimum: -LINE_QUANTITY_MAX, maximum: LINE_QUANTITY_MAX }),
  },
  ['userId', 'lineId', 'delta']
);
const updateLineRequest = object(
  LIST_SCHEMA_IDS.updateLineRequest,
  {
    userId: nonEmptyString(),
    lineId: nonEmptyString(),
    content: string(),
    quantity: integer({
      minimum: LINE_QUANTITY_MIN,
      maximum: LINE_QUANTITY_MAX,
    }),
    // Replace the line's product set (plan 0048, section 1.1); `[]` clears it.
    itemIds: { ...array(nonEmptyString()), maxItems: LINE_ITEM_SET_MAX },
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
// `quantity` is optional here and conditional in the service: required for
// `BOUGHT`, refused for `NOT_AVAILABLE`. A JSON Schema `if`/`then` pair could say
// it, and it would say it to nobody: the refusal a caller reads comes from the
// DTO and from core, and a third statement of the rule is a third place for it to
// drift (plan 0047, section 4).
const settleLineRequest = object(
  LIST_SCHEMA_IDS.settleLineRequest,
  {
    userId: nonEmptyString(),
    lineId: nonEmptyString(),
    outcome: ref(ENUM_IDS.settlementOutcome),
    quantity: integer({ minimum: 1, maximum: LINE_QUANTITY_MAX }),
    itemId: nonEmptyString(),
  },
  ['userId', 'lineId', 'outcome']
);
const lineSettlementsRequest = object(
  LIST_SCHEMA_IDS.lineSettlementsRequest,
  {
    userId: nonEmptyString(),
    lineId: nonEmptyString(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
  },
  ['userId', 'lineId']
);
const itemSettlementsRequest = object(
  LIST_SCHEMA_IDS.itemSettlementsRequest,
  {
    userId: nonEmptyString(),
    itemId: nonEmptyString(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
  },
  ['userId', 'itemId']
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
  {
    userId: nonEmptyString(),
    lineId: nonEmptyString(),
    body: nonEmptyString(),
  },
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

// No `body`: the transcript arrives later, through `comment.setTranscription`,
// and a comment with no body is a valid comment in the meantime (plan 0045,
// section 4).
const addVoiceCommentRequest = object(
  LIST_SCHEMA_IDS.addVoiceCommentRequest,
  {
    userId: nonEmptyString(),
    lineId: nonEmptyString(),
    audio: nonEmptyString(),
    contentType: nonEmptyString(),
    durationSeconds: { type: ['number', 'null'] },
  },
  ['userId', 'lineId', 'audio', 'contentType']
);
const getCommentAudioRequest = object(
  LIST_SCHEMA_IDS.getCommentAudioRequest,
  { userId: nonEmptyString(), commentId: nonEmptyString() },
  ['userId', 'commentId']
);
const setCommentTranscriptionRequest = object(
  LIST_SCHEMA_IDS.setCommentTranscriptionRequest,
  {
    userId: nonEmptyString(),
    commentId: nonEmptyString(),
    body: string(),
    transcription: ref(ENUM_IDS.commentTranscription),
  },
  ['userId', 'commentId', 'body', 'transcription']
);

export const listSchemas: JsonSchema[] = [
  listCounts,
  listView,
  listAccessEntry,
  listAccessView,
  lineView,
  lineViewList,
  lineSettlementView,
  lineSettlementResult,
  commentRecording,
  commentView,
  commentAudioView,
  listPage,
  linePage,
  lineSettlementPage,
  commentPage,
  createListRequest,
  setAccessRequest,
  getAccessRequest,
  updateListRequest,
  listIdRequest,
  listListsRequest,
  addLineRequest,
  addLinesItem,
  addLinesRequest,
  addLineQuantityRequest,
  updateLineRequest,
  setApprovalRequest,
  settleLineRequest,
  lineSettlementsRequest,
  itemSettlementsRequest,
  reorderRequest,
  deleteLineRequest,
  listLinesRequest,
  addCommentRequest,
  listCommentsRequest,
  addVoiceCommentRequest,
  getCommentAudioRequest,
  setCommentTranscriptionRequest,
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
  [LIST_PATTERNS.getAccess]: {
    request: LIST_SCHEMA_IDS.getAccessRequest,
    response: LIST_SCHEMA_IDS.listAccessView,
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
  [LINE_PATTERNS.addMany]: {
    request: LIST_SCHEMA_IDS.addLinesRequest,
    response: LIST_SCHEMA_IDS.lineViewList,
  },
  [LINE_PATTERNS.update]: {
    request: LIST_SCHEMA_IDS.updateLineRequest,
    response: LIST_SCHEMA_IDS.lineView,
  },
  [LINE_PATTERNS.addQuantity]: {
    request: LIST_SCHEMA_IDS.addLineQuantityRequest,
    response: LIST_SCHEMA_IDS.lineView,
  },
  [LINE_PATTERNS.setApproval]: {
    request: LIST_SCHEMA_IDS.setApprovalRequest,
    response: LIST_SCHEMA_IDS.lineView,
  },
  [LINE_PATTERNS.settle]: {
    request: LIST_SCHEMA_IDS.settleLineRequest,
    response: LIST_SCHEMA_IDS.lineSettlementResult,
  },
  [LINE_PATTERNS.settlements]: {
    request: LIST_SCHEMA_IDS.lineSettlementsRequest,
    response: LIST_SCHEMA_IDS.lineSettlementPage,
  },
  [LINE_PATTERNS.itemSettlements]: {
    request: LIST_SCHEMA_IDS.itemSettlementsRequest,
    response: LIST_SCHEMA_IDS.lineSettlementPage,
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
  [COMMENT_PATTERNS.addVoice]: {
    request: LIST_SCHEMA_IDS.addVoiceCommentRequest,
    response: LIST_SCHEMA_IDS.commentView,
  },
  [COMMENT_PATTERNS.getAudio]: {
    request: LIST_SCHEMA_IDS.getCommentAudioRequest,
    response: LIST_SCHEMA_IDS.commentAudioView,
  },
  [COMMENT_PATTERNS.setTranscription]: {
    request: LIST_SCHEMA_IDS.setCommentTranscriptionRequest,
    response: LIST_SCHEMA_IDS.commentView,
  },
};
