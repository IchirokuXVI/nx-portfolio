import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app/app.module';
import type { CoreConfig } from './app/config/app-config';

/**
 * Domain service (zones, lists, lines, comments, merges). Like auth it is a NATS
 * microservice with only a small HTTP health port, never a public REST surface.
 * It references users purely by userId and never reads the auth database. Message
 * handlers, the database and domain events arrive in later plans.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = app.get(ConfigService).getOrThrow<CoreConfig>('core');

  app.connectMicroservice<MicroserviceOptions>(
    {
      transport: Transport.NATS,
      options: {
        servers: [config.natsUrl],
      },
    },
    { inheritAppConfig: true }
  );

  // Graceful shutdown (plan 0002, section 6): close the broker subscriptions and
  // the database pool on SIGTERM before the pod exits.
  app.enableShutdownHooks();

  await app.startAllMicroservices();
  await app.listen(config.port);

  Logger.log(
    `luna-shopper-core bound to NATS; health on http://localhost:${config.port}/health`,
    'Bootstrap'
  );
}

bootstrap();
