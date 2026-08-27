import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { HealthCheckError, type HealthIndicatorResult } from '@nestjs/terminus';
import Redis from 'ioredis';
import { Logger } from 'nestjs-pino';
import { createRedisOptions, type RedisConnectionRole } from './redis.options';

/**
 * The connection type, re exported so a service can hold a duplicated connection
 * without importing `ioredis` itself. The version is pinned in one place (plan
 * 0028, section 4) and this is how that stays true.
 */
export type { Redis };

/**
 * The one Redis client in the platform (plan 0028, section 4).
 *
 * Four services reaching for `ioredis` independently is four different retry
 * strategies and four different opinions about what to do when it is down, so
 * connection creation, the version, the lifecycle and the health indicator all
 * live here. Callers ask for `client` and, when they need a subscription, for a
 * `duplicate('pubsub', ...)`.
 *
 * Every connection this service hands out is tracked, so shutdown closes all of
 * them: an un quit connection keeps the process alive past `app.close()` and
 * turns a graceful SIGTERM into a SIGKILL thirty seconds later.
 */
@Injectable()
export class RedisService implements OnApplicationShutdown {
  /** The ordinary command connection. Fails fast rather than queueing. */
  readonly client: Redis;

  private readonly connections: Redis[] = [];

  constructor(
    private readonly url: string,
    private readonly logger: Logger
  ) {
    this.client = this.createConnection('command', 'luna-command');
  }

  /**
   * A second, independent connection.
   *
   * The socket.io adapter needs one because a connection in subscribe mode
   * cannot issue other commands, which is the rule this method exists to encode
   * once rather than have each caller rediscover it (plan 0028, section 4).
   */
  duplicate(role: RedisConnectionRole, connectionName: string): Redis {
    return this.createConnection(role, connectionName);
  }

  /**
   * Run a Redis command, answering `undefined` when Redis cannot serve it.
   *
   * This is the shape of every caller that degrades rather than fails (plan
   * 0028, section 5): presence broadcasts an empty room, a cache misses through
   * to its origin. It deliberately does **not** suit the throttler, which fails
   * closed and therefore has to see the error itself.
   */
  async tryCommand<T>(
    operation: (client: Redis) => Promise<T>,
    context: string
  ): Promise<T | undefined> {
    try {
      return await operation(this.client);
    } catch (err) {
      this.logger.warn({ err, context }, 'redis command failed, degrading');
      return undefined;
    }
  }

  /** Whether the command connection is currently usable. */
  get isConnected(): boolean {
    return this.client.status === 'ready';
  }

  /**
   * Resolve once the command connection is usable, or once the wait runs out.
   *
   * There is a real window at startup: `enableOfflineQueue` is off, so a command
   * issued between construction and the first `ready` is rejected outright
   * rather than queued. That is the behaviour the request path wants (see
   * {@link createRedisOptions}), and it is the wrong behaviour for boot, where
   * the caller has nothing to degrade to yet and is simply early.
   *
   * It resolves rather than rejects on a timeout, and that is deliberate: a
   * service must still start when Redis is down. Section 5 gives each caller a
   * documented degraded mode, and none of them is "refuse to boot". What the
   * wait buys is that the ordinary case, Redis up and answering in a few
   * milliseconds, never sees a spurious failure on the first command.
   */
  async whenReady(timeoutMs = 5_000): Promise<boolean> {
    if (this.isConnected) {
      return true;
    }

    const ready = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.client.off('ready', onReady);
        resolve(false);
      }, timeoutMs);

      const onReady = () => {
        clearTimeout(timer);
        resolve(true);
      };

      this.client.once('ready', onReady);
    });

    if (!ready) {
      this.logger.warn(
        { timeoutMs },
        'redis was not ready in time; starting degraded'
      );
    }
    return ready;
  }

  /**
   * Terminus indicator. Realtime and the gateway both gate readiness on it: the
   * first because cross pod fan out is broken without it, the second because a
   * gateway with no working limiter is the outcome section 5 refuses.
   */
  async check(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.client.ping();
      return { [key]: { status: 'up' } };
    } catch (err) {
      const status: HealthIndicatorResult = {
        [key]: { status: 'down', message: (err as Error).message },
      };
      throw new HealthCheckError('Redis is unreachable', status);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(
      this.connections.map(async (connection) => {
        try {
          await connection.quit();
        } catch {
          // Already gone, or never connected. Either way there is nothing to
          // close and nothing worth reporting during shutdown.
          connection.disconnect();
        }
      })
    );
  }

  private createConnection(
    role: RedisConnectionRole,
    connectionName: string
  ): Redis {
    const connection = new Redis(
      this.url,
      createRedisOptions(role, connectionName)
    );

    // ioredis emits `error` on every failed reconnect attempt, and an EventEmitter
    // with no `error` listener throws. Logging at warn rather than error: a
    // reconnect loop is noisy by nature and the outage itself is reported by the
    // readiness probe, which is the signal worth paging on.
    connection.on('error', (err: Error) => {
      this.logger.warn({ err, connectionName }, 'redis connection error');
    });
    connection.on('ready', () => {
      this.logger.log({ connectionName }, 'redis connection ready');
    });

    this.connections.push(connection);
    return connection;
  }
}
