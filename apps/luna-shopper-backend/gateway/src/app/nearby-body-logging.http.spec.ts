import {
  Body,
  Controller,
  Module,
  Post,
  type ExecutionContext,
  type INestApplication,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  BASKET_PATTERNS,
  NearbyShopNoPick,
  SUPERMARKET_LOCATION_PATTERNS,
} from '@portfolio/luna-shopper/contracts';
import {
  bootstrapPlatform,
  createLoggerOptions,
  createValidationPipe,
  GlobalExceptionFilter,
  isBodyWithheld,
} from '@portfolio/luna-shopper/platform';
import { InjectPinoLogger, LoggerModule, PinoLogger } from 'nestjs-pino';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { BasketShopsController } from './baskets/basket-shops.controller';
import { GatewayBasketsModule } from './baskets/baskets.module';
import { ParticipantGuard } from './baskets/participant.guard';
import { GatewayCatalogModule } from './catalog/catalog.module';
import { CatalogNearbyShopsController } from './catalog/nearby-shops.controller';
import { ScopeResolutionService } from './catalog/scope-resolution.service';
import { NatsClient } from './messaging/nats-client';

/**
 * The body of a nearby request never appears in a log line (plan 0164,
 * constraints).
 *
 * Over real HTTP, through the platform's own logger configuration, the
 * correlation middleware, URI versioning, the validation pipe and the global
 * exception filter, which are every place a request is written down. Every
 * line pino writes is captured, at `trace`, and searched for the digits of the
 * point.
 *
 * Two layers keep the body out, and both are exercised here:
 *
 * - pino-http's request serializer, which prints the method, the URL, the
 *   parameters and the headers of a request, and never its body. That covers
 *   the request lines and the error filter's line alike.
 * - `WithholdBodyMiddleware`, which the **real** modules apply to the two
 *   routes, so the filter prints a marker in place of the body even if a
 *   serializer changes. The guards below record that the request was already
 *   marked when they ran, which proves the middleware runs before any guard
 *   on the versioned route. `withheld-body.spec.ts` in the platform proves the
 *   filter's half.
 *
 * The control at the end is a handler that logs its own body, so a harness
 * that captured nothing, or captured lines without their fields, would fail
 * there.
 */

/** A point whose digits appear nowhere else in a request. */
const POINT = { latitude: 37.884713, longitude: -4.779261, accuracyMetres: 17 };
const DIGITS = ['37.884713', '4.779261', '884713', '779261'];

const BASKET = '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const OWNER = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

/** A route nobody marked, whose handler writes its body to the log. */
@Controller({ path: 'control', version: '1' })
class ControlController {
  constructor(
    @InjectPinoLogger('ControlController')
    private readonly logger: PinoLogger
  ) {}

  @Post()
  echo(@Body() body: unknown): { ok: true } {
    this.logger.info({ echo: body }, 'control route');
    return { ok: true };
  }
}

async function boot(options: { guardFails?: boolean; catalogFails?: boolean }) {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  const sent: { subject: string; payload: unknown }[] = [];
  /** Whether each guard saw a request already marked, in the order they ran. */
  const markedAtGuard: boolean[] = [];

  const nats = {
    send: async (subject: string, payload: unknown) => {
      sent.push({ subject, payload });
      if (subject === BASKET_PATTERNS.searchScope) {
        return {
          ownerUserId: OWNER,
          profileId: null,
          servesLocations: true,
          supermarketLocationId: null,
        };
      }
      if (options.catalogFails) {
        throw new Error('the broker did not answer');
      }
      return {
        candidates: [],
        pick: null,
        noPick: NearbyShopNoPick.NONE_NEARBY,
      };
    },
  };
  const scopes = {
    forShops: async () => ({
      profileId: null,
      postalCodes: [],
      excludedSupermarketIds: [],
      excludedSupermarketLocationIds: [],
    }),
  };

  /**
   * The two nearby controllers and a control, with the middleware applied by
   * the real modules' `configure`. Middleware applies by path, so which module
   * holds a controller does not change which requests it marks.
   */
  @Module({
    imports: [
      LoggerModule.forRoot({
        pinoHttp: [
          createLoggerOptions({
            serviceName: 'gateway-logging-spec',
            level: 'trace',
            pretty: false,
          }).pinoHttp as object,
          stream,
        ],
      }),
    ],
    controllers: [
      CatalogNearbyShopsController,
      BasketShopsController,
      ControlController,
    ],
    providers: [
      { provide: NatsClient, useValue: nats },
      { provide: ScopeResolutionService, useValue: scopes },
      { provide: APP_FILTER, useClass: GlobalExceptionFilter },
      { provide: APP_PIPE, useFactory: createValidationPipe },
    ],
  })
  class HarnessModule implements NestModule {
    configure(consumer: MiddlewareConsumer): void {
      new GatewayCatalogModule().configure(consumer);
      new GatewayBasketsModule().configure(consumer);
    }
  }

  const app: INestApplication = (
    await Test.createTestingModule({ imports: [HarnessModule] })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest();
          markedAtGuard.push(isBodyWithheld(req));
          req['user'] = { userId: OWNER, kind: 'REGISTERED' };
          return true;
        },
      })
      .overrideGuard(ParticipantGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest();
          markedAtGuard.push(isBodyWithheld(req));
          if (options.guardFails) {
            throw new Error('core did not answer the participant check');
          }
          req['participant'] = {
            participantId: 'participant-1',
            basketId: BASKET,
            userId: OWNER,
          };
          return true;
        },
      })
      .compile()
  ).createNestApplication({ bufferLogs: true });

  bootstrapPlatform(app, { versioning: true });
  await app.init();
  await app.listen(0);
  const { port } = app.getHttpServer().address() as AddressInfo;
  return {
    app,
    lines,
    sent,
    markedAtGuard,
    origin: `http://127.0.0.1:${port}`,
  };
}

async function post(origin: string, path: string, body: unknown) {
  return fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Every captured line that holds any digit run of the point. */
function leaks(lines: readonly string[]): string[] {
  return lines.filter((line) => DIGITS.some((digits) => line.includes(digits)));
}

describe('the body of a nearby request never reaches a log line (plan 0164)', () => {
  const routes = [
    ['POST /v1/catalog/shops/nearby', '/v1/catalog/shops/nearby'],
    ['POST /v1/baskets/:id/shops/nearby', `/v1/baskets/${BASKET}/shops/nearby`],
  ] as const;

  it.each(routes)('%s, answered', async (_name, path) => {
    const { app, lines, sent, markedAtGuard, origin } = await boot({});
    try {
      const res = await post(origin, path, POINT);

      expect(res.status).toBe(201);
      // The point did travel, once, to catalog, and nowhere else.
      expect(
        sent.filter((s) => s.subject === SUPERMARKET_LOCATION_PATTERNS.nearby)
      ).toEqual([
        {
          subject: SUPERMARKET_LOCATION_PATTERNS.nearby,
          payload: expect.objectContaining(POINT),
        },
      ]);
      expect(markedAtGuard).toEqual([true]);
      expect(lines.length).toBeGreaterThan(0);
      expect(leaks(lines)).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it.each(routes)(
    '%s, failing with a 500 in the handler',
    async (_name, path) => {
      const { app, lines, origin } = await boot({ catalogFails: true });
      try {
        const res = await post(origin, path, POINT);

        expect(res.status).toBe(500);
        expect(
          lines.filter((line) =>
            line.includes('Unhandled error while processing request')
          )
        ).toHaveLength(1);
        expect(leaks(lines)).toEqual([]);
      } finally {
        await app.close();
      }
    }
  );

  it('POST /v1/baskets/:id/shops/nearby, failing with a 500 in the guard', async () => {
    const { app, lines, sent, markedAtGuard, origin } = await boot({
      guardFails: true,
    });
    try {
      const res = await post(
        origin,
        `/v1/baskets/${BASKET}/shops/nearby`,
        POINT
      );

      expect(res.status).toBe(500);
      expect(sent).toEqual([]);
      // Marked before the guard that failed.
      expect(markedAtGuard).toEqual([true]);
      expect(leaks(lines)).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it.each(routes)(
    '%s, refused by validation, echoes the point neither in a log nor in the answer',
    async (_name, path) => {
      const { app, lines, sent, origin } = await boot({});
      try {
        const res = await post(origin, path, {
          ...POINT,
          latitude: 97.884713,
        });

        expect(res.status).toBe(400);
        const answer = await res.text();
        expect(DIGITS.some((digits) => answer.includes(digits))).toBe(false);
        expect(sent).toEqual([]);
        expect(leaks(lines)).toEqual([]);
      } finally {
        await app.close();
      }
    }
  );

  it('does capture a body a handler logs, so the search above is real', async () => {
    const { app, lines, markedAtGuard, origin } = await boot({});
    try {
      const res = await post(origin, '/v1/control', POINT);

      expect(res.status).toBe(201);
      expect(markedAtGuard).toEqual([]);
      expect(leaks(lines).length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });
});
