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
import type { HarvesterConfig } from './app/config/app-config';

/**
 * Harvester service (plan 0038): the one component whose job is to make
 * thousands of outbound calls to third parties, fetch prices and store locations,
 * and write what it finds into catalog.
 *
 * It exists as its own service for a measured reason rather than an architectural
 * one (section 1): a catalog discovery run is 4,383 requests and tens of minutes
 * of continuous fetching, catalog must be free to roll at any time, and a rollout
 * would kill that run every time. The cost accepted in exchange is a third
 * database, a Helm entry and a CI target.
 *
 * Like auth, core and catalog it is a NATS microservice with only a small HTTP
 * health port, never a public REST surface, and it has **no route of its own**:
 * its callers are the gateway and itself.
 *
 * Shutdown hooks are enabled because they carry real work here: SIGTERM aborts
 * every in flight run through its `AbortSignal`, which flushes what was already
 * fetched rather than discarding it (section 6.6).
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const config = app.get(ConfigService).getOrThrow<HarvesterConfig>('harvester');

  app.connectMicroservice<MicroserviceOptions>(
    {
      transport: Transport.NATS,
      options: {
        servers: [config.natsUrl],
        // The queue group. Without it every replica receives every message, so
        // at replicaCount 2 each request is handled twice, which for `spawn`
        // would mean two runs racing for one lock.
        queue: 'luna-shopper-backend-harvester',
      },
    },
    { inheritAppConfig: true }
  );

  bootstrapPlatform(app);

  await app.startAllMicroservices();
  await app.listen(config.port);

  const logger = app.get(Logger);
  logger.log(
    `luna-shopper-backend-harvester bound to NATS; health on http://localhost:${config.port}/health/live`
  );
  if (!config.harvestEnabled) {
    logger.warn(
      'HARVEST_ENABLED is false: no run will start and nothing will be ' +
        'fetched from any third party. This is the default.'
    );
  }
}

bootstrap();
