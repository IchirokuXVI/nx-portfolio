import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { bootstrapPlatform } from '@portfolio/luna-shopper/platform';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app/app.module';
import type { CoreConfig } from './app/config/app-config';

/**
 * Domain service (zones, lists, lines, comments, merges). Like auth it is a NATS
 * microservice with only a small HTTP health port, never a public REST surface.
 * It references users purely by userId and never reads the auth database. The
 * platform conventions (plan 0004) supply pino logging, the correlation context,
 * the global exception filter and graceful shutdown. Message handlers, the
 * database and domain events arrive in later plans.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

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

  // pino logging, correlation middleware (for the health port) and shutdown hooks
  // that close the broker subscriptions and the DB pool on SIGTERM.
  bootstrapPlatform(app);

  await app.startAllMicroservices();
  await app.listen(config.port);

  app
    .get(Logger)
    .log(
      `luna-shopper-backend-core bound to NATS; health on http://localhost:${config.port}/health/live`
    );
}

bootstrap();
