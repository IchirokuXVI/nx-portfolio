import { Test } from '@nestjs/testing';
import { ITEM_PATTERNS } from '@portfolio/luna-shopper/contracts';
import { createValidationPipe } from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NatsClient } from '../messaging/nats-client';
import { CatalogItemsController } from './catalog.controller';
import { MAX_PRICE_SCOPES } from './catalog.dto';
import { ScopeResolutionService } from './scope-resolution.service';

/**
 * The chain filter over real HTTP (plan 0146), because what has to be true about
 * a query parameter is that the request **reaches** the handler.
 *
 * The gateway's `ValidationPipe` runs with `whitelist` and `forbidNonWhitelisted`
 * and validates the whole query object against the declared DTO, so a parameter
 * the class does not carry is a 400 however correctly the handler reads it. A
 * controller called as a function never meets that pipe and cannot see the
 * failure. The same reasoning is written out at length in
 * `catalog-admin-query.http.spec.ts`.
 *
 * The two supermarket parameters on this one URL are the other reason. They mean
 * different things, and the thing that would be silently wrong is one arriving
 * as the other, so every case here reads both out of the sent message.
 */

/** What the stub broker was last asked to send, so a spec can read it back. */
interface SentMessage {
  readonly subject: unknown;
  readonly payload: Record<string, unknown>;
}

/** The scopes the resolver answered, distinct from anything `soldBy` says. */
const RESOLVED_SCOPE = 'aa000000-0000-4000-a000-000000000001';
const MERCADONA = 'cf000000-0000-4000-a000-000000000001';
const DEZA = 'cf000000-0000-4000-a000-000000000002';

async function boot() {
  const sent: SentMessage[] = [];

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
              return { items: [], nextCursor: null };
            },
          },
        },
        {
          provide: ScopeResolutionService,
          // Fixed, so a scope in the sent message can only have come from here
          // and never from the chain filter.
          useValue: { forRead: async () => [RESOLVED_SCOPE] },
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

  return { nest, sent, origin: `http://127.0.0.1:${port}` };
}

describe('GET /v1/catalog/items?soldBy', () => {
  let app: Awaited<ReturnType<typeof boot>>;

  beforeAll(async () => {
    app = await boot();
  });

  afterAll(async () => {
    await app.nest.close();
  });

  beforeEach(() => {
    app.sent.length = 0;
  });

  /** The search message the route sent, whatever else the boot collected. */
  function searchPayload(): Record<string, unknown> {
    const message = app.sent.find((m) => m.subject === ITEM_PATTERNS.search);
    expect(message).toBeDefined();
    return message?.payload ?? {};
  }

  it('reaches the handler and travels as a list', async () => {
    const response = await fetch(
      `${app.origin}/v1/catalog/items?soldBy=${MERCADONA}`
    );

    expect(response.status).toBe(200);
    // One value is still a list, because the parameter is repeatable: a client
    // pressing a second chip must not change the shape of the request.
    expect(searchPayload()['soldBy']).toEqual([MERCADONA]);
  });

  it('carries both chains when the parameter is repeated', async () => {
    const response = await fetch(
      `${app.origin}/v1/catalog/items?soldBy=${MERCADONA}&soldBy=${DEZA}`
    );

    expect(response.status).toBe(200);
    expect(searchPayload()['soldBy']).toEqual([MERCADONA, DEZA]);
  });

  it('is not the scope selector, and neither one becomes the other', async () => {
    const response = await fetch(
      `${app.origin}/v1/catalog/items?soldBy=${MERCADONA}&supermarketId=${DEZA}`
    );

    expect(response.status).toBe(200);
    const payload = searchPayload();
    // `soldBy` is passed through untouched; `supermarketId` is resolved to
    // scopes and never appears. Two parameters naming a supermarket on one URL
    // is the confusion this route is most likely to ship, so it is asserted
    // rather than assumed.
    expect(payload['soldBy']).toEqual([MERCADONA]);
    expect(payload['priceScopeIds']).toEqual([RESOLVED_SCOPE]);
    expect(payload['supermarketId']).toBeUndefined();
  });

  it('takes a chain whose id is not a version 4 uuid', async () => {
    // Seeded chains carry version 5 ids, derived from a name (El Jamón's is one).
    // `supermarketId` and `priceScopeId` accept any version, and a chain filter
    // that refused the ids the catalog actually holds answered 400 for every chip
    // but Mercadona's (velista `0100`).
    const derived = '4b0f2e79-72e0-5f6c-bc20-3633663abafc';

    const response = await fetch(
      `${app.origin}/v1/catalog/items?soldBy=${derived}`
    );

    expect(response.status).toBe(200);
    expect(searchPayload()['soldBy']).toEqual([derived]);
  });

  it('sends nothing at all when the parameter is absent', async () => {
    const response = await fetch(`${app.origin}/v1/catalog/items`);

    expect(response.status).toBe(200);
    expect(searchPayload()['soldBy']).toBeUndefined();
  });

  it('refuses a value that is not a uuid', async () => {
    const response = await fetch(`${app.origin}/v1/catalog/items?soldBy=nope`);

    // A chain id is a uuid, and a 400 naming the parameter is a better answer
    // than a page of every product, which is what an ignored filter would be.
    expect(response.status).toBe(400);
    expect(app.sent).toHaveLength(0);
  });

  it('refuses more chains than the cap', async () => {
    const many = Array.from(
      { length: 21 },
      (_, i) =>
        `soldBy=cf000000-0000-4000-a000-0000000000${String(i).padStart(2, '0')}`
    ).join('&');

    const response = await fetch(`${app.origin}/v1/catalog/items?${many}`);

    expect(response.status).toBe(400);
  });

  describe('a chain chip names every scope of that chain', () => {
    /** `count` distinct scope ids, as velista repeats them on the URL. */
    function scopes(count: number): string[] {
      return Array.from(
        { length: count },
        (_, i) => `aa000000-0000-4000-a000-${String(i).padStart(12, '0')}`
      );
    }

    it('takes one scope per shop of a chain dense in the postal codes', async () => {
      // Production, 2026-11-27: seven Córdoba postal codes hold 32 El Jamón
      // shops, each with its own STORE scope, and a cap of 20 answered the El
      // Jamón chip with a 400.
      const ids = scopes(32);
      const query = ids.map((id) => `priceScopeId=${id}`).join('&');

      const response = await fetch(
        `${app.origin}/v1/catalog/items?soldBy=${MERCADONA}&${query}`
      );

      expect(response.status).toBe(200);
    });

    it('takes the cap, and the URL that carries it stays under Node’s header limit', async () => {
      const query = scopes(MAX_PRICE_SCOPES)
        .map((id) => `priceScopeId=${id}`)
        .join('&');

      const response = await fetch(
        `${app.origin}/v1/catalog/items?soldBy=${MERCADONA}&${query}`
      );

      expect(response.status).toBe(200);
    });

    it('refuses one scope more than the cap', async () => {
      const query = scopes(MAX_PRICE_SCOPES + 1)
        .map((id) => `priceScopeId=${id}`)
        .join('&');

      const response = await fetch(
        `${app.origin}/v1/catalog/items?soldBy=${MERCADONA}&${query}`
      );

      expect(response.status).toBe(400);
      expect(app.sent).toHaveLength(0);
    });
  });
});
