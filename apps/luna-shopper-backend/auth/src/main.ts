// Starts the OpenTelemetry SDK (plan 0016, section 4.1). It MUST stay the first
// import of this file: the auto instrumentations patch modules as they are
// required, so anything imported above it (@nestjs/core, http, pg) is already
// resolved, never patched, and silently missing from every trace. A bare side
// effect import is a barrier to organize-imports, so a format cannot move it.
import '@portfolio/luna-shopper/platform/tracing';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { bootstrapPlatform } from '@portfolio/luna-shopper/platform';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app/app.module';
import type { AuthConfig } from './app/config/app-config';

/**
 * Identity provider. It is primarily a NATS microservice (it answers commands
 * and publishes identity events over the broker) and exposes only a small HTTP
 * port for health probes, not a public REST surface. The platform conventions
 * (plan 0004) supply pino logging, the correlation context, the global exception
 * filter and graceful shutdown. Message handlers, the database and token signing
 * arrive in later plans.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const config = app.get(ConfigService).getOrThrow<AuthConfig>('auth');

  app.connectMicroservice<MicroserviceOptions>(
    {
      transport: Transport.NATS,
      options: {
        servers: [config.natsUrl],
      },
    },
    { inheritAppConfig: true }
  );

  // pino logging, correlation middleware (for the health port) and shutdown hooks
  // that close the broker subscriptions and the DB pool on SIGTERM.
  bootstrapPlatform(app);

  await app.startAllMicroservices();
  await app.listen(config.port);

  app
    .get(Logger)
    .log(
      `luna-shopper-backend-auth bound to NATS; health on http://localhost:${config.port}/health/live`
    );
}

bootstrap();
