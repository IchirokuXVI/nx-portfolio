// Starts the OpenTelemetry SDK (plan 0016, section 4.1). It MUST stay the first
// import of this file: the auto instrumentations patch modules as they are
// required, so anything imported above it (@nestjs/core, http, pg) is already
// resolved, never patched, and silently missing from every trace. A bare side
// effect import is a barrier to organize-imports, so a format cannot move it.
import '@portfolio/luna-shopper/platform/tracing';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { bootstrapPlatform } from '@portfolio/luna-shopper/platform';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app/app.module';
import type { RealtimeConfig } from './app/config/app-config';

/**
 * Dedicated realtime server. It holds the client WebSocket/SSE connections and
 * fans out domain events it consumes from the broker. The socket.io gateway and
 * its NATS subscriptions are built in plan 0009; here it boots an HTTP app (which
 * also carries the socket server once it exists) with the platform conventions
 * (plan 0004): pino logging, the correlation context, the exception filter and
 * graceful shutdown.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const config = app.get(ConfigService).getOrThrow<RealtimeConfig>('realtime');

  if (config.corsOrigins.length > 0) {
    app.enableCors({ origin: config.corsOrigins, credentials: true });
  }

  // pino logging, correlation middleware and shutdown hooks. On SIGTERM readiness
  // flips to not ready so clients reconnect elsewhere and no session is dropped.
  // URI versioning is on for the SSE endpoints (`/v1/zones/:id/stream`, plan
  // 0009, section 3); the socket transport is unversioned.
  bootstrapPlatform(app, { versioning: true });

  await app.listen(config.port);

  app
    .get(Logger)
    .log(
      `luna-shopper-backend-realtime listening on http://localhost:${config.port}`
    );
}

bootstrap();
