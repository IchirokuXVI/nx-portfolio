import type { RedisOptions } from 'ioredis';

/**
 * What a connection is for (plan 0028, section 4).
 *
 * The two roles need opposite answers to the same two questions, which is why
 * this file exists rather than every caller passing its own options.
 *
 * `command` is the ordinary request path. A command issued while Redis is
 * unreachable must **fail**, not wait, because every caller in plan 0028 section
 * 5 has a documented answer for a failed command (refuse, broadcast empty, miss
 * through to the origin) and no useful answer for one that hangs. A queued
 * command turns a Redis outage into a stalled HTTP request, which is the one
 * outcome none of those callers chose.
 *
 * `pubsub` is a long lived subscription: the socket.io adapter's subscriber and
 * the relay channel. It has to survive a reconnect rather than give up on one,
 * so the retry budget is unlimited and the offline queue stays on, which is what
 * lets ioredis replay the SUBSCRIBE that re establishes the channel.
 */
export type RedisConnectionRole = 'command' | 'pubsub';

/** Backoff between reconnect attempts, capped so a long outage keeps retrying. */
const RECONNECT_BASE_MS = 200;
const RECONNECT_CAP_MS = 5_000;

/**
 * A command that has not answered in this long is treated as a failure. The
 * operations here are single key reads and writes against a cluster local
 * instance, so a second is already far outside normal; the point of the timeout
 * is that a wedged connection surfaces as an error the caller can degrade on.
 */
const COMMAND_TIMEOUT_MS = 1_000;

/** How long the initial connect may take before it is retried. */
const CONNECT_TIMEOUT_MS = 5_000;

/**
 * The one place ioredis is configured, so four services cannot arrive at four
 * different opinions about what to do when Redis is down.
 *
 * `connectionName` is only for humans: it is what `CLIENT LIST` shows, which
 * turns "something is holding six connections" into a readable answer.
 */
export function createRedisOptions(
  role: RedisConnectionRole,
  connectionName: string
): RedisOptions {
  const shared: RedisOptions = {
    connectionName,
    connectTimeout: CONNECT_TIMEOUT_MS,
    // Reconnect forever, with a capped backoff. Redis coming back has to heal
    // the process on its own; a service that needed a restart to notice would
    // make every outage twice as long as it had to be.
    retryStrategy: (attempt: number) =>
      Math.min(attempt * RECONNECT_BASE_MS, RECONNECT_CAP_MS),
  };

  if (role === 'pubsub') {
    return {
      ...shared,
      // A subscriber must not give up on a request: dropping the SUBSCRIBE would
      // leave a connection that still looks connected and is silently deaf.
      maxRetriesPerRequest: null,
      enableOfflineQueue: true,
    };
  }

  return {
    ...shared,
    // Fail fast rather than queue. See the doc comment on RedisConnectionRole.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: COMMAND_TIMEOUT_MS,
  };
}
