import {
  MEMBERSHIP_PATTERNS,
  ZONE_PATTERNS,
} from '../../lib/messages/zone.messages';
import {
  array,
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
import { COMMON_IDS } from '../common.schemas';
import { ENUM_IDS } from '../enums.schemas';

export const ZONE_SCHEMA_IDS = {
  zoneView: schemaId('zone/ZoneView'),
  membershipView: schemaId('zone/MembershipView'),
  zoneCounts: schemaId('zone/ZoneCounts'),
  zoneListPreview: schemaId('zone/ZoneListPreview'),
  myZoneView: schemaId('zone/MyZoneView'),
  myZoneCounts: schemaId('zone/MyZoneCounts'),
  zonePage: schemaId('zone/ZonePage'),
  membershipPage: schemaId('zone/MembershipPage'),
  createRequest: schemaId('msg/zone.create/request'),
  joinRequest: schemaId('msg/zone.join/request'),
  updateRequest: schemaId('msg/zone.update/request'),
  zoneIdRequest: schemaId('msg/zone.zoneId/request'),
  setRoleRequest: schemaId('msg/zone.setRole/request'),
  membershipActionRequest: schemaId('msg/zone.membershipAction/request'),
  listMineRequest: schemaId('msg/zone.listMine/request'),
  countsMineRequest: schemaId('msg/zone.countsMine/request'),
  listMembersRequest: schemaId('msg/membership.list/request'),
} as const;

/**
 * Timestamps every read model carries (plan 0017, section 7), so a client can
 * read the field it is allowed to sort by.
 */
const timestamps = {
  createdAt: string({ format: 'date-time' }),
  updatedAt: string({ format: 'date-time' }),
};
const timestampKeys = ['createdAt', 'updatedAt'];

const zoneView = object(
  ZONE_SCHEMA_IDS.zoneView,
  {
    id: nonEmptyString(),
    name: nonEmptyString(),
    joinCode: nonEmptyString(),
    status: ref(ENUM_IDS.zoneStatus),
    ownerUserId: nullableString(),
    config: freeObject(),
    ...timestamps,
  },
  ['id', 'name', 'joinCode', 'status', 'ownerUserId', 'config', ...timestampKeys]
);

const membershipView = object(
  ZONE_SCHEMA_IDS.membershipView,
  {
    id: nonEmptyString(),
    zoneId: nonEmptyString(),
    userId: nonEmptyString(),
    username: nonEmptyString(),
    role: ref(ENUM_IDS.zoneRole),
    status: ref(ENUM_IDS.membershipStatus),
    ...timestamps,
  },
  ['id', 'zoneId', 'userId', 'username', 'role', 'status', ...timestampKeys]
);

const zoneCounts = object(
  ZONE_SCHEMA_IDS.zoneCounts,
  {
    memberCount: integer({ minimum: 0 }),
    listCount: integer({ minimum: 0 }),
    // Null is "not your business", 0 is "nobody is waiting" (section 6).
    pendingRequestCount: { type: ['integer', 'null'], minimum: 0 },
    firstPendingRequesterName: nullableString(),
  },
  [
    'memberCount',
    'listCount',
    'pendingRequestCount',
    'firstPendingRequesterName',
  ]
);

const zoneListPreview = object(
  ZONE_SCHEMA_IDS.zoneListPreview,
  {
    id: nonEmptyString(),
    name: nonEmptyString(),
    lineCount: integer({ minimum: 0 }),
    readyCount: integer({ minimum: 0 }),
  },
  ['id', 'name', 'lineCount', 'readyCount']
);

const myZoneCounts = object(
  ZONE_SCHEMA_IDS.myZoneCounts,
  {
    owned: integer({ minimum: 0 }),
    joined: integer({ minimum: 0 }),
    pending: integer({ minimum: 0 }),
    total: integer({ minimum: 0 }),
  },
  ['owned', 'joined', 'pending', 'total']
);

const myZoneView = object(
  ZONE_SCHEMA_IDS.myZoneView,
  {
    id: nonEmptyString(),
    name: nonEmptyString(),
    joinCode: nonEmptyString(),
    status: ref(ENUM_IDS.zoneStatus),
    ownerUserId: nullableString(),
    config: freeObject(),
    ...timestamps,
    myRole: ref(ENUM_IDS.zoneRole),
    myStatus: ref(ENUM_IDS.membershipStatus),
    counts: ref(ZONE_SCHEMA_IDS.zoneCounts),
    lists: array(ref(ZONE_SCHEMA_IDS.zoneListPreview)),
  },
  [
    'id',
    'name',
    'joinCode',
    'status',
    'ownerUserId',
    'config',
    ...timestampKeys,
    'myRole',
    'myStatus',
    'counts',
    'lists',
  ]
);

const zonePage = paginated(ZONE_SCHEMA_IDS.zonePage, ZONE_SCHEMA_IDS.myZoneView);
const membershipPage = paginated(
  ZONE_SCHEMA_IDS.membershipPage,
  ZONE_SCHEMA_IDS.membershipView
);

const createRequest = object(
  ZONE_SCHEMA_IDS.createRequest,
  { userId: nonEmptyString(), name: nonEmptyString(), username: nonEmptyString() },
  ['userId', 'name', 'username']
);

const joinRequest = object(
  ZONE_SCHEMA_IDS.joinRequest,
  {
    userId: nonEmptyString(),
    joinCode: nonEmptyString(),
    username: nonEmptyString(),
  },
  ['userId', 'joinCode', 'username']
);

const updateRequest = object(
  ZONE_SCHEMA_IDS.updateRequest,
  {
    userId: nonEmptyString(),
    zoneId: nonEmptyString(),
    name: string(),
    config: freeObject(),
  },
  ['userId', 'zoneId']
);

const zoneIdRequest = object(
  ZONE_SCHEMA_IDS.zoneIdRequest,
  { userId: nonEmptyString(), zoneId: nonEmptyString() },
  ['userId', 'zoneId']
);

const setRoleRequest = object(
  ZONE_SCHEMA_IDS.setRoleRequest,
  {
    userId: nonEmptyString(),
    zoneId: nonEmptyString(),
    membershipId: nonEmptyString(),
    role: ref(ENUM_IDS.zoneRole),
  },
  ['userId', 'zoneId', 'membershipId', 'role']
);

const membershipActionRequest = object(
  ZONE_SCHEMA_IDS.membershipActionRequest,
  {
    userId: nonEmptyString(),
    zoneId: nonEmptyString(),
    membershipId: nonEmptyString(),
  },
  ['userId', 'zoneId', 'membershipId']
);

const listMineRequest = object(
  ZONE_SCHEMA_IDS.listMineRequest,
  {
    userId: nonEmptyString(),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId']
);

const countsMineRequest = object(
  ZONE_SCHEMA_IDS.countsMineRequest,
  { userId: nonEmptyString() },
  ['userId']
);

const listMembersRequest = object(
  ZONE_SCHEMA_IDS.listMembersRequest,
  {
    userId: nonEmptyString(),
    zoneId: nonEmptyString(),
    statuses: array(ref(ENUM_IDS.membershipStatus)),
    cursor: string(),
    limit: integer({ minimum: 1 }),
    order: string(),
  },
  ['userId', 'zoneId']
);

export const zoneSchemas: JsonSchema[] = [
  zoneView,
  membershipView,
  zoneCounts,
  zoneListPreview,
  myZoneView,
  myZoneCounts,
  zonePage,
  membershipPage,
  createRequest,
  joinRequest,
  updateRequest,
  zoneIdRequest,
  setRoleRequest,
  membershipActionRequest,
  listMineRequest,
  countsMineRequest,
  listMembersRequest,
];

export const zoneMessageContracts: Record<
  string,
  { request: string; response: string }
> = {
  [ZONE_PATTERNS.create]: {
    request: ZONE_SCHEMA_IDS.createRequest,
    response: ZONE_SCHEMA_IDS.zoneView,
  },
  [ZONE_PATTERNS.join]: {
    request: ZONE_SCHEMA_IDS.joinRequest,
    response: ZONE_SCHEMA_IDS.membershipView,
  },
  [ZONE_PATTERNS.update]: {
    request: ZONE_SCHEMA_IDS.updateRequest,
    response: ZONE_SCHEMA_IDS.zoneView,
  },
  [ZONE_PATTERNS.delete]: {
    request: ZONE_SCHEMA_IDS.zoneIdRequest,
    response: COMMON_IDS.idResult,
  },
  [ZONE_PATTERNS.regenerateJoinCode]: {
    request: ZONE_SCHEMA_IDS.zoneIdRequest,
    response: ZONE_SCHEMA_IDS.zoneView,
  },
  [ZONE_PATTERNS.setRole]: {
    request: ZONE_SCHEMA_IDS.setRoleRequest,
    response: ZONE_SCHEMA_IDS.membershipView,
  },
  [ZONE_PATTERNS.transferOwnership]: {
    request: ZONE_SCHEMA_IDS.membershipActionRequest,
    response: ZONE_SCHEMA_IDS.zoneView,
  },
  [ZONE_PATTERNS.claimOwnership]: {
    request: ZONE_SCHEMA_IDS.zoneIdRequest,
    response: ZONE_SCHEMA_IDS.zoneView,
  },
  [ZONE_PATTERNS.listMine]: {
    request: ZONE_SCHEMA_IDS.listMineRequest,
    response: ZONE_SCHEMA_IDS.zonePage,
  },
  [ZONE_PATTERNS.get]: {
    request: ZONE_SCHEMA_IDS.zoneIdRequest,
    response: ZONE_SCHEMA_IDS.myZoneView,
  },
  [ZONE_PATTERNS.countsMine]: {
    request: ZONE_SCHEMA_IDS.countsMineRequest,
    response: ZONE_SCHEMA_IDS.myZoneCounts,
  },
  [MEMBERSHIP_PATTERNS.approve]: {
    request: ZONE_SCHEMA_IDS.membershipActionRequest,
    response: ZONE_SCHEMA_IDS.membershipView,
  },
  [MEMBERSHIP_PATTERNS.reject]: {
    request: ZONE_SCHEMA_IDS.membershipActionRequest,
    response: COMMON_IDS.idResult,
  },
  [MEMBERSHIP_PATTERNS.kick]: {
    request: ZONE_SCHEMA_IDS.membershipActionRequest,
    response: ZONE_SCHEMA_IDS.membershipView,
  },
  [MEMBERSHIP_PATTERNS.ban]: {
    request: ZONE_SCHEMA_IDS.membershipActionRequest,
    response: ZONE_SCHEMA_IDS.membershipView,
  },
  [MEMBERSHIP_PATTERNS.list]: {
    request: ZONE_SCHEMA_IDS.listMembersRequest,
    response: ZONE_SCHEMA_IDS.membershipPage,
  },
};
