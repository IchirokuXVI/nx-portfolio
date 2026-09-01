import { REALTIME_ACCESS_PATTERNS } from '../../lib/messages/realtime.messages';
import { ENUM_IDS } from '../enums.schemas';
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
  // Shared baskets (plan 0051, section 7): the room whose members are
  // participants rather than users.
  checkParticipantAccessRequest: schemaId(
    'msg/realtime.checkParticipantAccess/request'
  ),
  participantPresenceEntry: schemaId('realtime/ParticipantPresenceEntry'),
  generatedListPresence: schemaId('realtime/GeneratedListPresence'),
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
  {
    allowed: boolean(),
    // The two optional fields the answer carries when the question was about a
    // zone or about a participant. Both were declared on `AccessCheckResult`
    // before they were declared here, and `object` defaults
    // `additionalProperties` to false, so a strictly validated zone answer would
    // have been rejected for carrying the very field plan 0032 added to it.
    listIds: array(nonEmptyString()),
    participant: ref(REALTIME_SCHEMA_IDS.participantPresenceEntry),
  },
  ['allowed']
);
const checkParticipantAccessRequest = object(
  REALTIME_SCHEMA_IDS.checkParticipantAccessRequest,
  { participantId: nonEmptyString(), generatedListId: nonEmptyString() },
  ['participantId', 'generatedListId']
);
/**
 * One participant connected to a shared basket (plan 0051, section 7).
 *
 * Deliberately not built on {@link REALTIME_SCHEMA_IDS.presenceUser}: a guest has
 * no user id at all, so the required `userId` that schema carries is exactly what
 * this cannot promise.
 */
const participantPresenceEntry = object(
  REALTIME_SCHEMA_IDS.participantPresenceEntry,
  {
    participantId: nonEmptyString(),
    kind: ref(ENUM_IDS.participantKind),
    displayName: nullableString(),
    guestNumber: { type: ['integer', 'null'] },
    userId: nullableString(),
  },
  ['participantId', 'kind', 'displayName', 'guestNumber', 'userId']
);
const generatedListPresence = object(
  REALTIME_SCHEMA_IDS.generatedListPresence,
  {
    generatedListId: nonEmptyString(),
    present: array(ref(REALTIME_SCHEMA_IDS.participantPresenceEntry)),
  },
  ['generatedListId', 'present']
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
  checkParticipantAccessRequest,
  participantPresenceEntry,
  generatedListPresence,
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
  // Same request shape as the plain zone check; only the answer's rule differs
  // (OWNER/ADMIN rather than any approved member), so it reuses that schema.
  [REALTIME_ACCESS_PATTERNS.checkZoneStaff]: {
    request: REALTIME_SCHEMA_IDS.checkZoneAccessRequest,
    response: REALTIME_SCHEMA_IDS.accessCheckResult,
  },
  [REALTIME_ACCESS_PATTERNS.checkList]: {
    request: REALTIME_SCHEMA_IDS.checkListAccessRequest,
    response: REALTIME_SCHEMA_IDS.accessCheckResult,
  },
  // The one check keyed on a participant rather than a user (plan 0051,
  // section 7), and the only one whose answer carries who the asker is.
  [REALTIME_ACCESS_PATTERNS.checkParticipant]: {
    request: REALTIME_SCHEMA_IDS.checkParticipantAccessRequest,
    response: REALTIME_SCHEMA_IDS.accessCheckResult,
  },
};
