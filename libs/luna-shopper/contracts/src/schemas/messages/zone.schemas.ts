import {
  MEMBERSHIP_PATTERNS,
  ZONE_PATTERNS,
} from '../../lib/messages/zone.messages';
import {
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
  myZoneView: schemaId('zone/MyZoneView'),
  zonePage: schemaId('zone/ZonePage'),
  createRequest: schemaId('msg/zone.create/request'),
  joinRequest: schemaId('msg/zone.join/request'),
  updateRequest: schemaId('msg/zone.update/request'),
  zoneIdRequest: schemaId('msg/zone.zoneId/request'),
  setRoleRequest: schemaId('msg/zone.setRole/request'),
  membershipActionRequest: schemaId('msg/zone.membershipAction/request'),
  listMineRequest: schemaId('msg/zone.listMine/request'),
} as const;

const zoneView = object(
  ZONE_SCHEMA_IDS.zoneView,
  {
    id: nonEmptyString(),
    name: nonEmptyString(),
    joinCode: nonEmptyString(),
    status: ref(ENUM_IDS.zoneStatus),
    ownerUserId: nullableString(),
    config: freeObject(),
  },
  ['id', 'name', 'joinCode', 'status', 'ownerUserId', 'config']
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
  },
  ['id', 'zoneId', 'userId', 'username', 'role', 'status']
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
    myRole: ref(ENUM_IDS.zoneRole),
    myStatus: ref(ENUM_IDS.membershipStatus),
  },
  [
    'id',
    'name',
    'joinCode',
    'status',
    'ownerUserId',
    'config',
    'myRole',
    'myStatus',
  ]
);

const zonePage = paginated(ZONE_SCHEMA_IDS.zonePage, ZONE_SCHEMA_IDS.myZoneView);

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

export const zoneSchemas: JsonSchema[] = [
  zoneView,
  membershipView,
  myZoneView,
  zonePage,
  createRequest,
  joinRequest,
  updateRequest,
  zoneIdRequest,
  setRoleRequest,
  membershipActionRequest,
  listMineRequest,
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
};
