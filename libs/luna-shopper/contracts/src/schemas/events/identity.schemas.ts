import { IDENTITY_EVENTS } from '../../lib/events/identity.events';
import { JsonSchema, nonEmptyString, object, schemaId } from '../builders';

/**
 * Identity event payload schemas (plan 0005, section 5). Each identity event
 * carries just the stable `userId`; a consumer validates the payload against the
 * matching schema before reacting.
 */
export const IDENTITY_EVENT_SCHEMA_IDS = {
  userRegistered: schemaId('event/user.registered'),
  userUpgraded: schemaId('event/user.upgraded'),
  userEmailVerified: schemaId('event/user.emailVerified'),
  userDeleted: schemaId('event/user.deleted'),
} as const;

const userIdPayload = (id: string): JsonSchema =>
  object(id, { userId: nonEmptyString() }, ['userId']);

export const identityEventSchemas: JsonSchema[] = [
  userIdPayload(IDENTITY_EVENT_SCHEMA_IDS.userRegistered),
  userIdPayload(IDENTITY_EVENT_SCHEMA_IDS.userUpgraded),
  userIdPayload(IDENTITY_EVENT_SCHEMA_IDS.userEmailVerified),
  userIdPayload(IDENTITY_EVENT_SCHEMA_IDS.userDeleted),
];

/** event name -> payload schema id. */
export const identityEventContracts: Record<string, string> = {
  [IDENTITY_EVENTS.userRegistered]: IDENTITY_EVENT_SCHEMA_IDS.userRegistered,
  [IDENTITY_EVENTS.userUpgraded]: IDENTITY_EVENT_SCHEMA_IDS.userUpgraded,
  [IDENTITY_EVENTS.userEmailVerified]:
    IDENTITY_EVENT_SCHEMA_IDS.userEmailVerified,
  [IDENTITY_EVENTS.userDeleted]: IDENTITY_EVENT_SCHEMA_IDS.userDeleted,
};
