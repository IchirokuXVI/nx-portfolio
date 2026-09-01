/**
 * The shape of the presence store, for the two services that read it.
 *
 * Presence is written by the realtime service and by nothing else, and for a
 * long time it was read there too, which is why the keys and the liveness window
 * lived beside the socket code as operational identifiers rather than as a
 * contract. Plan 0053 section 2 gives the gateway a reason to read one of those
 * rooms: a basket's history row says how many people are in the shop, and the
 * gateway is the only service that both answers that read and can reach Redis.
 *
 * Two readers make this a contract, so it moves here rather than being copied.
 * A copy would be two definitions of where presence lives, and the failure that
 * follows from them drifting is a count that is always zero with nothing
 * anywhere reporting an error.
 *
 * It is deliberately **not** in `contracts`: nothing here crosses the broker and
 * none of it is a message. It is how one Redis instance is laid out, which is a
 * platform concern in the same way {@link RedisService} is.
 */

/** How long a presence entry survives without a heartbeat. */
export const PRESENCE_TTL_MS = 90_000;

/** How often a pod re scores the members it is responsible for. */
export const PRESENCE_HEARTBEAT_MS = 30_000;

/**
 * Expiry on the room keys themselves, as distinct from the per member liveness
 * above. Members are pruned by score, so this only collects a room nobody has
 * touched at all since well after the last member should have gone.
 */
export const PRESENCE_KEY_TTL_SECONDS = 3_600;

export const zonePresenceKey = (zoneId: string): string =>
  `presence:zone:${zoneId}`;

export const listViewersKey = (listId: string): string =>
  `presence:list:${listId}:viewers`;

export const listEditorsKey = (listId: string): string =>
  `presence:list:${listId}:editors`;

/**
 * Who is in a shared basket right now (plan 0051, section 7).
 *
 * A **hash** keyed by socket id rather than a sorted set like the two rooms
 * above, because a participant entry carries more than an id and has to be read
 * back whole.
 */
export const generatedListPresenceKey = (generatedListId: string): string =>
  `presence:generated:${generatedListId}`;

/**
 * How many of a presence hash's entries are still live.
 *
 * The liveness rule, applied by whoever is reading rather than trusted from the
 * key's own TTL, which is one expiry for a whole room and therefore cannot say
 * anything about an individual member. A reader that skipped this would count
 * the sockets of a pod that was killed without running a single disconnect
 * handler, for as long as the room key survives.
 *
 * Entries whose JSON cannot be read are treated as expired, exactly as the
 * realtime service treats them, so a bad write cannot pin a phantom shopper to a
 * basket forever.
 */
export function countLivePresence(
  entries: Record<string, string>,
  now = Date.now()
): number {
  const cutoff = now - PRESENCE_TTL_MS;
  let live = 0;
  for (const raw of Object.values(entries)) {
    const seenAt = seenAtOf(raw);
    if (seenAt !== undefined && seenAt > cutoff) {
      live += 1;
    }
  }
  return live;
}

function seenAtOf(raw: string): number | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    const seenAt =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as { seenAt?: unknown }).seenAt
        : undefined;
    return typeof seenAt === 'number' ? seenAt : undefined;
  } catch {
    return undefined;
  }
}
