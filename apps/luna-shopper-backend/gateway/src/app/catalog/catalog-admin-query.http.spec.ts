import { Test } from '@nestjs/testing';
import { createValidationPipe } from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import { NatsClient } from '../messaging/nats-client';
import {
  AdminCatalogLocationItemsController,
  AdminCatalogPriceScopesController,
  AdminCatalogSupermarketsController,
} from './catalog-admin.controller';

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
        `${origin}/v1/admin/catalog/supermarkets/sm-1/locations?postalCodeSource=DERIVED`
      );

      expect(res.status).toBe(200);
      expect(sent[0].payload['postalCodeSource']).toBe('DERIVED');
      expect(sent[0].payload['supermarketId']).toBe('sm-1');
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
        `${origin}/v1/admin/catalog/supermarkets/sm-1/locations?query=gran%20capit`
      );

      expect(res.status).toBe(200);
      expect(sent[0].payload['query']).toBe('gran capit');
      expect(sent[0].payload['supermarketId']).toBe('sm-1');
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
