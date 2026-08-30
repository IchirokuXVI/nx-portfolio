// Starts the OpenTelemetry SDK (plan 0016, section 4.1). It MUST stay the first
// import of this file: the auto instrumentations patch modules as they are
// required, so anything imported above it (@nestjs/core, http, undici) is already
// resolved, never patched, and silently missing from every trace. A bare side
// effect import is a barrier to organize-imports, so a format cannot move it.
import '@portfolio/luna-shopper/platform/tracing';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { bootstrapPlatform } from '@portfolio/luna-shopper/platform';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app/app.module';
import type { AssistantConfig } from './app/config/app-config';

/**
 * Assistant service (plan 0039): takes a question in ordinary language and
 * answers it, and can do exactly three things on the caller's behalf — put
 * something on a list, report on lists, and change the caller's own username.
 *
 * It exists as its own service for the reasons backlog 0005 section 3 gave: it
 * holds a provider credential nothing else needs, its failure mode is a slow or
 * absent third party and must not become the gateway's failure mode, and its
 * profile is a few long requests rather than many short ones.
 *
 * Like auth, core, catalog and the harvester it is a NATS microservice with only
 * a small HTTP health port, and it has **no route of its own**: the client
 * reaches it through the gateway at `/v1/assistant`, so this service adds no
 * hostname, no certificate and no CORS origin in either environment.
 *
 * The thing that makes it unlike every other service here is what it does *not*
 * hold: no database connection, no service account, and no token of its own. It
 * is an API client that carries the caller's `Authorization` header verbatim, and
 * that is rule A1 (section 2).
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const config = app
    .get(ConfigService)
    .getOrThrow<AssistantConfig>('assistant');

  app.connectMicroservice<MicroserviceOptions>(
    {
      transport: Transport.NATS,
      options: {
        servers: [config.natsUrl],
        // The queue group. Without it every replica receives every message, so
        // at replicaCount 2 each turn would be answered twice, which means two
        // provider calls out of a shared free tier quota for one question.
        queue: 'luna-shopper-backend-assistant',
      },
    },
    { inheritAppConfig: true }
  );

  bootstrapPlatform(app);

  await app.startAllMicroservices();
  await app.listen(config.port);

  const logger = app.get(Logger);
  logger.log(
    `luna-shopper-backend-assistant bound to NATS; health on http://localhost:${config.port}/health/live`
  );
  if (config.geminiApiKey.length === 0) {
    logger.warn(
      'GEMINI_API_KEY is empty: the service is up and healthy, and every turn ' +
        'answers 501 not_configured. This is a supported deployment (plan 0026).'
    );
  }
}

bootstrap();
