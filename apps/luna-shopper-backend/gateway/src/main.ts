// Starts the OpenTelemetry SDK (plan 0016, section 4.1). It MUST stay the first
// import of this file: the auto instrumentations patch modules as they are
// required, so anything imported above it (@nestjs/core, http, pg) is already
// resolved, never patched, and silently missing from every trace. A bare side
// effect import is a barrier to organize-imports, so a format cannot move it.
import '@portfolio/luna-shopper/platform/tracing';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import {
  bootstrapPlatform,
  setupSwagger,
} from '@portfolio/luna-shopper/platform';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app/app.module';
import type { GatewayConfig } from './app/config/app-config';
import { gatewaySwaggerOptions } from './app/docs';

/**
 * Public HTTP entry point. The platform conventions (plan 0004) supply request
 * logging, the correlation context, the problem+json error envelope, URI API
 * versioning and graceful shutdown; Swagger documents the public surface. The
 * broker request/reply wiring to auth and core lands with the service plans.
 */
async function bootstrap() {
  // Buffer logs until the pino logger is installed, so early boot lines share the
  // same structured format instead of Nest's default console logger.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const config = app.get(ConfigService).getOrThrow<GatewayConfig>('gateway');

  if (config.corsOrigins.length > 0) {
    app.enableCors({ origin: config.corsOrigins, credentials: true });
  }

  // pino logging, correlation middleware, URI versioning and shutdown hooks.
  bootstrapPlatform(app, { versioning: true });

  // The same options the committed `docs/openapi.json` is generated from, so the
  // live docs and the published artifact can never describe different APIs.
  setupSwagger(app, gatewaySwaggerOptions());

  await app.listen(config.port);

  app
    .get(Logger)
    .log(
      `luna-shopper-backend-gateway listening on http://localhost:${config.port}`
    );
}

bootstrap();
