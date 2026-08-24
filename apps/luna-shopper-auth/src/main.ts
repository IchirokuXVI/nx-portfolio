import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app/app.module';

/**
 * Identity provider. It is primarily a NATS microservice (it answers commands
 * and publishes identity events over the broker) and exposes only a small HTTP
 * port for health probes, not a public REST surface. Message handlers, the
 * database and token signing arrive in later plans.
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

  const healthPort = process.env.HEALTH_PORT ?? 3002;
  await app.listen(healthPort);

  Logger.log(
    `luna-shopper-auth bound to NATS; health on http://localhost:${healthPort}/health`,
    'Bootstrap'
  );
}

bootstrap();
