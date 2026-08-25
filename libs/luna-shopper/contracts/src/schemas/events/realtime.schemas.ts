import {
  DOMAIN_EVENT_SUBJECTS,
  RealtimeEvent,
} from '../../lib/events/realtime.events';
import { any, JsonSchema, nonEmptyString, object, schemaId, string } from '../builders';
import { REALTIME_SCHEMA_IDS } from '../messages/realtime.schemas';

/**
 * The wire shape the realtime service consumes from JetStream: every domain event
 * (plan 0006/0007/0008) is published inside the shared DomainEvent envelope (plan
 * 0009, section 4). The presence events are NOT enveloped and NOT in JetStream;
 * they are emitted straight to the room, so they map to their own payload schemas.
 */
export const DOMAIN_EVENT_SCHEMA_IDS = {
  domainEventEnvelope: schemaId('event/DomainEvent'),
} as const;

const domainEventEnvelope = object(
  DOMAIN_EVENT_SCHEMA_IDS.domainEventEnvelope,
  {
    event: nonEmptyString(),
    eventId: nonEmptyString(),
    zoneId: nonEmptyString(),
    listId: string(),
    payload: any(),
  },
  ['event', 'eventId', 'zoneId', 'payload']
);

export const realtimeEventSchemas: JsonSchema[] = [domainEventEnvelope];

/** event name -> payload schema id (domain events + the two presence events). */
export const domainEventContracts: Record<string, string> = {
  ...Object.fromEntries(
    DOMAIN_EVENT_SUBJECTS.map((e) => [
      e,
      DOMAIN_EVENT_SCHEMA_IDS.domainEventEnvelope,
    ])
  ),
  [RealtimeEvent.PresenceZoneUpdated]: REALTIME_SCHEMA_IDS.zonePresence,
  [RealtimeEvent.PresenceListUpdated]: REALTIME_SCHEMA_IDS.listPresence,
};
