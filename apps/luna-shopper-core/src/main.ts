import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app/app.module';

/**
 * Domain service (zones, lists, lines, comments, merges). Like auth it is a NATS
 * microservice with only a small HTTP health port, never a public REST surface.
 * It references users purely by userId and never reads the auth database. Message
 * handlers, the database and domain events arrive in later plans.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.connectMicroservice<MicroserviceOptions>(
    {
      transport: Transport.NATS,
      options: {
        servers: [process.env.NATS_URL ?? 'nats://localhost:4222'],
      },
    },
    { inheritAppConfig: true }
  );

  await app.startAllMicroservices();

  const healthPort = process.env.HEALTH_PORT ?? 3003;
  await app.listen(healthPort);

  Logger.log(
    `luna-shopper-core bound to NATS; health on http://localhost:${healthPort}/health`,
    'Bootstrap'
  );
}

bootstrap();
