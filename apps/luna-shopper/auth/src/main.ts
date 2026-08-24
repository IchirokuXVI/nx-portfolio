import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app/app.module';
import type { AuthConfig } from './app/config/app-config';

/**
 * Identity provider. It is primarily a NATS microservice (it answers commands
 * and publishes identity events over the broker) and exposes only a small HTTP
 * port for health probes, not a public REST surface. Message handlers, the
 * database and token signing arrive in later plans.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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

  // Graceful shutdown (plan 0002, section 6): close the broker subscriptions and
  // the database pool on SIGTERM before the pod exits.
  app.enableShutdownHooks();

  await app.startAllMicroservices();
  await app.listen(config.port);

  Logger.log(
    `luna-shopper-auth bound to NATS; health on http://localhost:${config.port}/health`,
    'Bootstrap'
  );
}

bootstrap();
