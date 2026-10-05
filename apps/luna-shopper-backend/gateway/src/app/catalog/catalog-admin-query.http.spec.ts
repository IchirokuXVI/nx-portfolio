import { Test } from '@nestjs/testing';
import { createValidationPipe } from '@portfolio/luna-shopper/platform';
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

/** A chain's id, which the routes refuse unless it is a uuid (plan 0158). */
const CHAIN = '7e2a1b3c-4d5e-4f6a-9b8c-1d2e3f4a5b6c';

/**
 * The back office's catalog lists over real HTTP, because the thing that has to
 * be true about them is not what the handler returns but that the request
 * **reaches** it (`apps/luna-shopper-admin/plans/0005`).
 *
 * A controller unit test calls the handler as a function, and a handler called
 * as a function never meets the global `ValidationPipe`. That is the whole risk
 * here. The pipe is configured with `whitelist` and `forbidNonWhitelisted`, and
 * for a `@Query()` argument it validates the **entire** query object against the
 * declared class: a parameter the class does not carry is a 400, however
 * correctly the handler reads it from a `@Query('name')` argument of its own.
 * Both price scope lists were written that way, neither had ever been called,
 * and both answered 400 to the one parameter they document.
 *
 * So these tests send URLs. The broker is a stub that echoes what it was asked
 * for, and the guard is replaced by one that lets everybody in: neither of those
 * is what is under test.
 */

/** What the stub broker was last asked to send, so a spec can read it back. */
interface SentMessage {
  readonly subject: unknown;
  readonly payload: Record<string, unknown>;
}

async function boot() {
  const sent: SentMessage[] = [];

  const nest = (
    await Test.createTestingModule({
      controllers: [
        AdminCatalogSupermarketsController,
        AdminCatalogPriceScopesController,
        AdminCatalogLocationItemsController,
        AdminCatalogItemsController,
        AdminCatalogSupermarketItemsController,
      ],
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
      ],
    })
      .overrideGuard(AdminJwtGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp(): { getRequest(): Record<string, unknown> };
        }) => {
          context.switchToHttp().getRequest()['user'] = {
            adminId: 'admin-1',
            token: 'token',
          };
          return true;
        },
      })
      .compile()
  ).createNestApplication();

  // The pipe the gateway really runs with, which is the only reason this spec
  // exists. `PlatformModule` binds it as an `APP_PIPE`, and a testing module
  // that does not import it has no pipe at all.
  nest.useGlobalPipes(createValidationPipe());
  nest.setGlobalPrefix('v1');

  await nest.init();
  await nest.listen(0);
  const { port } = nest.getHttpServer().address() as AddressInfo;

  return { nest, sent, origin: `http://127.0.0.1:${port}` };
}

describe('the admin catalog lists, over HTTP', () => {
  it('narrows the price scopes to one chain rather than refusing the request', async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/price-scopes?supermarketId=` +
          '11111111-1111-4111-8111-111111111111'
      );

      expect(res.status).toBe(200);
      expect(sent[0].payload['supermarketId']).toBe(
        '11111111-1111-4111-8111-111111111111'
      );
    } finally {
      await nest.close();
    }
  });

  it('lists every scope when no chain is named', async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await fetch(`${origin}/v1/admin/catalog/price-scopes`);

      expect(res.status).toBe(200);
      expect(sent[0].payload['supermarketId']).toBeUndefined();
      // No kind means every kind (plan 0116, section 7).
      expect(sent[0].payload['kinds']).toBeUndefined();
    } finally {
      await nest.close();
    }
  });

  it('narrows the price scopes to the kinds named, repeated', async () => {
    // Plan 0116, section 7: a chain holds a STORE scope per shop, so the runs
    // form asks for its warehouses by kind rather than paging past every shop.
    const { nest, sent, origin } = await boot();
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/price-scopes?kind=LOCAL_AREA&kind=REGION`
      );

      expect(res.status).toBe(200);
      expect(sent[0].payload['kinds']).toEqual(['LOCAL_AREA', 'REGION']);
    } finally {
      await nest.close();
    }
  });

  it('reads a single kind as a list of one', async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/price-scopes?kind=LOCAL_AREA`
      );

      expect(res.status).toBe(200);
      expect(sent[0].payload['kinds']).toEqual(['LOCAL_AREA']);
    } finally {
      await nest.close();
    }
  });

  it('refuses a kind that does not exist, including the old POSTAL_CODE', async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/price-scopes?kind=POSTAL_CODE`
      );

      expect(res.status).toBe(400);
      expect(sent).toEqual([]);
    } finally {
      await nest.close();
    }
  });

  /**
   * The postal code review filter of section 3, which is the one thing this
   * route exists for that the shopper's read of the same table does not have.
   */
  it("carries a chain's shops filter through to the broker", async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/supermarkets/${CHAIN}/locations?postalCodeSource=DERIVED`
      );

      expect(res.status).toBe(200);
      expect(sent[0].payload['postalCodeSource']).toBe('DERIVED');
      expect(sent[0].payload['supermarketId']).toBe(CHAIN);
    } finally {
      await nest.close();
    }
  });

  /**
   * The chain search the reference picker sends. Before the route declared it,
   * the pipe refused the request, so the back office sent no term at all and
   * every chain came back whatever the operator typed.
   */
  it('carries a chain search term through to the broker', async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/supermarkets?query=merca`
      );

      expect(res.status).toBe(200);
      expect(sent[0].payload['query']).toBe('merca');
    } finally {
      await nest.close();
    }
  });

  /**
   * The shop search the mapping picker of admin plan `0011` sends. It is scoped
   * to a chain and typed into, and the pipe validates the whole query object
   * against the declared class, so a term the class does not carry is a 400
   * however well the handler would have read it.
   */
  it("carries a shop search term through to the broker, beside the chain's own", async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/supermarkets/${CHAIN}/locations?query=gran%20capit`
      );

      expect(res.status).toBe(200);
      expect(sent[0].payload['query']).toBe('gran capit');
      expect(sent[0].payload['supermarketId']).toBe(CHAIN);
    } finally {
      await nest.close();
    }
  });

  it('lists every chain when no term is typed', async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await fetch(`${origin}/v1/admin/catalog/supermarkets`);

      expect(res.status).toBe(200);
      expect(sent[0].payload['query']).toBeUndefined();
    } finally {
      await nest.close();
    }
  });

  /** The one admin list that starts from something rather than from nothing. */
  it('requires a shop before it lists what is in one', async () => {
    const { nest, origin } = await boot();
    try {
      const res = await fetch(`${origin}/v1/admin/catalog/location-items`);

      expect(res.status).toBe(400);
    } finally {
      await nest.close();
    }
  });
});

/**
 * The rows that point at nothing (admin plan 0012, section 2).
 *
 * The back office's picker sends the literal `none` on the same parameter a
 * uuid goes on, and the gateway is where it becomes the flag catalog knows.
 * These run over HTTP for the same reason as the tests above: the pipe
 * validates the whole query object, and a literal the validator does not
 * accept is a 400 the handler never sees.
 */
describe('the products in no group, over HTTP', () => {
  const GROUP = '5b8a2c1e-9d4f-4a6b-8c3d-2e1f0a9b8c7d';

  it('passes a group id through as the group', async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/items?productGroupId=${GROUP}`
      );

      expect(res.status).toBe(200);
      expect(sent[0].payload['productGroupId']).toBe(GROUP);
      expect(sent[0].payload['withoutProductGroup']).toBe(false);
    } finally {
      await nest.close();
    }
  });

  it('turns the literal none into the flag catalog reads', async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/items?productGroupId=none`
      );

      expect(res.status).toBe(200);
      expect(sent[0].payload['productGroupId']).toBeUndefined();
      expect(sent[0].payload['withoutProductGroup']).toBe(true);
    } finally {
      await nest.close();
    }
  });

  it('refuses anything that is neither a uuid nor the literal', async () => {
    const { nest, origin } = await boot();
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/items?productGroupId=nothing`
      );

      expect(res.status).toBe(400);
    } finally {
      await nest.close();
    }
  });

  /** The boolean the literal replaced is gone, so a stale client hears about it. */
  it('no longer takes withoutProductGroup as a parameter of its own', async () => {
    const { nest, origin } = await boot();
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/items?withoutProductGroup=true`
      );

      expect(res.status).toBe(400);
    } finally {
      await nest.close();
    }
  });
});

/**
 * The two reads the product list of the back office gained (admin plan 0043,
 * section 2). Over HTTP for the reason every test in this file is: a literal
 * the validator does not accept, or a parameter the DTO does not carry, is a
 * 400 the handler never sees.
 */
describe('the product list of the back office, over HTTP', () => {
  const CATEGORY = '0c7e2f4a-6b1d-5e3f-8a9b-4c5d6e7f8a9b';
  const SCOPE = '3f2a1b4c-5d6e-4f7a-8b9c-0d1e2f3a4b5c';
  const PRODUCTS = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-5222-8222-222222222222',
  ];

  it('passes a category id through as the category', async () => {
    const { nest, sent, origin } = await boot();
    try {
      // A version 5 id, which is what a seeded category carries.
      const res = await fetch(
        `${origin}/v1/admin/catalog/items?categoryId=${CATEGORY}`
      );

      expect(res.status).toBe(200);
      expect(sent[0].payload['categoryId']).toBe(CATEGORY);
      expect(sent[0].payload['withoutCategory']).toBe(false);
    } finally {
      await nest.close();
    }
  });

  it('turns the literal none on the category into the flag catalog reads', async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/items?categoryId=none`
      );

      expect(res.status).toBe(200);
      expect(sent[0].payload['categoryId']).toBeUndefined();
      expect(sent[0].payload['withoutCategory']).toBe(true);
    } finally {
      await nest.close();
    }
  });

  /** Plan 0187: the worklist of one price scope. */
  it('passes the scope of the worklist through, beside every other filter', async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/items?withoutPriceAtScopeId=${SCOPE}&categoryId=${CATEGORY}&productGroupId=none&query=leche&order=name`
      );

      expect(res.status).toBe(200);
      expect(sent[0].payload).toMatchObject({
        withoutPriceAtScopeId: SCOPE,
        categoryId: CATEGORY,
        withoutProductGroup: true,
        query: 'leche',
        order: 'name',
      });
    } finally {
      await nest.close();
    }
  });

  it('sends no scope of a worklist when none is named', async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await fetch(`${origin}/v1/admin/catalog/items`);

      expect(res.status).toBe(200);
      expect(sent[0].payload['withoutPriceAtScopeId']).toBeUndefined();
    } finally {
      await nest.close();
    }
  });

  it('takes a uuid for the worklist and nothing else', async () => {
    const { nest, sent, origin } = await boot();
    try {
      // The literal the reference filters take has no meaning here, and
      // neither has a flag.
      for (const value of ['none', 'true', 'nothing', '']) {
        const res = await fetch(
          `${origin}/v1/admin/catalog/items?withoutPriceAtScopeId=${value}`
        );
        expect(res.status).toBe(400);
      }
      expect(sent).toHaveLength(0);
    } finally {
      await nest.close();
    }
  });

  it('refuses a category that is neither a uuid nor the literal', async () => {
    const { nest, origin } = await boot();
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/items?categoryId=nothing`
      );

      expect(res.status).toBe(400);
    } finally {
      await nest.close();
    }
  });

  it('prices the products named, repeated, at one scope', async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/supermarket-items?priceScopeId=${SCOPE}` +
          PRODUCTS.map((id) => `&itemIds=${id}`).join('')
      );

      expect(res.status).toBe(200);
      expect(sent[0].payload['priceScopeId']).toBe(SCOPE);
      expect(sent[0].payload['itemIds']).toEqual(PRODUCTS);
    } finally {
      await nest.close();
    }
  });

  /** One product is one parameter, which arrives as a string and not a list. */
  it('reads one product named once as a list of one', async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/supermarket-items?itemIds=${PRODUCTS[0]}`
      );

      expect(res.status).toBe(200);
      expect(sent[0].payload['itemIds']).toEqual([PRODUCTS[0]]);
    } finally {
      await nest.close();
    }
  });

  it('refuses more products than one page holds, and one that is no uuid', async () => {
    const { nest, origin } = await boot();
    try {
      const many = Array.from(
        { length: 101 },
        (_, index) =>
          `itemIds=00000000-0000-4000-a000-${String(index).padStart(12, '0')}`
      ).join('&');
      const tooMany = await fetch(
        `${origin}/v1/admin/catalog/supermarket-items?${many}`
      );
      const notAnId = await fetch(
        `${origin}/v1/admin/catalog/supermarket-items?itemIds=milk`
      );

      expect(tooMany.status).toBe(400);
      expect(notAnId.status).toBe(400);
    } finally {
      await nest.close();
    }
  });
});
