import type { Type } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PriceSourceKind } from '@portfolio/luna-shopper/contracts';
import {
  createValidationPipe,
  GlobalExceptionFilter,
} from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { AdminJwtGuard } from './admin/admin-jwt.guard';
import { BasketCatalogService } from './baskets/basket-catalog.service';
import { BasketController } from './baskets/basket.controller';
import { ParticipantThrottlerGuard } from './baskets/participant-throttler.guard';
import { SettlePriceService } from './baskets/settle-price.service';
import {
  AdminCatalogItemPricesController,
  AdminCatalogLocationsController,
} from './catalog/catalog-admin.controller';
import { NatsClient } from './messaging/nats-client';

/**
 * Requests the caller got wrong, over real HTTP (plan 0158).
 *
 * Each of these used to reach a service: a malformed id reached Postgres and
 * came back as a 500 "Something went wrong on our side", and a user price kind
 * reached catalog and was stored. Over HTTP because the pipes and the guard are
 * what refuse them, and a handler called as a function meets neither.
 */

const ITEM = '0b6b3a0e-6f0e-4c8e-9d4a-2f7f7f0b1c2d';
const SCOPE = '1c7c4b1f-7a1f-4d9f-8e5b-3a8a8a1c2d3e';

async function boot(controllers: Type[]) {
  const sent: { subject: string; payload: Record<string, unknown> }[] = [];

  const nest = (
    await Test.createTestingModule({
      controllers,
      providers: [
        {
          provide: NatsClient,
          useValue: {
            send: async (subject: string, payload: Record<string, unknown>) => {
              sent.push({ subject, payload });
              return {};
            },
          },
        },
        { provide: JwtService, useValue: { verifyAsync: async () => ({}) } },
        { provide: BasketCatalogService, useValue: {} },
        { provide: SettlePriceService, useValue: {} },
      ],
    })
      .overrideGuard(AdminJwtGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp(): { getRequest(): Record<string, unknown> };
        }) => {
          context.switchToHttp().getRequest()['user'] = {
            adminId: 'admin-1',
            token: 'operator-token',
          };
          return true;
        },
      })
      .overrideGuard(ParticipantThrottlerGuard)
      .useValue({ canActivate: () => true })
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
  return { nest, sent, origin: `http://127.0.0.1:${port}` };
}

describe('a malformed id', () => {
  it('answers GET /v1/baskets/undefined 400, before the guard asks core', async () => {
    const { nest, sent, origin } = await boot([BasketController]);
    try {
      const res = await fetch(`${origin}/v1/baskets/undefined`, {
        headers: { 'x-participant-secret': 'a-secret' },
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        status: 400,
        code: 'validation_failed',
        errors: { id: ['id must be a UUID'] },
      });
      expect(sent).toEqual([]);
    } finally {
      await nest.close();
    }
  });

  it('answers an admin locations route 400 without sending anything', async () => {
    const { nest, sent, origin } = await boot([
      AdminCatalogLocationsController,
    ]);
    try {
      const res = await fetch(`${origin}/v1/admin/catalog/locations/abc`);

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        code: 'validation_failed',
        errors: { id: ['id must be a UUID'] },
      });
      expect(sent).toEqual([]);
    } finally {
      await nest.close();
    }
  });

  it('still lets a uuid through', async () => {
    const { nest, sent, origin } = await boot([
      AdminCatalogLocationsController,
    ]);
    try {
      const res = await fetch(`${origin}/v1/admin/catalog/locations/${ITEM}`);

      expect(res.status).toBe(200);
      expect(sent).toHaveLength(1);
    } finally {
      await nest.close();
    }
  });
});

describe('POST /v1/admin/catalog/item-prices, the source kind', () => {
  function add(origin: string, sourceKind: PriceSourceKind) {
    return fetch(`${origin}/v1/admin/catalog/item-prices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        itemId: ITEM,
        priceScopeId: SCOPE,
        sourceKind,
        price: 1.25,
      }),
    });
  }

  it.each([PriceSourceKind.USER_RECEIPT, PriceSourceKind.USER_REPORTED])(
    'answers %s 400 and sends nothing to catalog',
    async (sourceKind) => {
      const { nest, sent, origin } = await boot([
        AdminCatalogItemPricesController,
      ]);
      try {
        const res = await add(origin, sourceKind);

        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ code: 'validation_failed' });
        expect(sent).toEqual([]);
      } finally {
        await nest.close();
      }
    }
  );

  it('accepts ADMIN and an automated kind', async () => {
    const { nest, sent, origin } = await boot([
      AdminCatalogItemPricesController,
    ]);
    try {
      expect((await add(origin, PriceSourceKind.ADMIN)).status).toBe(201);
      expect((await add(origin, PriceSourceKind.OFFICIAL_WEB)).status).toBe(
        201
      );
      expect(sent).toHaveLength(2);
    } finally {
      await nest.close();
    }
  });
});
