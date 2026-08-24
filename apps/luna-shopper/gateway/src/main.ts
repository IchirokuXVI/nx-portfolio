import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import type { GatewayConfig } from './app/config/app-config';

/**
 * Public HTTP entry point. Request logging, error envelopes, API versioning and
 * Swagger are layered on in plan 0004; the broker request/reply wiring to auth
 * and core lands with the service plans. For now it boots, validates its config
 * and answers /health.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = app.get(ConfigService).getOrThrow<GatewayConfig>('gateway');

  if (config.corsOrigins.length > 0) {
    app.enableCors({ origin: config.corsOrigins, credentials: true });
  }

  // Graceful shutdown (plan 0002, section 6): on SIGTERM Nest runs shutdown
  // hooks, stops taking new work and closes broker/DB connections before exit,
  // so a rolling update drains in flight requests instead of dropping them.
  app.enableShutdownHooks();

  await app.listen(config.port);

  Logger.log(
    `luna-shopper-gateway listening on http://localhost:${config.port}`,
    'Bootstrap'
  );
}

bootstrap();
