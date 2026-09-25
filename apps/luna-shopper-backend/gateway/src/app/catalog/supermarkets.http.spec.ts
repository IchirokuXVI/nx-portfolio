import { Test } from '@nestjs/testing';
import { SUPERMARKET_PATTERNS } from '@portfolio/luna-shopper/contracts';
import {
  createValidationPipe,
  GlobalExceptionFilter,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import { NatsClient } from '../messaging/nats-client';
import { AdminCatalogSupermarketsController } from './catalog-admin.controller';

/**
 * A chain's default scope over real HTTP (plan 0153).
 *
 * Over HTTP for the reason `brands.http.spec.ts` gives: a handler called as a
 * function never meets the validation pipe, and `defaultPriceScopeId` is a
 * field the DTO did not carry, so the pipe used to strip it before catalog saw
 * it. Whether the scope belongs to the chain is catalog's question, and the
 * stub answers it the way catalog does.
 */

const CHAIN = '11111111-1111-4111-8111-111111111111';
const OWN_SCOPE = '22222222-2222-4222-8222-222222222222';
const OTHER_SCOPE = '33333333-3333-4333-8333-333333333333';

async function boot() {
  const sent: { subject: string; payload: Record<string, unknown> }[] = [];

  const nest = (
    await Test.createTestingModule({
      controllers: [AdminCatalogSupermarketsController],
      providers: [
        {
          provide: NatsClient,
          useValue: {
            send: async (subject: string, payload: Record<string, unknown>) => {
              sent.push({ subject, payload });
              if (payload['defaultPriceScopeId'] === OTHER_SCOPE) {
                throw new ValidationException(
                  'defaultPriceScopeId names a price scope of another chain.'
                );
              }
              return {
                id: CHAIN,
                name: { es: 'Dia' },
                logoUrl: null,
                websiteUrl: null,
                externalBrandKey: null,
                defaultPriceScopeId: payload['defaultPriceScopeId'] ?? null,
              };
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
            token: 'operator-token',
          };
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
  return { nest, sent, origin: `http://127.0.0.1:${port}` };
}

function patch(origin: string, body: unknown) {
  return fetch(`${origin}/v1/admin/catalog/supermarkets/${CHAIN}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /v1/admin/catalog/supermarkets/{id}, the default scope', () => {
  it('sends defaultPriceScopeId to catalog', async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await patch(origin, { defaultPriceScopeId: OWN_SCOPE });

      expect(res.status).toBe(200);
      expect(sent[0].subject).toBe(SUPERMARKET_PATTERNS.update);
      expect(sent[0].payload).toMatchObject({
        supermarketId: CHAIN,
        defaultPriceScopeId: OWN_SCOPE,
      });
      expect((await res.json()).defaultPriceScopeId).toBe(OWN_SCOPE);
    } finally {
      await nest.close();
    }
  });

  it("answers 400 for another chain's scope", async () => {
    const { nest, origin } = await boot();
    try {
      const res = await patch(origin, { defaultPriceScopeId: OTHER_SCOPE });

      expect(res.status).toBe(400);
    } finally {
      await nest.close();
    }
  });

  it('answers 400 for a value that is not a uuid, without asking catalog', async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await patch(origin, { defaultPriceScopeId: 'national' });

      expect(res.status).toBe(400);
      expect(sent).toEqual([]);
    } finally {
      await nest.close();
    }
  });

  it('sends null, which clears the default', async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await patch(origin, { defaultPriceScopeId: null });

      expect(res.status).toBe(200);
      expect(sent[0].payload).toMatchObject({ defaultPriceScopeId: null });
    } finally {
      await nest.close();
    }
  });
});
