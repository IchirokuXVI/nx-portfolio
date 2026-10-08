import { Test } from '@nestjs/testing';
import {
  ITEM_PATTERNS,
  PRICE_HISTORY_LIMITS,
} from '@portfolio/luna-shopper/contracts';
import { createValidationPipe } from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NatsClient } from '../messaging/nats-client';
import { CatalogItemsController } from './catalog.controller';
import {
  ScopeResolutionService,
  type ScopeQuery,
} from './scope-resolution.service';

/**
 * The three orders and the price history of plan 0196, over real HTTP.
 *
 * What has to be true about a query parameter is that the request reaches
 * the handler. The gateway's `ValidationPipe` runs with `whitelist` and
 * `forbidNonWhitelisted` and validates the whole query object against the
 * declared DTO, so a value the class does not list is a 400 however
 * correctly the handler reads it. A controller called as a function never
 * meets that pipe. `catalog-admin-query.http.spec.ts` says the same at
 * length.
 */

interface SentMessage {
  readonly subject: unknown;
  readonly payload: Record<string, unknown>;
}

const ITEM = 'cf000000-0000-4000-a000-0000000000aa';
const RESOLVED_SCOPE = 'aa000000-0000-4000-a000-000000000001';
const NAMED_SCOPE = 'aa000000-0000-4000-a000-000000000002';

async function boot() {
  const sent: SentMessage[] = [];
  const resolved: ScopeQuery[] = [];
  // What the resolver answers next. A case that needs many scopes sets it.
  const scopes = { next: [RESOLVED_SCOPE] };

  const nest = (
    await Test.createTestingModule({
      controllers: [CatalogItemsController],
      providers: [
        {
          provide: NatsClient,
          useValue: {
            send: async (
              subject: unknown,
              payload: Record<string, unknown>
            ) => {
              sent.push({ subject, payload });
              return subject === ITEM_PATTERNS.priceHistory
                ? { itemId: payload['itemId'], from: '', to: '', series: [] }
                : { items: [], nextCursor: null };
            },
          },
        },
        {
          provide: ScopeResolutionService,
          useValue: {
            forRead: async (_userId: string, query: ScopeQuery) => {
              resolved.push(query);
              return scopes.next;
            },
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp(): { getRequest(): Record<string, unknown> };
        }) => {
          context.switchToHttp().getRequest()['user'] = { userId: 'user-1' };
          return true;
        },
      })
      .compile()
  ).createNestApplication();

  nest.useGlobalPipes(createValidationPipe());
  nest.setGlobalPrefix('v1');

  await nest.init();
  await nest.listen(0);
  const { port } = nest.getHttpServer().address() as AddressInfo;

  return {
    nest,
    sent,
    resolved,
    scopes,
    origin: `http://127.0.0.1:${port}`,
  };
}

describe('plan 0196 over HTTP', () => {
  let app: Awaited<ReturnType<typeof boot>>;

  beforeAll(async () => {
    app = await boot();
  });

  afterAll(async () => {
    await app.nest.close();
  });

  beforeEach(() => {
    app.sent.length = 0;
    app.resolved.length = 0;
    app.scopes.next = [RESOLVED_SCOPE];
  });

  /** The one message of a subject that the route sent. */
  function payloadOf(subject: string): Record<string, unknown> {
    const message = app.sent.find((m) => m.subject === subject);
    expect(message).toBeDefined();
    return message?.payload ?? {};
  }

  describe('GET /v1/catalog/items?order', () => {
    it.each(['category', 'price', 'unitPrice'])(
      'takes order=%s and hands it on as it was spelled',
      async (order) => {
        const response = await fetch(
          `${app.origin}/v1/catalog/items?order=${order}`
        );

        expect(response.status).toBe(200);
        expect(payloadOf(ITEM_PATTERNS.search)['order']).toBe(order);
      }
    );

    it('takes a price order beside a query, a chain filter and a cursor', async () => {
      const response = await fetch(
        `${app.origin}/v1/catalog/items?order=unitPrice&query=leche&cursor=abc&limit=20`
      );

      expect(response.status).toBe(200);
      expect(payloadOf(ITEM_PATTERNS.search)).toMatchObject({
        order: 'unitPrice',
        query: 'leche',
        cursor: 'abc',
        limit: 20,
        // The scopes the price order reads are the ones the resolver gave.
        priceScopeIds: [RESOLVED_SCOPE],
      });
    });

    it('still takes the four orders it had', async () => {
      for (const order of ['relevance', 'name', 'created', 'updated']) {
        const response = await fetch(
          `${app.origin}/v1/catalog/items?order=${order}`
        );
        expect(response.status).toBe(200);
      }
    });

    it('refuses an order it does not know, and a spelling in another case', async () => {
      for (const order of ['cheapest', 'unitprice', 'unit_price', 'Price']) {
        const response = await fetch(
          `${app.origin}/v1/catalog/items?order=${order}`
        );
        expect(response.status).toBe(400);
      }
      expect(app.sent).toHaveLength(0);
    });
  });

  describe('GET /v1/catalog/items/:id/price-history', () => {
    const url = (query = '') =>
      `${app.origin}/v1/catalog/items/${ITEM}/price-history${query}`;

    it('reaches the handler with no query, and resolves the profile of the caller', async () => {
      const response = await fetch(url());

      expect(response.status).toBe(200);
      expect(payloadOf(ITEM_PATTERNS.priceHistory)).toEqual({
        userId: 'user-1',
        itemId: ITEM,
        priceScopeIds: [RESOLVED_SCOPE],
        // Absent, so the catalog service applies its defaults.
        from: undefined,
        to: undefined,
      });
      // No selector was named, so the resolver was asked with none.
      expect(app.resolved).toEqual([
        {
          priceScopeIds: undefined,
          postalCodes: undefined,
          supermarketIds: undefined,
          profileId: undefined,
        },
      ]);
    });

    it('hands both instants on as they were written', async () => {
      const from = '2026-01-01T00:00:00.000Z';
      const to = '2026-06-30T23:59:59.999Z';

      const response = await fetch(
        url(`?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      );

      expect(response.status).toBe(200);
      expect(payloadOf(ITEM_PATTERNS.priceHistory)).toMatchObject({
        from,
        to,
      });
    });

    it('takes the scope selectors of every priced read', async () => {
      const response = await fetch(
        url(`?priceScopeId=${NAMED_SCOPE}&postalCode=28001`)
      );

      expect(response.status).toBe(200);
      expect(app.resolved[0]).toMatchObject({
        priceScopeIds: [NAMED_SCOPE],
        postalCodes: ['28001'],
      });
      // What the resolver answered is what travels, never the selector.
      expect(payloadOf(ITEM_PATTERNS.priceHistory)['priceScopeIds']).toEqual([
        RESOLVED_SCOPE,
      ]);
    });

    it('sends at most fifty scopes, the first of the resolution', async () => {
      const many = Array.from(
        { length: PRICE_HISTORY_LIMITS.maxScopes + 7 },
        (_, i) =>
          `aa000000-0000-4000-a000-0000000001${String(i).padStart(2, '0')}`
      );
      app.scopes.next = many;

      const response = await fetch(url());

      expect(response.status).toBe(200);
      expect(payloadOf(ITEM_PATTERNS.priceHistory)['priceScopeIds']).toEqual(
        many.slice(0, PRICE_HISTORY_LIMITS.maxScopes)
      );
    });

    it('sends an empty list when the caller resolves to no scope', async () => {
      app.scopes.next = [];

      const response = await fetch(url());

      expect(response.status).toBe(200);
      expect(payloadOf(ITEM_PATTERNS.priceHistory)['priceScopeIds']).toEqual(
        []
      );
    });

    it('refuses an instant that is not ISO 8601', async () => {
      for (const query of ['?from=yesterday', '?to=not-a-date']) {
        const response = await fetch(url(query));
        expect(response.status).toBe(400);
      }
      expect(app.sent).toHaveLength(0);
    });

    it('refuses a parameter the route does not name', async () => {
      const response = await fetch(url('?days=30'));

      expect(response.status).toBe(400);
      expect(app.sent).toHaveLength(0);
    });

    it('refuses an id that is not a uuid', async () => {
      const response = await fetch(
        `${app.origin}/v1/catalog/items/milk/price-history`
      );

      expect(response.status).toBe(400);
      expect(app.sent).toHaveLength(0);
    });

    it('is not swallowed by the route that reads one product', async () => {
      await fetch(url());

      expect(app.sent.map((message) => message.subject)).toEqual([
        ITEM_PATTERNS.priceHistory,
      ]);
    });
  });
});
