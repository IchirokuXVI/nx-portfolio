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
  MIN_CLIENT_VERSION_HEADER,
  setupSwagger,
} from '@portfolio/luna-shopper/platform';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app/app.module';
import {
  DEFAULT_JSON_MAX_BYTES,
  type GatewayConfig,
} from './app/config/app-config';
import { gatewaySwaggerOptions } from './app/docs';
import { bodyParserProblems, jsonBodyParsers } from './app/harvest/import-body';

/**
 * Public HTTP entry point. The platform conventions (plan 0004) supply request
 * logging, the correlation context, the problem+json error envelope, URI API
 * versioning and graceful shutdown; Swagger documents the public surface. The
 * broker request/reply wiring to auth and core lands with the service plans.
 */
async function bootstrap() {
  // Buffer logs until the pino logger is installed, so early boot lines share the
  // same structured format instead of Nest's default console logger.
  //
  // `bodyParser: false` because one route needs a larger body than the rest of
  // the surface (plan 0081, section 7; plan 0086, section 10). Nest's built in
  // parser is one global `express.json()` at a limit the app cannot vary per
  // route, and its default is 100 KB, so every real uploaded file would be
  // refused with a bare 413. The parsers are mounted by hand below instead,
  // largest path first.
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });

  const config = app.get(ConfigService).getOrThrow<GatewayConfig>('gateway');

  if (config.corsOrigins.length > 0) {
    app.enableCors({
      origin: config.corsOrigins,
      credentials: true,
      // Without this the browser hides the header and the client never learns the
      // floor (velista plan 0034, D8). A cross origin response exposes only the CORS
      // safelisted headers by default, which is the same trap that put
      // `retryAfterSeconds` in the problem document body rather than in
      // `Retry-After`. Here the body is the wrong place, because the advisory
      // belongs on every response and not on every DTO.
      exposedHeaders: [MIN_CLIENT_VERSION_HEADER],
    });
  }

  // pino logging, correlation middleware, URI versioning and shutdown hooks.
  // Before the parsers, so a body refused by one still carries the correlation
  // id its problem document names.
  bootstrapPlatform(app, { versioning: true });

  // The import route's own limit, then the default for everything else, then
  // the handler that turns a parser's own refusal into the house envelope with
  // the number in it. Order is load bearing: `express.json` marks the request
  // as parsed, so a later parser returns immediately and the first limit wins.
  const bodyLimits = {
    importMaxBytes: config.importMaxBytes,
    defaultMaxBytes: DEFAULT_JSON_MAX_BYTES,
  };
  for (const parser of jsonBodyParsers(bodyLimits)) {
    if (parser.path) {
      app.use(parser.path, parser.handler);
    } else {
      app.use(parser.handler);
    }
  }
  app.use(bodyParserProblems(bodyLimits));

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
