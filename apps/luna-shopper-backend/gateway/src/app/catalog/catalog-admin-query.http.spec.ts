import { Test } from '@nestjs/testing';
import {
  createValidationPipe,
  enableApiVersioning,
} from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import { NatsClient } from '../messaging/nats-client';
import {
  AdminCatalogItemsController,
  AdminCatalogLocationItemsController,
  AdminCatalogPriceScopesController,
  AdminCatalogSupermarketItemsController,
  AdminCatalogSupermarketsController,
} from './catalog-admin.controller';

/**
 * The admin catalog lists, over real HTTP, asked with the parameters they
 * document (plan 0073 section 4, and `apps/luna-shopper-admin/plans/0005`).
 *
 * Over the wire rather than by calling the handler, because the whole subject
 * here is what happens **before** a handler runs. The global pipe validates the
 * query with `whitelist` and `forbidNonWhitelisted`, and it checks the whole
 * query object against the DTO of the `@Query()` parameter. So a parameter read
 * by a second `@Query('name')` argument beside a DTO is refused by the pipe
 * however correctly the handler then uses it, and a test holding the controller
 * sees none of that.
 *
 * That is not hypothetical. Both price scope lists took `supermarketId` exactly
 * that way and answered 400 to it, and no caller in the workspace had asked
 * yet, so nothing said so. This spec is what makes the next one say so.
 *
 * Nothing reaches NATS: the client is a stub, and what is asserted is the
 * status and the arguments the handler forwarded.
 */

const CHAIN = '6f1d6b5e-0000-4000-8000-000000000001';
const LOCATION = '6f1d6b5e-0000-4000-8000-000000000002';
const ITEM = '6f1d6b5e-0000-4000-8000-000000000003';
const SCOPE = '6f1d6b5e-0000-4000-8000-000000000004';

async function boot() {
  const send = jest.fn(async () => ({ items: [], nextCursor: null }));

  const moduleRef = await Test.createTestingModule({
    controllers: [
      AdminCatalogSupermarketsController,
      AdminCatalogItemsController,
      AdminCatalogPriceScopesController,
      AdminCatalogSupermarketItemsController,
      AdminCatalogLocationItemsController,
    ],
    providers: [{ provide: NatsClient, useValue: { send } }],
  })
    .overrideGuard(AdminJwtGuard)
    .useValue({
      canActivate: (context: {
        switchToHttp: () => { getRequest: () => Record<string, unknown> };
      }) => {
        context.switchToHttp().getRequest()['user'] = {
          adminId: 'admin-1',
          token: 'the-operators-own-token',
        };
        return true;
      },
    })
    .compile();

  const nest = moduleRef.createNestApplication();
  enableApiVersioning(nest);
  nest.useGlobalPipes(createValidationPipe());
  await nest.init();
  await nest.listen(0);
  const { port } = nest.getHttpServer().address() as AddressInfo;

  return { nest, send, origin: `http://127.0.0.1:${port}` };
}

describe('the admin catalog lists take the parameters they document', () => {
  let context: Awaited<ReturnType<typeof boot>>;

  beforeAll(async () => {
    context = await boot();
  });

  afterAll(async () => {
    await context.nest.close();
  });

  beforeEach(() => {
    context.send.mockClear();
  });

  /** The last request the handler forwarded to the broker. */
  function forwarded(): Record<string, unknown> {
    return context.send.mock.calls[0]?.[1] as Record<string, unknown>;
  }

  async function get(path: string): Promise<number> {
    const response = await fetch(`${context.origin}${path}`);
    return response.status;
  }

  it('lists one chain’s price scopes', async () => {
    expect(
      await get(`/v1/admin/catalog/price-scopes?supermarketId=${CHAIN}`)
    ).toBe(200);
    expect(forwarded()).toMatchObject({ supermarketId: CHAIN });
  });

  it('lists every chain’s price scopes when no chain is named', async () => {
    expect(await get('/v1/admin/catalog/price-scopes')).toBe(200);
    expect(forwarded()).toMatchObject({ supermarketId: undefined });
  });

  it('lists one chain’s shops, filtered to the guessed postal codes', async () => {
    expect(
      await get(
        `/v1/admin/catalog/supermarkets/${CHAIN}/locations?postalCodeSource=DERIVED&priceScopeId=${SCOPE}`
      )
    ).toBe(200);
    expect(forwarded()).toMatchObject({
      supermarketId: CHAIN,
      postalCodeSource: 'DERIVED',
      priceScopeId: SCOPE,
    });
  });

  it('lists the prices an operator pinned', async () => {
    expect(
      await get(
        `/v2/admin/catalog/supermarket-items?priceSourceKind=ADMIN&itemId=${ITEM}&priceScopeId=${SCOPE}&available=true`
      )
    ).toBe(200);
    expect(forwarded()).toMatchObject({
      priceSourceKind: 'ADMIN',
      itemId: ITEM,
      priceScopeId: SCOPE,
      available: true,
    });
  });

  it('lists one shop’s aisle positions', async () => {
    expect(
      await get(
        `/v1/admin/catalog/location-items?supermarketLocationId=${LOCATION}`
      )
    ).toBe(200);
    expect(forwarded()).toMatchObject({ supermarketLocationId: LOCATION });
  });

  it('lists the products belonging to no group', async () => {
    expect(
      await get('/v1/admin/catalog/items?withoutProductGroup=true&order=name')
    ).toBe(200);
    expect(forwarded()).toMatchObject({
      withoutProductGroup: true,
      order: 'name',
    });
  });

  it('refuses a parameter no list declares', async () => {
    expect(await get('/v1/admin/catalog/price-scopes?madeUp=1')).toBe(400);
  });
});
