import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { RedisService } from '@portfolio/luna-shopper/platform';
import { createAdapter } from '@socket.io/redis-adapter';
import type { ServerOptions } from 'socket.io';

/**
 * The socket.io Redis adapter (plan 0028, section 2.1).
 *
 * This is the one change `replicaCount: 2` strictly requires. On socket.io's
 * default in memory adapter, a broadcast to `zone:{id}` reaches only the sockets
 * held by the pod that emitted it, and an HTTP long polling handshake whose
 * several requests land on different pods fails outright. With the adapter, room
 * bookkeeping and the handshake are shared through Redis.
 *
 * It is installed as an `IoAdapter` subclass rather than inside the gateway
 * because the gateway's `@WebSocketServer()` server has to be **created** with
 * the adapter already attached; attaching afterwards leaves the sockets that
 * connected in between on the local adapter.
 *
 * Two connections, not one, and the reason is a Redis rule rather than a
 * performance choice: a connection in subscribe mode cannot issue any other
 * command, so the subscriber has to be separate from the publisher. Both come
 * from {@link RedisService} so the retry behaviour is the platform's single
 * opinion (section 4).
 *
 * Note what this adapter is deliberately **not** carrying. Domain events do not
 * reach other pods through it: they cross exactly once, through the relay's own
 * Redis channel, and the gateway emits them with `server.local.to(...)` so the
 * adapter does not fan the same event out a second time (section 2.3). What the
 * adapter carries here is the handshake and the room bookkeeping, which is still
 * why it must exist.
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(
    app: INestApplicationContext,
    private readonly redis: RedisService
  ) {
    super(app);
  }

  /** Build the adapter factory. Call before the server is created. */
  connect(): void {
    const pubClient = this.redis.duplicate('pubsub', 'luna-socket-pub');
    const subClient = this.redis.duplicate('pubsub', 'luna-socket-sub');
    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  override createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
