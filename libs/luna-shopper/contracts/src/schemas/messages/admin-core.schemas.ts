import {
  ADMIN_BASKET_PATTERNS,
  ADMIN_LIST_PATTERNS,
  ADMIN_MEMBERSHIP_PATTERNS,
  ADMIN_ZONE_PATTERNS,
} from '../../lib/messages/admin-core.messages';
import {
  array,
  boolean,
  freeObject,
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
import { adminCredentialProperties, COMMON_IDS } from '../common.schemas';
import { ENUM_IDS } from '../enums.schemas';
import { GENERATED_LIST_SCHEMA_IDS } from './generated-list.schemas';
import { ZONE_SCHEMA_IDS } from './zone.schemas';

/**
 * JSON Schemas for the back office's view of core (plan 0074).
 *
 * Every view here is a shape of its own rather than a reference to the user
 * facing one, and that is the design rather than duplication. `ZoneView`,
 * `ListView` and `GeneratedListSummaryView` are all caller relative: they carry
 * what **you** may do, what **your** membership is, which lists **you** may read.
 * An operator has no membership and no permissions in somebody's household, so
 * every one of those fields would have to be filled with a lie or a null. The
 * shapes here answer the operator's question instead, and the redaction of
 * section 4 is visible in what they do not have: no list content on any zone
 * shape, and lines only on the two detail reads.
 *
 * The three action responses are the exception and reference the user facing
 * `MembershipView` and `IdResult` directly, because a kicked member is a kicked
 * member however the kick was ordered.
 */
export const ADMIN_CORE_SCHEMA_IDS = {
  zoneView: schemaId('admin-core/AdminZoneView'),
  zoneMemberView: schemaId('admin-core/AdminZoneMemberView'),
  zoneListView: schemaId('admin-core/AdminZoneListView'),
  zoneDetailView: schemaId('admin-core/AdminZoneDetailView'),
  zonePage: schemaId('admin-core/AdminZonePage'),
  zoneRowView: schemaId('admin-core/AdminZoneRowView'),
  zoneRowPage: schemaId('admin-core/AdminZoneRowPage'),
  listView: schemaId('admin-core/AdminListView'),
  listLineView: schemaId('admin-core/AdminListLineView'),
  listDetailView: schemaId('admin-core/AdminListDetailView'),
  listPage: schemaId('admin-core/AdminListPage'),
  basketView: schemaId('admin-core/AdminBasketView'),
  basketLineView: schemaId('admin-core/AdminBasketLineView'),
  basketDetailView: schemaId('admin-core/AdminBasketDetailView'),
  basketPage: schemaId('admin-core/AdminBasketPage'),
  listZonesRequest: schemaId('msg/adminZone.list/request'),
  zoneIdRequest: schemaId('msg/adminZone.zoneId/request'),
  membershipActionRequest: schemaId('msg/adminZone.membershipAction/request'),
  listListsRequest: schemaId('msg/adminList.list/request'),
  getListRequest: schemaId('msg/adminList.get/request'),
  listBasketsRequest: schemaId('msg/adminBasket.list/request'),
  getBasketRequest: schemaId('msg/adminBasket.get/request'),
} as const;

const timestamps = {
  createdAt: string({ format: 'date-time' }),
  updatedAt: string({ format: 'date-time' }),
};
const timestampKeys = ['createdAt', 'updatedAt'];

const zoneFields = {
  id: nonEmptyString(),
  name: nonEmptyString(),
  status: ref(ENUM_IDS.zoneStatus),
  ownerUserId: nullableString(),
  memberCount: integer({ minimum: 0 }),
  listCount: integer({ minimum: 0 }),
  markedForDeletionAt: nullableString(),
  ...timestamps,
};
const zoneKeys = [
  'id',
  'name',
  'status',
  'ownerUserId',
  'memberCount',
  'listCount',
  'markedForDeletionAt',
  ...timestampKeys,
];

const zoneView = object(ADMIN_CORE_SCHEMA_IDS.zoneView, zoneFields, zoneKeys);

const zoneMemberView = object(
  ADMIN_CORE_SCHEMA_IDS.zoneMemberView,
  {
    membershipId: nonEmptyString(),
    userId: nonEmptyString(),
    username: nonEmptyString(),
    role: ref(ENUM_IDS.zoneRole),
    status: ref(ENUM_IDS.membershipStatus),
    createdAt: string({ format: 'date-time' }),
  },
  ['membershipId', 'userId', 'username', 'role', 'status', 'createdAt']
);

const zoneListView = object(
  ADMIN_CORE_SCHEMA_IDS.zoneListView,
  {
    id: nonEmptyString(),
    name: nonEmptyString(),
    lineCount: integer({ minimum: 0 }),
  },
  ['id', 'name', 'lineCount']
);

// The join code is on the detail shape and on no listing: it is the one field
// that grants access to a zone, so it belongs to a deliberate click rather than
// to a screen somebody leaves open.
const zoneDetailView = object(
  ADMIN_CORE_SCHEMA_IDS.zoneDetailView,
  {
    ...zoneFields,
    joinCode: nonEmptyString(),
    config: freeObject(),
    members: array(ref(ADMIN_CORE_SCHEMA_IDS.zoneMemberView)),
    lists: array(ref(ADMIN_CORE_SCHEMA_IDS.zoneListView)),
  },
  [...zoneKeys, 'joinCode', 'config', 'members', 'lists']
);

const zonePage = paginated(
  ADMIN_CORE_SCHEMA_IDS.zonePage,
  ADMIN_CORE_SCHEMA_IDS.zoneView
);

// Composed by the gateway from core's page plus one batched call to auth, so it
// belongs to no request/reply pair and is documented with `ApiComposedResponse`.
// `ownerName` is nullable only for an ownerless zone: an id auth could not
// resolve arrives here as the id, never as null (plan 0074, section 3).
const zoneRowView = object(
  ADMIN_CORE_SCHEMA_IDS.zoneRowView,
  { ...zoneFields, ownerName: nullableString() },
  [...zoneKeys, 'ownerName']
);

const zoneRowPage = paginated(
  ADMIN_CORE_SCHEMA_IDS.zoneRowPage,
  ADMIN_CORE_SCHEMA_IDS.zoneRowView
);

const listFields = {
  id: nonEmptyString(),
  zoneId: nonEmptyString(),
  zoneName: nonEmptyString(),
  name: nonEmptyString(),
  createdByUserId: nonEmptyString(),
  autoApproveLines: boolean(),
  sharedWithZone: boolean(),
  lineCount: integer({ minimum: 0 }),
  ...timestamps,
};
const listKeys = [
  'id',
  'zoneId',
  'zoneName',
  'name',
  'createdByUserId',
  'autoApproveLines',
  'sharedWithZone',
  'lineCount',
  ...timestampKeys,
];

const listView = object(ADMIN_CORE_SCHEMA_IDS.listView, listFields, listKeys);

const listLineView = object(
  ADMIN_CORE_SCHEMA_IDS.listLineView,
  {
    id: nonEmptyString(),
    content: string(),
    quantity: integer(),
    approvalStatus: ref(ENUM_IDS.lineApprovalStatus),
    createdByUserId: nonEmptyString(),
    ...timestamps,
  },
  [
    'id',
    'content',
    'quantity',
    'approvalStatus',
    'createdByUserId',
    ...timestampKeys,
  ]
);

const listDetailView = object(
  ADMIN_CORE_SCHEMA_IDS.listDetailView,
  { ...listFields, lines: array(ref(ADMIN_CORE_SCHEMA_IDS.listLineView)) },
  [...listKeys, 'lines']
);

const listPage = paginated(
  ADMIN_CORE_SCHEMA_IDS.listPage,
  ADMIN_CORE_SCHEMA_IDS.listView
);

const basketFields = {
  id: nonEmptyString(),
  ownerUserId: nonEmptyString(),
  name: nullableString(),
  status: ref(GENERATED_LIST_SCHEMA_IDS.generatedListStatus),
  zoneIds: array(nonEmptyString()),
  lineCount: integer({ minimum: 0 }),
  generatedAt: string({ format: 'date-time' }),
  ...timestamps,
};
const basketKeys = [
  'id',
  'ownerUserId',
  'name',
  'status',
  'zoneIds',
  'lineCount',
  'generatedAt',
  ...timestampKeys,
];

const basketView = object(
  ADMIN_CORE_SCHEMA_IDS.basketView,
  basketFields,
  basketKeys
);

const basketLineView = object(
  ADMIN_CORE_SCHEMA_IDS.basketLineView,
  {
    id: nonEmptyString(),
    content: string(),
    quantity: integer(),
    createdAt: string({ format: 'date-time' }),
  },
  ['id', 'content', 'quantity', 'createdAt']
);

const basketDetailView = object(
  ADMIN_CORE_SCHEMA_IDS.basketDetailView,
  { ...basketFields, lines: array(ref(ADMIN_CORE_SCHEMA_IDS.basketLineView)) },
  [...basketKeys, 'lines']
);

const basketPage = paginated(
  ADMIN_CORE_SCHEMA_IDS.basketPage,
  ADMIN_CORE_SCHEMA_IDS.basketView
);

// `targetUserId` is optional, so a request with only the credential is every
// zone. That is not a general zone search: it has no name filter, no usage
// statistics and no ordering choice, which section 2 puts outside this plan.
const listZonesRequest = object(
  ADMIN_CORE_SCHEMA_IDS.listZonesRequest,
  {
    ...adminCredentialProperties,
    targetUserId: string(),
    createdAfter: string({ format: 'date-time' }),
    createdBefore: string({ format: 'date-time' }),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId']
);

const zoneIdRequest = object(
  ADMIN_CORE_SCHEMA_IDS.zoneIdRequest,
  { ...adminCredentialProperties, zoneId: nonEmptyString() },
  ['userId', 'zoneId']
);

const membershipActionRequest = object(
  ADMIN_CORE_SCHEMA_IDS.membershipActionRequest,
  {
    ...adminCredentialProperties,
    zoneId: nonEmptyString(),
    membershipId: nonEmptyString(),
  },
  ['userId', 'zoneId', 'membershipId']
);

const listListsRequest = object(
  ADMIN_CORE_SCHEMA_IDS.listListsRequest,
  {
    ...adminCredentialProperties,
    zoneId: string(),
    createdByUserId: string(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId']
);

const getListRequest = object(
  ADMIN_CORE_SCHEMA_IDS.getListRequest,
  { ...adminCredentialProperties, listId: nonEmptyString() },
  ['userId', 'listId']
);

const listBasketsRequest = object(
  ADMIN_CORE_SCHEMA_IDS.listBasketsRequest,
  {
    ...adminCredentialProperties,
    ownerUserId: string(),
    zoneId: string(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId']
);

const getBasketRequest = object(
  ADMIN_CORE_SCHEMA_IDS.getBasketRequest,
  { ...adminCredentialProperties, basketId: nonEmptyString() },
  ['userId', 'basketId']
);

export const adminCoreSchemas: JsonSchema[] = [
  zoneView,
  zoneMemberView,
  zoneListView,
  zoneDetailView,
  zonePage,
  zoneRowView,
  zoneRowPage,
  listView,
  listLineView,
  listDetailView,
  listPage,
  basketView,
  basketLineView,
  basketDetailView,
  basketPage,
  listZonesRequest,
  zoneIdRequest,
  membershipActionRequest,
  listListsRequest,
  getListRequest,
  listBasketsRequest,
  getBasketRequest,
];

export const adminCoreMessageContracts: Record<
  string,
  { request: string; response: string }
> = {
  [ADMIN_ZONE_PATTERNS.list]: {
    request: ADMIN_CORE_SCHEMA_IDS.listZonesRequest,
    response: ADMIN_CORE_SCHEMA_IDS.zonePage,
  },
  [ADMIN_ZONE_PATTERNS.get]: {
    request: ADMIN_CORE_SCHEMA_IDS.zoneIdRequest,
    response: ADMIN_CORE_SCHEMA_IDS.zoneDetailView,
  },
  [ADMIN_ZONE_PATTERNS.delete]: {
    request: ADMIN_CORE_SCHEMA_IDS.zoneIdRequest,
    response: COMMON_IDS.idResult,
  },
  [ADMIN_ZONE_PATTERNS.regenerateJoinCode]: {
    request: ADMIN_CORE_SCHEMA_IDS.zoneIdRequest,
    response: ZONE_SCHEMA_IDS.zoneView,
  },
  [ADMIN_ZONE_PATTERNS.transferOwnership]: {
    request: ADMIN_CORE_SCHEMA_IDS.membershipActionRequest,
    response: ZONE_SCHEMA_IDS.zoneView,
  },
  [ADMIN_MEMBERSHIP_PATTERNS.kick]: {
    request: ADMIN_CORE_SCHEMA_IDS.membershipActionRequest,
    response: ZONE_SCHEMA_IDS.membershipView,
  },
  [ADMIN_MEMBERSHIP_PATTERNS.ban]: {
    request: ADMIN_CORE_SCHEMA_IDS.membershipActionRequest,
    response: ZONE_SCHEMA_IDS.membershipView,
  },
  [ADMIN_LIST_PATTERNS.list]: {
    request: ADMIN_CORE_SCHEMA_IDS.listListsRequest,
    response: ADMIN_CORE_SCHEMA_IDS.listPage,
  },
  [ADMIN_LIST_PATTERNS.get]: {
    request: ADMIN_CORE_SCHEMA_IDS.getListRequest,
    response: ADMIN_CORE_SCHEMA_IDS.listDetailView,
  },
  [ADMIN_BASKET_PATTERNS.list]: {
    request: ADMIN_CORE_SCHEMA_IDS.listBasketsRequest,
    response: ADMIN_CORE_SCHEMA_IDS.basketPage,
  },
  [ADMIN_BASKET_PATTERNS.get]: {
    request: ADMIN_CORE_SCHEMA_IDS.getBasketRequest,
    response: ADMIN_CORE_SCHEMA_IDS.basketDetailView,
  },
};
