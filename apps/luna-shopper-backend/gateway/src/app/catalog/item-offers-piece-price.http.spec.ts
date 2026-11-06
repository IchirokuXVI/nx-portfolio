import { Test } from '@nestjs/testing';
import {
  SUPERMARKET_ITEM_PATTERNS,
  type SupermarketItemPage,
} from '@portfolio/luna-shopper/contracts';
import { createValidationPipe } from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NatsClient } from '../messaging/nats-client';
import { CatalogItemsController } from './catalog.controller';
import { ScopeResolutionService } from './scope-resolution.service';

/**
 * The product sheet's offers over real HTTP (plan 0244, section 3.3). Velista
 * shows the piece price of a kilo piece from this read and never computes it,
 * so the gateway must hand catalog's `piecePrice` through as it came, beside
 * the price of a kilo it leaves alone.
 */

const ITEM = 'aa000000-0000-4000-a000-000000000001';

const PAGE: SupermarketItemPage = {
  items: [
    {
      id: 'si-1',
      itemId: ITEM,
      priceScopeId: 'scope-1',
      price: 9.41,
      currency: 'EUR',
      unitPrice: 9.41,
      unitPriceLabel: 'kg',
      unitBasis: null,
      observedAt: null,
      sourceKind: null,
      priceCopiedFromScopeId: null,
      stale: false,
      validUntil: null,
      itemPriceId: null,
      available: true,
      delistedAt: null,
      outOfStockAt: null,
      piecePrice: 14.49,
    },
    {
      id: 'si-2',
      itemId: ITEM,
      priceScopeId: 'scope-2',
      price: null,
      currency: null,
      unitPrice: null,
      unitPriceLabel: null,
      unitBasis: null,
      observedAt: null,
      sourceKind: null,
      priceCopiedFromScopeId: null,
      stale: false,
      validUntil: null,
      itemPriceId: null,
      available: true,
      delistedAt: null,
      outOfStockAt: null,
      piecePrice: null,
    },
  ],
  nextCursor: null,
};

async function boot() {
  const subjects: unknown[] = [];

  const nest = (
    await Test.createTestingModule({
      controllers: [CatalogItemsController],
      providers: [
        {
          provide: NatsClient,
          useValue: {
            send: async (subject: unknown) => {
              subjects.push(subject);
              return PAGE;
            },
          },
        },
        {
          provide: ScopeResolutionService,
          useValue: { forRead: async () => [] },
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

  return { nest, subjects, origin: `http://127.0.0.1:${port}` };
}

describe('GET /v1/catalog/items/:id/offers carries the piece price', () => {
  let app: Awaited<ReturnType<typeof boot>>;

  beforeAll(async () => {
    app = await boot();
  });

  afterAll(async () => {
    await app.nest.close();
  });

  it('passes piecePrice through untouched, and price stays the kilo', async () => {
    const response = await fetch(
      `${app.origin}/v1/catalog/items/${ITEM}/offers`
    );

    expect(response.status).toBe(200);
    expect(app.subjects).toEqual([SUPERMARKET_ITEM_PATTERNS.listByItem]);
    const body = (await response.json()) as SupermarketItemPage;
    expect(
      body.items.map((row) => ({
        price: row.price,
        piecePrice: row.piecePrice,
      }))
    ).toEqual([
      { price: 9.41, piecePrice: 14.49 },
      { price: null, piecePrice: null },
    ]);
  });
});
