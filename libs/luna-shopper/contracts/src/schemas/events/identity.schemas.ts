import { IDENTITY_EVENTS } from '../../lib/events/identity.events';
import { JsonSchema, nonEmptyString, object, ref, schemaId } from '../builders';
import { ENUM_IDS } from '../enums.schemas';

/**
 * Identity event payload schemas (plan 0005, section 5). Most identity events
 * carry just the stable `userId`; a consumer validates the payload against the
 * matching schema before reacting. The rename event (plan 0018) additionally
 * carries both names, so core's saga needs no lookup to apply MATCHING_ZONES.
 */
export const IDENTITY_EVENT_SCHEMA_IDS = {
  userRegistered: schemaId('event/user.registered'),
  userUpgraded: schemaId('event/user.upgraded'),
  userEmailVerified: schemaId('event/user.emailVerified'),
  userDeleted: schemaId('event/user.deleted'),
  userUsernameChanged: schemaId('event/user.usernameChanged'),
} as const;

const userIdPayload = (id: string): JsonSchema =>
  object(id, { userId: nonEmptyString() }, ['userId']);

const userUsernameChanged = object(
  IDENTITY_EVENT_SCHEMA_IDS.userUsernameChanged,
  {
    eventId: nonEmptyString(),
    userId: nonEmptyString(),
    oldUsername: nonEmptyString(),
    newUsername: nonEmptyString(),
    propagation: ref(ENUM_IDS.usernamePropagation),
  },
  ['eventId', 'userId', 'oldUsername', 'newUsername', 'propagation']
);

export const identityEventSchemas: JsonSchema[] = [
  userIdPayload(IDENTITY_EVENT_SCHEMA_IDS.userRegistered),
  userIdPayload(IDENTITY_EVENT_SCHEMA_IDS.userUpgraded),
  userIdPayload(IDENTITY_EVENT_SCHEMA_IDS.userEmailVerified),
  userIdPayload(IDENTITY_EVENT_SCHEMA_IDS.userDeleted),
  userUsernameChanged,
];

/** event name -> payload schema id. */
export const identityEventContracts: Record<string, string> = {
  [IDENTITY_EVENTS.userRegistered]: IDENTITY_EVENT_SCHEMA_IDS.userRegistered,
  [IDENTITY_EVENTS.userUpgraded]: IDENTITY_EVENT_SCHEMA_IDS.userUpgraded,
  [IDENTITY_EVENTS.userEmailVerified]:
    IDENTITY_EVENT_SCHEMA_IDS.userEmailVerified,
  [IDENTITY_EVENTS.userDeleted]: IDENTITY_EVENT_SCHEMA_IDS.userDeleted,
  [IDENTITY_EVENTS.userUsernameChanged]:
    IDENTITY_EVENT_SCHEMA_IDS.userUsernameChanged,
};
