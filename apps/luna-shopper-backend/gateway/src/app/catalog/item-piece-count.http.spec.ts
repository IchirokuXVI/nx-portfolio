import { Test } from '@nestjs/testing';
import {
  ITEM_PATTERNS,
  PIECE_COUNT_MAX,
  PIECE_COUNT_MIN,
} from '@portfolio/luna-shopper/contracts';
import {
  createValidationPipe,
  GlobalExceptionFilter,
  ITEM_PACK_COUNT_DETAIL,
  ITEM_PIECE_COUNT_DETAIL,
  ItemPieceCountNotAllowedException,
} from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import { NatsClient } from '../messaging/nats-client';
import { AdminCatalogItemsController } from './catalog-admin.controller';

/**
 * The piece count of a product on the admin product routes, over real HTTP
 * (plan 0278, section 3).
 *
 * The validation pipe refuses a count off its bounds before anything crosses
 * the broker, and the global filter answers catalog's refusal of a count on a
 * product without a fixed size with its code and its details. Catalog's own
 * rule is proven against Postgres in `item-piece-count.integration.spec.ts`.
 */

interface SentMessage {
  readonly subject: string;
  readonly payload: Record<string, unknown>;
}

const ITEM_ID = '22222222-2222-4222-8222-222222222222';

async function boot(answer: (payload: Record<string, unknown>) => unknown) {
  const sent: SentMessage[] = [];
  const nest = (
    await Test.createTestingModule({
      controllers: [AdminCatalogItemsController],
      providers: [
        {
          provide: NatsClient,
          useValue: {
            send: async (subject: string, payload: Record<string, unknown>) => {
              sent.push({ subject, payload });
              return answer(payload);
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

const send = (origin: string, method: string, path: string, body: unknown) =>
  fetch(`${origin}/v1/admin/catalog/items${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/** A product view shaped like catalog's, carrying the count it was sent. */
const view = (payload: Record<string, unknown>) => ({
  id: payload['itemId'] ?? ITEM_ID,
  pieceCount: payload['pieceCount'] ?? null,
});

const candies = {
  name: { es: 'Caramelos' },
  categoryIds: [ITEM_ID],
  defaultUnit: 'GRAM',
  unitSize: 35,
};

describe('the piece count of a product, over HTTP (plan 0278)', () => {
  it('sends a count on an update, a null that clears it, a create, a batch and an expectation', async () => {
    const { nest, sent, origin } = await boot(view);
    try {
      const res = await send(origin, 'PATCH', `/${ITEM_ID}`, {
        pieceCount: 50,
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ pieceCount: 50 });
      expect(
        (await send(origin, 'PATCH', `/${ITEM_ID}`, { pieceCount: null }))
          .status
      ).toBe(200);
      expect(
        (await send(origin, 'POST', '', { ...candies, pieceCount: 50 })).status
      ).toBe(201);
      expect(
        (
          await send(origin, 'PATCH', '/batch', {
            items: [
              {
                itemId: ITEM_ID,
                pieceCount: 100,
                expect: { packCount: 2, pieceCount: null },
              },
            ],
          })
        ).status
      ).toBe(200);
      expect(sent.map((message) => message.subject)).toEqual([
        ITEM_PATTERNS.update,
        ITEM_PATTERNS.update,
        ITEM_PATTERNS.create,
        ITEM_PATTERNS.updateMany,
      ]);
      expect(sent.map((message) => message.payload['pieceCount'])).toEqual([
        50,
        null,
        50,
        undefined,
      ]);
      expect(sent[3].payload['items']).toEqual([
        {
          itemId: ITEM_ID,
          pieceCount: 100,
          expect: { packCount: 2, pieceCount: null },
        },
      ]);
    } finally {
      await nest.close();
    }
  });

  it.each([[PIECE_COUNT_MIN], [PIECE_COUNT_MAX]])(
    'passes the bound %p',
    async (pieceCount) => {
      const { nest, sent, origin } = await boot(view);
      try {
        const res = await send(origin, 'PATCH', `/${ITEM_ID}`, { pieceCount });
        expect(res.status).toBe(200);
        expect(sent[0].payload['pieceCount']).toBe(pieceCount);
      } finally {
        await nest.close();
      }
    }
  );

  it.each([
    [PIECE_COUNT_MIN - 1, 'PATCH'],
    [PIECE_COUNT_MAX + 1, 'PATCH'],
    [2.5, 'PATCH'],
    ['fifty', 'PATCH'],
    [PIECE_COUNT_MIN - 1, 'POST'],
    [PIECE_COUNT_MAX + 1, 'POST'],
  ])(
    'refuses a count of %p on a %s with validation_failed, and sends nothing',
    async (pieceCount, method) => {
      const { nest, sent, origin } = await boot(view);
      try {
        const res =
          method === 'POST'
            ? await send(origin, 'POST', '', { ...candies, pieceCount })
            : await send(origin, 'PATCH', `/${ITEM_ID}`, { pieceCount });

        expect(res.status).toBe(400);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body).toMatchObject({ code: 'validation_failed' });
        expect(JSON.stringify(body)).toContain('pieceCount');
        expect(sent).toEqual([]);
      } finally {
        await nest.close();
      }
    }
  );

  it('answers catalog’s item_piece_count_not_allowed as a 400 with its details', async () => {
    const details = {
      itemId: ITEM_ID,
      [ITEM_PIECE_COUNT_DETAIL]: 4,
      [ITEM_PACK_COUNT_DETAIL]: 4,
      unitSize: 360,
      defaultUnit: 'GRAM',
    };
    const { nest, origin } = await boot(() => {
      throw new ItemPieceCountNotAllowedException('not above the pack', {
        details,
      });
    });
    try {
      const res = await send(origin, 'PATCH', `/${ITEM_ID}`, {
        pieceCount: 4,
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        code: 'item_piece_count_not_allowed',
        details,
      });
    } finally {
      await nest.close();
    }
  });
});
