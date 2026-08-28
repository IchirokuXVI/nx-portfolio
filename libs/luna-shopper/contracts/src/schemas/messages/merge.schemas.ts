import { MERGE_PATTERNS } from '../../lib/messages/merge.messages';
import {
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
import { ENUM_IDS } from '../enums.schemas';

export const MERGE_SCHEMA_IDS = {
  mergeRequestView: schemaId('merge/MergeRequestView'),
  mergeRequestPage: schemaId('merge/MergeRequestPage'),
  requestMergeRequest: schemaId('msg/merge.request/request'),
  mergeIdRequest: schemaId('msg/merge.mergeId/request'),
  listMergeRequestsRequest: schemaId('msg/merge.list/request'),
} as const;

const mergeRequestView = object(
  MERGE_SCHEMA_IDS.mergeRequestView,
  {
    id: nonEmptyString(),
    zoneId: nonEmptyString(),
    sourceUserId: nonEmptyString(),
    targetUserId: nonEmptyString(),
    requestedByUserId: nonEmptyString(),
    status: ref(ENUM_IDS.mergeRequestStatus),
    resolvedByUserId: nullableString(),
  },
  [
    'id',
    'zoneId',
    'sourceUserId',
    'targetUserId',
    'requestedByUserId',
    'status',
    'resolvedByUserId',
  ]
);

const mergeRequestPage = paginated(
  MERGE_SCHEMA_IDS.mergeRequestPage,
  MERGE_SCHEMA_IDS.mergeRequestView
);

const requestMergeRequest = object(
  MERGE_SCHEMA_IDS.requestMergeRequest,
  {
    userId: nonEmptyString(),
    zoneId: nonEmptyString(),
    sourceUserId: nonEmptyString(),
    targetUserId: nonEmptyString(),
  },
  ['userId', 'zoneId', 'sourceUserId', 'targetUserId']
);

const mergeIdRequest = object(
  MERGE_SCHEMA_IDS.mergeIdRequest,
  { userId: nonEmptyString(), mergeId: nonEmptyString() },
  ['userId', 'mergeId']
);

const listMergeRequestsRequest = object(
  MERGE_SCHEMA_IDS.listMergeRequestsRequest,
  {
    userId: nonEmptyString(),
    zoneId: nonEmptyString(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId', 'zoneId']
);

export const mergeSchemas: JsonSchema[] = [
  mergeRequestView,
  mergeRequestPage,
  requestMergeRequest,
  mergeIdRequest,
  listMergeRequestsRequest,
];

export const mergeMessageContracts: Record<
  string,
  { request: string; response: string }
> = {
  [MERGE_PATTERNS.request]: {
    request: MERGE_SCHEMA_IDS.requestMergeRequest,
    response: MERGE_SCHEMA_IDS.mergeRequestView,
  },
  [MERGE_PATTERNS.approve]: {
    request: MERGE_SCHEMA_IDS.mergeIdRequest,
    response: MERGE_SCHEMA_IDS.mergeRequestView,
  },
  [MERGE_PATTERNS.reject]: {
    request: MERGE_SCHEMA_IDS.mergeIdRequest,
    response: MERGE_SCHEMA_IDS.mergeRequestView,
  },
  [MERGE_PATTERNS.cancel]: {
    request: MERGE_SCHEMA_IDS.mergeIdRequest,
    response: MERGE_SCHEMA_IDS.mergeRequestView,
  },
  [MERGE_PATTERNS.list]: {
    request: MERGE_SCHEMA_IDS.listMergeRequestsRequest,
    response: MERGE_SCHEMA_IDS.mergeRequestPage,
  },
};
