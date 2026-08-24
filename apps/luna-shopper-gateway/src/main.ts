import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';

/**
 * Public HTTP entry point. Request logging, error envelopes, API versioning and
 * Swagger are layered on in plan 0004; the broker request/reply wiring to auth
 * and core lands with the service plans. For now it boots and answers /health.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  Logger.log(
    `luna-shopper-gateway listening on http://localhost:${port}`,
    'Bootstrap'
  );
}

bootstrap();
