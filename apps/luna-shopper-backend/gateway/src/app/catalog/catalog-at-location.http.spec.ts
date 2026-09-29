import { Test } from '@nestjs/testing';
import {
  ITEM_PATTERNS,
  SUPERMARKET_LOCATION_PATTERNS,
  type SupermarketLocationView,
} from '@portfolio/luna-shopper/contracts';
import {
  createValidationPipe,
  GlobalExceptionFilter,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NatsClient } from '../messaging/nats-client';
import { CatalogItemsController } from './catalog.controller';
import { ScopeResolutionService } from './scope-resolution.service';

/**
 * `GET /v1/catalog/items?locationId=` over real HTTP (plan 0170, section 4):
 * the catalog read at one shop.
 *
 * Over HTTP for the reason `catalog-sold-by.http.spec.ts` gives: a query
 * parameter has to survive the validation pipe to mean anything, and the
 * refusals are statuses and codes a client reads, which only the filter
 * renders.
 */

interface SentMessage {
  readonly subject: unknown;
  readonly payload: Record<string, unknown>;
}

/** Version 5, as seeded shops and chains are: any version is accepted. */
const SHOP = '4b0f2e79-72e0-5f6c-bc20-3633663abafc';
const UNKNOWN_SHOP = 'dd000000-0000-4000-a000-000000000404';
const MERCADONA = 'cf000000-0000-4000-a000-000000000001';
const DEZA = 'cf000000-0000-4000-a000-000000000002';
const STORE_SCOPE = 'aa000000-0000-4000-a000-0000000000a1';
const REGION_SCOPE = 'aa000000-0000-4000-a000-0000000000a2';
const RESOLVED_SCOPE = 'aa000000-0000-4000-a000-0000000000ff';

const location: SupermarketLocationView = {
  id: SHOP,
  supermarketId: MERCADONA,
  priceScopeId: STORE_SCOPE,
  // The stack, most specific first: the read is priced at the head alone.
  priceScopeIds: [STORE_SCOPE, REGION_SCOPE],
  label: null,
  address: 'Calle Mayor 3',
  city: 'Córdoba',
  country: 'ES',
  postalCode: '14001',
  postalCodeSource: null,
  latitude: null,
  longitude: null,
  externalRef: null,
  externalProvider: null,
  sections: [],
};

async function boot() {
  const sent: SentMessage[] = [];
  const forRead = jest.fn(async () => [RESOLVED_SCOPE]);

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
              if (subject === SUPERMARKET_LOCATION_PATTERNS.get) {
                if (payload['supermarketLocationId'] !== SHOP) {
                  throw new NotFoundException('Supermarket location not found');
                }
                return location;
              }
              return { items: [], nextCursor: null };
            },
          },
        },
        { provide: ScopeResolutionService, useValue: { forRead } },
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
  const logger = {
    setContext: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  nest.useGlobalFilters(
    new GlobalExceptionFilter(
      logger as unknown as ConstructorParameters<
        typeof GlobalExceptionFilter
      >[0]
    )
  );
  nest.setGlobalPrefix('v1');

  await nest.init();
  await nest.listen(0);
  const { port } = nest.getHttpServer().address() as AddressInfo;

  return { nest, sent, forRead, origin: `http://127.0.0.1:${port}` };
}

describe('GET /v1/catalog/items?locationId (plan 0170)', () => {
  let app: Awaited<ReturnType<typeof boot>>;

  beforeAll(async () => {
    app = await boot();
  });

  afterAll(async () => {
    await app.nest.close();
  });

  beforeEach(() => {
    app.sent.length = 0;
    app.forRead.mockClear();
  });

  const get = (query: string) =>
    fetch(`${app.origin}/v1/catalog/items?${query}`);

  function searchPayload(): Record<string, unknown> | undefined {
    return app.sent.find((m) => m.subject === ITEM_PATTERNS.search)?.payload;
  }

  async function codeOf(response: Response): Promise<unknown> {
    return ((await response.json()) as { code?: unknown }).code;
  }

  it('prices the read at the shop’s own scope alone and lists its chain', async () => {
    const response = await get(`locationId=${SHOP}&query=leche`);

    expect(response.status).toBe(200);
    const payload = searchPayload();
    expect(payload?.['priceScopeIds']).toEqual([STORE_SCOPE]);
    expect(payload?.['soldBy']).toEqual([MERCADONA]);
    expect(payload?.['query']).toBe('leche');
    // Nothing is resolved from the caller's profile.
    expect(app.forRead).not.toHaveBeenCalled();
  });

  it('takes a soldBy naming the shop’s own chain', async () => {
    const response = await get(`locationId=${SHOP}&soldBy=${MERCADONA}`);

    expect(response.status).toBe(200);
    expect(searchPayload()?.['soldBy']).toEqual([MERCADONA]);
  });

  it('refuses a soldBy naming another chain', async () => {
    const response = await get(
      `locationId=${SHOP}&soldBy=${MERCADONA}&soldBy=${DEZA}`
    );

    expect(response.status).toBe(400);
    expect(await codeOf(response)).toBe('catalog_location_exclusive');
    expect(searchPayload()).toBeUndefined();
  });

  it.each([
    ['priceScopeId', `priceScopeId=${REGION_SCOPE}`],
    ['postalCode', 'postalCode=14001'],
    ['supermarketId', `supermarketId=${MERCADONA}`],
    ['profileId', 'profileId=bb000000-0000-4000-a000-000000000001'],
  ])('refuses %s beside it, before looking the shop up', async (_, extra) => {
    const response = await get(`locationId=${SHOP}&${extra}`);

    expect(response.status).toBe(400);
    expect(await codeOf(response)).toBe('catalog_location_exclusive');
    expect(app.sent).toHaveLength(0);
  });

  it('answers 404 with its own code for a shop that does not exist', async () => {
    const response = await get(`locationId=${UNKNOWN_SHOP}`);

    expect(response.status).toBe(404);
    expect(await codeOf(response)).toBe('supermarket_location_not_found');
    expect(searchPayload()).toBeUndefined();
  });

  it('refuses a value that is not a uuid', async () => {
    const response = await get('locationId=nope');

    expect(response.status).toBe(400);
    expect(app.sent).toHaveLength(0);
  });

  it('changes nothing about a read without it', async () => {
    const response = await get(`soldBy=${DEZA}`);

    expect(response.status).toBe(200);
    expect(searchPayload()?.['priceScopeIds']).toEqual([RESOLVED_SCOPE]);
    expect(searchPayload()?.['soldBy']).toEqual([DEZA]);
    expect(
      app.sent.some((m) => m.subject === SUPERMARKET_LOCATION_PATTERNS.get)
    ).toBe(false);
  });
});
