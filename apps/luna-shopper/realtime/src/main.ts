import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import type { RealtimeConfig } from './app/config/app-config';

/**
 * Dedicated realtime server. It holds the client WebSocket/SSE connections and
 * fans out domain events it consumes from the broker. The socket.io gateway and
 * its NATS subscriptions are built in plan 0009; here it only boots an HTTP app
 * (which also carries the socket server once it exists) and answers /health.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = app.get(ConfigService).getOrThrow<RealtimeConfig>('realtime');

  if (config.corsOrigins.length > 0) {
    app.enableCors({ origin: config.corsOrigins, credentials: true });
  }

  // Graceful shutdown (plan 0002, section 6). On SIGTERM the pod stops accepting
  // new sockets and closes cleanly; socket.io clients auto reconnect to a
  // healthy pod, so a rolling update drops no sessions.
  app.enableShutdownHooks();

  await app.listen(config.port);

  Logger.log(
    `luna-shopper-realtime listening on http://localhost:${config.port}`,
    'Bootstrap'
  );
}

bootstrap();
