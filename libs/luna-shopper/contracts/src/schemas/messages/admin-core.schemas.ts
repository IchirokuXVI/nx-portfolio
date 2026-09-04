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
import { LIST_SCHEMA_IDS } from './list.schemas';
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
  membershipPage: schemaId('admin-core/AdminMembershipPage'),
  listLinePage: schemaId('admin-core/AdminListLinePage'),
  listZonesRequest: schemaId('msg/adminZone.list/request'),
  zoneIdRequest: schemaId('msg/adminZone.zoneId/request'),
  updateZoneRequest: schemaId('msg/adminZone.update/request'),
  setDeletionMarkRequest: schemaId('msg/adminZone.setDeletionMark/request'),
  listMembershipsRequest: schemaId('msg/adminMembership.list/request'),
  updateMembershipRequest: schemaId('msg/adminMembership.update/request'),
  updateAdminListRequest: schemaId('msg/adminList.update/request'),
  listLinesRequest: schemaId('msg/adminList.listLines/request'),
  lineIdRequest: schemaId('msg/adminList.lineId/request'),
  updateLineRequest: schemaId('msg/adminList.updateLine/request'),
  setLineApprovalRequest: schemaId('msg/adminList.setLineApproval/request'),
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

/**
 * A page of memberships and a page of lines (plan 0077, section 9).
 *
 * The row shapes are the ones the zone and list detail reads already embed, so a
 * membership rendered in a collection and the same membership rendered inside its
 * zone are one shape rather than two that agree today.
 */
const membershipPage = paginated(
  ADMIN_CORE_SCHEMA_IDS.membershipPage,
  ADMIN_CORE_SCHEMA_IDS.zoneMemberView
);

const listLinePage = paginated(
  ADMIN_CORE_SCHEMA_IDS.listLinePage,
  ADMIN_CORE_SCHEMA_IDS.listLineView
);

// Name and config, and no third field. The join code, the owner, the status and
// the deletion marker are each excluded for a reason plan 0077 section 4.1
// states, and `admin-core-immutable-fields.spec.ts` asserts their absence here.
const updateZoneRequest = object(
  ADMIN_CORE_SCHEMA_IDS.updateZoneRequest,
  {
    ...adminCredentialProperties,
    zoneId: nonEmptyString(),
    name: nonEmptyString(),
    config: freeObject(),
  },
  ['userId', 'zoneId']
);

// One boolean, because the two columns behind it are one decision (section 4.2).
const setDeletionMarkRequest = object(
  ADMIN_CORE_SCHEMA_IDS.setDeletionMarkRequest,
  {
    ...adminCredentialProperties,
    zoneId: nonEmptyString(),
    marked: boolean(),
  },
  ['userId', 'zoneId', 'marked']
);

const listMembershipsRequest = object(
  ADMIN_CORE_SCHEMA_IDS.listMembershipsRequest,
  {
    ...adminCredentialProperties,
    zoneId: nonEmptyString(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId', 'zoneId']
);

// Role and per zone name. `status` is deliberately absent: it moves along a
// state machine with a service method per edge (section 4.4), so it is the four
// verbs beside this subject rather than a value on it.
const updateMembershipRequest = object(
  ADMIN_CORE_SCHEMA_IDS.updateMembershipRequest,
  {
    ...adminCredentialProperties,
    zoneId: nonEmptyString(),
    membershipId: nonEmptyString(),
    role: ref(ENUM_IDS.zoneRole),
    username: nonEmptyString(),
  },
  ['userId', 'zoneId', 'membershipId']
);

const updateAdminListRequest = object(
  ADMIN_CORE_SCHEMA_IDS.updateAdminListRequest,
  {
    ...adminCredentialProperties,
    listId: nonEmptyString(),
    name: nonEmptyString(),
    autoApproveLines: boolean(),
    sharedWithZone: boolean(),
  },
  ['userId', 'listId']
);

const listLinesRequest = object(
  ADMIN_CORE_SCHEMA_IDS.listLinesRequest,
  {
    ...adminCredentialProperties,
    listId: nonEmptyString(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId', 'listId']
);

const lineIdRequest = object(
  ADMIN_CORE_SCHEMA_IDS.lineIdRequest,
  {
    ...adminCredentialProperties,
    listId: nonEmptyString(),
    lineId: nonEmptyString(),
  },
  ['userId', 'listId', 'lineId']
);

// Content, quantity and the product set. The schema states the wire ceiling on
// the set and not the real bound, for the reason `UpdateLineRequest` gives: only
// core knows how many products the line holds right now, and a schema stating
// the cap alone would leave an over cap line unable to shrink.
const updateLineRequest = object(
  ADMIN_CORE_SCHEMA_IDS.updateLineRequest,
  {
    ...adminCredentialProperties,
    listId: nonEmptyString(),
    lineId: nonEmptyString(),
    content: nonEmptyString(),
    quantity: integer({ minimum: 0 }),
    itemIds: array(nonEmptyString()),
  },
  ['userId', 'listId', 'lineId']
);

const setLineApprovalRequest = object(
  ADMIN_CORE_SCHEMA_IDS.setLineApprovalRequest,
  {
    ...adminCredentialProperties,
    listId: nonEmptyString(),
    lineId: nonEmptyString(),
    status: ref(ENUM_IDS.lineApprovalStatus),
  },
  ['userId', 'listId', 'lineId', 'status']
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
  membershipPage,
  listLinePage,
  updateZoneRequest,
  setDeletionMarkRequest,
  listMembershipsRequest,
  updateMembershipRequest,
  updateAdminListRequest,
  listLinesRequest,
  lineIdRequest,
  updateLineRequest,
  setLineApprovalRequest,
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
  // Every write below answers with the **user facing** view its member facing
  // twin answers with, because the row after an operator edit is the row after
  // any other edit. Only the reads answer with an admin shape, and they do so
  // because those shapes are not caller relative (plan 0077, section 1).
  [ADMIN_ZONE_PATTERNS.update]: {
    request: ADMIN_CORE_SCHEMA_IDS.updateZoneRequest,
    response: ZONE_SCHEMA_IDS.zoneView,
  },
  [ADMIN_ZONE_PATTERNS.setDeletionMark]: {
    request: ADMIN_CORE_SCHEMA_IDS.setDeletionMarkRequest,
    response: ZONE_SCHEMA_IDS.zoneView,
  },
  [ADMIN_MEMBERSHIP_PATTERNS.list]: {
    request: ADMIN_CORE_SCHEMA_IDS.listMembershipsRequest,
    response: ADMIN_CORE_SCHEMA_IDS.membershipPage,
  },
  [ADMIN_MEMBERSHIP_PATTERNS.get]: {
    request: ADMIN_CORE_SCHEMA_IDS.membershipActionRequest,
    response: ADMIN_CORE_SCHEMA_IDS.zoneMemberView,
  },
  [ADMIN_MEMBERSHIP_PATTERNS.update]: {
    request: ADMIN_CORE_SCHEMA_IDS.updateMembershipRequest,
    response: ZONE_SCHEMA_IDS.membershipView,
  },
  [ADMIN_MEMBERSHIP_PATTERNS.approve]: {
    request: ADMIN_CORE_SCHEMA_IDS.membershipActionRequest,
    response: ZONE_SCHEMA_IDS.membershipView,
  },
  // A rejection removes the pending row, so it answers with the id that is gone
  // rather than with a membership that no longer exists.
  [ADMIN_MEMBERSHIP_PATTERNS.reject]: {
    request: ADMIN_CORE_SCHEMA_IDS.membershipActionRequest,
    response: COMMON_IDS.idResult,
  },
  [ADMIN_LIST_PATTERNS.update]: {
    request: ADMIN_CORE_SCHEMA_IDS.updateAdminListRequest,
    response: LIST_SCHEMA_IDS.listView,
  },
  [ADMIN_LIST_PATTERNS.delete]: {
    request: ADMIN_CORE_SCHEMA_IDS.getListRequest,
    response: COMMON_IDS.idResult,
  },
  [ADMIN_LIST_PATTERNS.listLines]: {
    request: ADMIN_CORE_SCHEMA_IDS.listLinesRequest,
    response: ADMIN_CORE_SCHEMA_IDS.listLinePage,
  },
  [ADMIN_LIST_PATTERNS.getLine]: {
    request: ADMIN_CORE_SCHEMA_IDS.lineIdRequest,
    response: ADMIN_CORE_SCHEMA_IDS.listLineView,
  },
  [ADMIN_LIST_PATTERNS.updateLine]: {
    request: ADMIN_CORE_SCHEMA_IDS.updateLineRequest,
    response: LIST_SCHEMA_IDS.lineView,
  },
  [ADMIN_LIST_PATTERNS.setLineApproval]: {
    request: ADMIN_CORE_SCHEMA_IDS.setLineApprovalRequest,
    response: LIST_SCHEMA_IDS.lineView,
  },
  [ADMIN_LIST_PATTERNS.deleteLine]: {
    request: ADMIN_CORE_SCHEMA_IDS.lineIdRequest,
    response: COMMON_IDS.idResult,
  },
};
