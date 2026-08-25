import { REALTIME_ACCESS_PATTERNS } from '../../lib/messages/realtime.messages';
import {
  array,
  boolean,
  JsonSchema,
  nonEmptyString,
  nullableString,
  object,
  ref,
  schemaId,
} from '../builders';

export const REALTIME_SCHEMA_IDS = {
  checkZoneAccessRequest: schemaId('msg/realtime.checkZoneAccess/request'),
  checkListAccessRequest: schemaId('msg/realtime.checkListAccess/request'),
  accessCheckResult: schemaId('realtime/AccessCheckResult'),
  presenceUser: schemaId('realtime/PresenceUser'),
  presenceEditor: schemaId('realtime/PresenceEditor'),
  zonePresence: schemaId('realtime/ZonePresence'),
  listPresence: schemaId('realtime/ListPresence'),
  editLineSignal: schemaId('realtime/EditLineSignal'),
  stopEditLineSignal: schemaId('realtime/StopEditLineSignal'),
} as const;

const checkZoneAccessRequest = object(
  REALTIME_SCHEMA_IDS.checkZoneAccessRequest,
  { userId: nonEmptyString(), zoneId: nonEmptyString() },
  ['userId', 'zoneId']
);
const checkListAccessRequest = object(
  REALTIME_SCHEMA_IDS.checkListAccessRequest,
  { userId: nonEmptyString(), listId: nonEmptyString() },
  ['userId', 'listId']
);
const accessCheckResult = object(
  REALTIME_SCHEMA_IDS.accessCheckResult,
  { allowed: boolean() },
  ['allowed']
);
const presenceUser = object(
  REALTIME_SCHEMA_IDS.presenceUser,
  { userId: nonEmptyString() },
  ['userId']
);
const presenceEditor = object(
  REALTIME_SCHEMA_IDS.presenceEditor,
  { userId: nonEmptyString(), lineId: nullableString() },
  ['userId', 'lineId']
);
const zonePresence = object(
  REALTIME_SCHEMA_IDS.zonePresence,
  {
    zoneId: nonEmptyString(),
    online: array(ref(REALTIME_SCHEMA_IDS.presenceUser)),
  },
  ['zoneId', 'online']
);
const listPresence = object(
  REALTIME_SCHEMA_IDS.listPresence,
  {
    listId: nonEmptyString(),
    viewers: array(ref(REALTIME_SCHEMA_IDS.presenceUser)),
    editors: array(ref(REALTIME_SCHEMA_IDS.presenceEditor)),
  },
  ['listId', 'viewers', 'editors']
);
const editLineSignal = object(
  REALTIME_SCHEMA_IDS.editLineSignal,
  { listId: nonEmptyString(), lineId: nonEmptyString() },
  ['listId', 'lineId']
);
const stopEditLineSignal = object(
  REALTIME_SCHEMA_IDS.stopEditLineSignal,
  { listId: nonEmptyString(), lineId: nonEmptyString() },
  ['listId', 'lineId']
);

export const realtimeSchemas: JsonSchema[] = [
  checkZoneAccessRequest,
  checkListAccessRequest,
  accessCheckResult,
  presenceUser,
  presenceEditor,
  zonePresence,
  listPresence,
  editLineSignal,
  stopEditLineSignal,
];

export const realtimeMessageContracts: Record<
  string,
  { request: string; response: string }
> = {
  [REALTIME_ACCESS_PATTERNS.checkZone]: {
    request: REALTIME_SCHEMA_IDS.checkZoneAccessRequest,
    response: REALTIME_SCHEMA_IDS.accessCheckResult,
  },
  [REALTIME_ACCESS_PATTERNS.checkList]: {
    request: REALTIME_SCHEMA_IDS.checkListAccessRequest,
    response: REALTIME_SCHEMA_IDS.accessCheckResult,
  },
};
