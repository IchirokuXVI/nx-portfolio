import { ValidationPipe } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  HarvestRunMode,
  PriceSourceKind,
  type HarvestDocument,
} from '@portfolio/luna-shopper/contracts';
import {
  ERROR_CODES,
  enableApiVersioning,
} from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import { NatsClient } from '../messaging/nats-client';
import { AdminHarvestImportsController } from './harvest.controller';
import { bodyParserProblems, jsonBodyParsers } from './import-body';

/**
 * The file import over real HTTP (plan 0086, section 10; plan 0081, section 7).
 *
 * Over the wire rather than by calling the handler, because the two things
 * worth asserting happen **before** the handler runs: the route's own JSON body
 * parser, and the refusal a body over its limit produces. A test holding the
 * controller sees neither, and the body limit in particular is the defect this
 * route was written around: Nest's parser defaults to 100 KB, this gateway
 * configured none, and every real leaflet (337 KB and 349 KB for the two
 * committed extractions) was refused with a bare 413.
 */

/** Small enough to reach in a millisecond, large enough to fit the fixtures. */
const IMPORT_CAP = 8 * 1024;
const DEFAULT_CAP = 1024;

const SUPERMARKET = '11111111-1111-4111-8111-111111111111';
const SCOPE = '22222222-2222-4222-8222-222222222222';

function document(patch: Record<string, unknown> = {}): HarvestDocument {
  return {
    schema_version: 1,
    sha256: 'd'.repeat(64),
    producer: {
      name: 'leaflet-extractor',
      version: '0.4.0',
      produced_at: '2026-09-04T18:02:11Z',
    },
    validity: { from: '2026-08-27', until: '2026-09-23' },
    products: [
      {
        id: 'p01-o01',
        name: 'Cerveza Alhambra Tradicional',
        price: { amount: 0.53, currency: 'EUR' },
      },
    ],
    ...patch,
  };
}

function products(row: Record<string, unknown>): Record<string, unknown>[] {
  return [row];
}

async function boot() {
  const send = jest.fn(async () => ({ id: 'run-1', status: 'PENDING' }));

  const moduleRef = await Test.createTestingModule({
    controllers: [AdminHarvestImportsController],
    providers: [
      { provide: NatsClient, useValue: { send } },
      {
        provide: APP_FILTER,
        useValue: {
          catch: (error: unknown, host: { switchToHttp: () => never }) => {
            const http = host.switchToHttp() as unknown as {
              getResponse: () => {
                status: (code: number) => { json: (body: unknown) => void };
              };
            };
            const status = (error as { status?: number }).status ?? 500;
            const response = (error as { response?: { message?: string[] } })
              .response;
            http
              .getResponse()
              .status(status)
              .json({
                code:
                  status === 400
                    ? ERROR_CODES.VALIDATION_FAILED
                    : ERROR_CODES.INTERNAL,
                errors: response?.message ?? [],
              });
          },
        },
      },
    ],
  })
    .overrideGuard(AdminJwtGuard)
    .useValue({
      canActivate: (context: {
        switchToHttp: () => { getRequest: () => Record<string, unknown> };
      }) => {
        context.switchToHttp().getRequest()['user'] = {
          adminUserId: 'operator-1',
          token: 'the-operators-own-token',
        };
        return true;
      },
    })
    .compile();

  const nest = moduleRef.createNestApplication({ bodyParser: false });
  enableApiVersioning(nest);
  // The same wiring `main.ts` does, at caps a test can reach: the import path
  // first, the default second, then the handler that turns a parser's refusal
  // into a problem document naming the number.
  const limits = {
    importMaxBytes: IMPORT_CAP,
    defaultMaxBytes: DEFAULT_CAP,
  };
  for (const parser of jsonBodyParsers(limits)) {
    if (parser.path) {
      nest.use(parser.path, parser.handler);
    } else {
      nest.use(parser.handler);
    }
  }
  nest.use(bodyParserProblems(limits));
  nest.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    })
  );
  await nest.init();
  await nest.listen(0);
  const { port } = nest.getHttpServer().address() as AddressInfo;
  return { nest, send, origin: `http://127.0.0.1:${port}` };
}

function post(origin: string, body: unknown): Promise<Response> {
  return fetch(`${origin}/v1/admin/harvest/imports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /v1/admin/harvest/imports', () => {
  let context: Awaited<ReturnType<typeof boot>>;

  beforeAll(async () => {
    context = await boot();
  });

  afterAll(async () => {
    await context.nest.close();
  });

  it('accepts a document larger than the default body limit', async () => {
    // The whole reason the route has its own parser. The `extra` bag pads the
    // document past 1 KB, which every other route on this gateway refuses.
    const padded = document({
      products: products({
        id: 'p01-o01',
        name: 'Cerveza Alhambra Tradicional',
        price: { amount: 0.53, currency: 'EUR' },
        extra: {
          raw_text: Array.from(
            { length: 80 },
            (_, i) => `fragment ${i} of the tile as the extractor read it`
          ),
        },
      }),
    });
    expect(JSON.stringify(padded).length).toBeGreaterThan(DEFAULT_CAP);

    const response = await post(context.origin, {
      supermarketId: SUPERMARKET,
      priceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
      document: padded,
    });

    expect(response.status).toBe(201);
    expect(context.send).toHaveBeenCalledWith(
      'harvest.spawn',
      expect.objectContaining({
        mode: HarvestRunMode.FILE_IMPORT,
        supermarketId: SUPERMARKET,
        priceScopeId: SCOPE,
        // What observed the products, which is what the rows and the prices are
        // stamped with. Not what the upload is (plan 0086, section 6.2).
        sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
        validFrom: null,
        validUntil: null,
      })
    );
  });

  it('refuses a document over its own limit, naming the number', async () => {
    const huge = document({
      products: products({
        id: 'p01-o01',
        name: 'Cerveza Alhambra Tradicional',
        extra: { raw_text: Array.from({ length: 400 }, () => 'a'.repeat(64)) },
      }),
    });
    expect(JSON.stringify(huge).length).toBeGreaterThan(IMPORT_CAP);

    const response = await post(context.origin, {
      supermarketId: SUPERMARKET,
      priceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
      document: huge,
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { detail?: string; code: string };
    expect(body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    // The number, not a bare 413: "that upload is too large" without a limit
    // is not an answer somebody can act on.
    expect(body.detail).toContain('KB');
  });

  it('names the product and the path when the document fails the schema', async () => {
    const broken = document({
      products: products({
        id: 'p01-o01',
        name: 'Cerveza Alhambra Tradicional',
        // A price with no currency, which the file schema requires inside one.
        price: { amount: 0.53 },
      }),
    });

    const response = await post(context.origin, {
      supermarketId: SUPERMARKET,
      priceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
      document: broken,
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { errors: string[] };
    expect(body.errors.join(' ')).toContain('/products/0/price/currency');
    // The product's own id, so the upload screen can name the row rather than an
    // array index nobody can find in the file.
    expect(body.errors.join(' ')).toContain('p01-o01');
    expect(context.send).not.toHaveBeenCalledWith(
      'harvest.spawn',
      expect.objectContaining({ document: broken })
    );
  });

  it('refuses a schema version this backend cannot read', async () => {
    const response = await post(context.origin, {
      supermarketId: SUPERMARKET,
      priceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
      document: document({ schema_version: 99 }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { errors: string[] };
    expect(body.errors.join(' ')).toContain('/schema_version');
  });

  it('refuses a document with no products, which is nothing to run', async () => {
    const response = await post(context.origin, {
      supermarketId: SUPERMARKET,
      priceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
      document: document({ products: [] }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { errors: string[] };
    expect(body.errors.join(' ')).toContain('/products');
  });

  it('refuses a user source kind: no upload may write one', async () => {
    // The rule `catalog.addPrices` already enforces, stated here so the request
    // is refused before it crosses the broker (plan 0086, section 9).
    const response = await post(context.origin, {
      supermarketId: SUPERMARKET,
      priceScopeId: SCOPE,
      sourceKind: PriceSourceKind.USER_RECEIPT,
      document: document(),
    });

    expect(response.status).toBe(400);
  });

  it('passes the admin override through as the local days it was given', async () => {
    const response = await post(context.origin, {
      supermarketId: SUPERMARKET,
      priceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      validFrom: '2026-09-01',
      validUntil: '2026-09-07',
      document: document(),
    });

    expect(response.status).toBe(201);
    expect(context.send).toHaveBeenLastCalledWith(
      'harvest.spawn',
      expect.objectContaining({
        validFrom: '2026-09-01',
        validUntil: '2026-09-07',
      })
    );
  });
});
