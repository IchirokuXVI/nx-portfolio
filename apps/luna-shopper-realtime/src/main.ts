import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';

/**
 * Dedicated realtime server. It holds the client WebSocket/SSE connections and
 * fans out domain events it consumes from the broker. The socket.io gateway and
 * its NATS subscriptions are built in plan 0009; here it only boots an HTTP app
 * (which also carries the socket server once it exists) and answers /health.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const port = process.env.PORT ?? 3001;
  await app.listen(port);

  Logger.log(
    `luna-shopper-realtime listening on http://localhost:${port}`,
    'Bootstrap'
  );
}

bootstrap();
