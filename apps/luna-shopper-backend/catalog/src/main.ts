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
import type { CatalogConfig } from './app/config/app-config';

/**
 * Catalog service (plan 0012): owner curated reference data — items,
 * supermarkets, and per location prices/positions — read by everyone. Like auth
 * and core it is a NATS microservice with only a small HTTP health port, never a
 * public REST surface (the gateway owns REST). It owns its own database and is
 * referenced from core only by an opaque `itemId`.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const config = app.get(ConfigService).getOrThrow<CatalogConfig>('catalog');

  app.connectMicroservice<MicroserviceOptions>(
    {
      transport: Transport.NATS,
      options: {
        servers: [config.natsUrl],
        // The queue group. See the note in the auth service: without it every
        // replica receives every message, so at replicaCount 2 each request is
        // handled twice.
        queue: 'luna-shopper-backend-catalog',
      },
    },
    { inheritAppConfig: true }
  );

  bootstrapPlatform(app);

  await app.startAllMicroservices();
  await app.listen(config.port);

  app
    .get(Logger)
    .log(
      `luna-shopper-backend-catalog bound to NATS; health on http://localhost:${config.port}/health/live`
    );
}

bootstrap();
