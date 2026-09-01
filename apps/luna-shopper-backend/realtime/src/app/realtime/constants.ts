import { RealtimeEvent } from '@portfolio/luna-shopper/contracts';

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
 * How long an event id is remembered, so a redelivery is dropped under
 * JetStream's at-least-once guarantee (plan 0009, section 4).
 *
 * This is a span of time, and it used to be a count of events (a bounded map of
 * ten thousand ids). The count was always an approximation of this: what the
 * window wants to express is "longer than JetStream's redelivery backoff", which
 * a number of events can only stand in for, and badly, since how long ten
 * thousand ids covers depends entirely on how busy the system is.
 *
 * Plan 0028, section 2.5 moved it into Redis, which is what makes the honest
 * version possible: the window is a key TTL, and it is shared, so a redelivery
 * landing on a different pod than the original is dropped too. The in memory map
 * could not do that, and at two replicas it published every redelivered event a
 * second time.
 */
export const DEDUPE_WINDOW_SECONDS = 300;

/** Namespace for the dedupe keys; one per event id. */
export const DEDUPE_KEY_PREFIX = 'dedupe:event';

/**
 * The presence store's layout, and the liveness rule that reads it.
 *
 * Re exported rather than defined here since plan 0053, section 2. The gateway
 * now reads the basket room to answer how many people are in a shop, so the keys
 * and the window are held by two services and belong in `platform`, beside the
 * Redis client both of them use. Everything in this service goes on importing
 * them from here.
 *
 * The ratio is the useful quantity: ninety seconds against a thirty second
 * heartbeat gives two missed beats of slack, so an ordinary garbage collection
 * pause never evicts a live pod's users while a genuinely dead one is gone well
 * inside two minutes. Move them together, never one alone.
 */
export {
  generatedListPresenceKey,
  listEditorsKey,
  listViewersKey,
  PRESENCE_HEARTBEAT_MS,
  PRESENCE_KEY_TTL_SECONDS,
  PRESENCE_TTL_MS,
  zonePresenceKey,
} from '@portfolio/luna-shopper/platform';

/**
 * How long a cached access decision stands with no event to invalidate it (plan
 * 0028, section 2.6).
 *
 * This is the backstop, not the mechanism. Membership and list events invalidate
 * the moment they arrive, so in the ordinary case a revoked member loses the
 * room in the time it takes an event to cross the broker. Sixty seconds is what
 * covers the case nobody modelled: an access change that publishes no event this
 * service consumes.
 */
export const ACCESS_CACHE_TTL_SECONDS = 60;

/**
 * The events that change who may hear a zone, and therefore drop its cached
 * access answers (plan 0028, section 2.6).
 *
 * Erring wide on purpose. A false entry here costs one `DEL` and a round trip to
 * core per user afterwards; a **missing** one costs a revoked member up to a
 * minute of a room they should no longer be in, which is the failure this cache
 * had to buy off before it was allowed to exist. When a new membership or zone
 * event is added to `RealtimeEvent`, add it here unless it demonstrably cannot
 * change an access answer.
 *
 * **This set now guards two caches** (plan 0032, section 4.1): the yes/no answers
 * and the readable list set behind {@link zoneListsAccessKey}. Every entry above
 * moves the first and therefore the second; the three list events at the end
 * move only the second, and are here because it is the same `DEL`. Each entry
 * below says which answer it is for.
 */
export const ACCESS_INVALIDATING_EVENTS: ReadonlySet<RealtimeEvent> = new Set([
  // Membership, which is what zone access is resolved from.
  RealtimeEvent.MemberJoined,
  RealtimeEvent.MemberApproved,
  RealtimeEvent.MemberRejected,
  RealtimeEvent.MemberKicked,
  RealtimeEvent.MemberBanned,
  // Governance: changes the staff answer even when plain access is unchanged.
  RealtimeEvent.MemberRoleChanged,
  RealtimeEvent.ZoneOwnershipChanged,
  // The zone itself going away denies everyone.
  RealtimeEvent.ZoneDeleted,
  RealtimeEvent.ZoneMarkedForDeletion,
  // A merge implies a kick for the source membership (plan 0008), so it moves
  // access for two users at once.
  RealtimeEvent.MergeApproved,
  // The three that change which lists a member may read without changing whether
  // they are in the zone at all (plan 0032, section 4.1). They are here for the
  // readable list set; the yes/no answers they drop alongside it are collateral,
  // and cost a round trip rather than a wrong answer.
  RealtimeEvent.ListCreated,
  RealtimeEvent.ListDeleted,
  RealtimeEvent.ListAccessChanged,
]);

/**
 * One hash per resource, fields keyed by user id, so an invalidation is a `DEL`
 * of a key whose name the event already carries. See the comment on
 * `CoreAccessClient` for why this shape rather than a key per user/resource pair.
 */
export const zoneAccessKey = (zoneId: string) => `access:zone:${zoneId}`;
export const zoneStaffAccessKey = (zoneId: string) =>
  `access:zonestaff:${zoneId}`;
export const listAccessKey = (listId: string) => `access:list:${listId}`;

/**
 * Which of a zone's lists a caller may read (plan 0032, section 4.1). The same
 * shape as the three above, so the same `DEL` on the zone's name drops it, and
 * the fields hold a JSON array of ids rather than a yes or a no.
 */
export const zoneListsAccessKey = (zoneId: string) =>
  `access:zonelists:${zoneId}`;
