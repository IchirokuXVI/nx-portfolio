import {
  DOMAIN_EVENT_SUBJECTS,
  domainEventSubject,
  RealtimeEvent,
} from '../../lib/events/realtime.events';
import {
  any,
  array,
  JsonSchema,
  nonEmptyString,
  object,
  schemaId,
  string,
} from '../builders';
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

/**
 * The audience fields (`zoneId`, `listId`, `userIds`) are all optional since plan
 * 0030, section 3: an event about a person carries no zone. "At least one of
 * them is set" is the envelope's real rule and it is enforced by the consumer,
 * which drops an unaddressed event as a fault, rather than by a schema keyword
 * that would say it less clearly than the code that acts on it.
 */
const domainEventEnvelope = object(
  DOMAIN_EVENT_SCHEMA_IDS.domainEventEnvelope,
  {
    event: nonEmptyString(),
    eventId: nonEmptyString(),
    zoneId: nonEmptyString(),
    listId: string(),
    userIds: array(nonEmptyString()),
    payload: any(),
  },
  ['event', 'eventId', 'payload']
);

export const realtimeEventSchemas: JsonSchema[] = [domainEventEnvelope];

/**
 * subject -> payload schema id (domain events + the two presence events).
 *
 * Keyed by the **subject** rather than by the event name, which matters for one
 * of them: `user.usernameChanged` names both auth's identity event and core's
 * re-publication of it (plan 0030, section 4.3), and the two carry different
 * envelopes. They are kept apart on the wire by {@link domainEventSubject} and
 * they are kept apart here the same way, since a name to schema map with one key
 * for two shapes would validate one of them against the other.
 */
export const domainEventContracts: Record<string, string> = {
  ...Object.fromEntries(
    DOMAIN_EVENT_SUBJECTS.map((e) => [
      domainEventSubject(e),
      DOMAIN_EVENT_SCHEMA_IDS.domainEventEnvelope,
    ])
  ),
  [RealtimeEvent.PresenceZoneUpdated]: REALTIME_SCHEMA_IDS.zonePresence,
  [RealtimeEvent.PresenceListUpdated]: REALTIME_SCHEMA_IDS.listPresence,
};
