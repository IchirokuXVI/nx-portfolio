/**
 * Fixed names for the realtime service's JetStream wiring (plan 0009, section 4).
 *
 * The stream captures the domain events every service publishes; the durable
 * consumer name is stable so the same cursor survives a pod restart and replays
 * anything missed while it was down. These are operational identifiers, not a
 * cross service contract, so they live in the service rather than in `contracts`.
 */
export const EVENT_STREAM_NAME = 'LUNA_EVENTS';
export const EVENT_CONSUMER_NAME = 'luna-realtime';

/**
 * How many recent event ids the consumer remembers to drop duplicates under
 * JetStream's at-least-once delivery (plan 0009, section 4). A bounded window is
 * enough: a redelivery follows the original closely, so an id evicted long ago
 * will not be seen again.
 */
export const DEDUPE_WINDOW = 10_000;
