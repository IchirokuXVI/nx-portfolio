import { Test } from '@nestjs/testing';
import { ITEM_PATTERNS } from '@portfolio/luna-shopper/contracts';
import {
  createValidationPipe,
  GlobalExceptionFilter,
  ITEM_IN_USE_LINES_DETAIL,
  ITEM_IN_USE_MERGED_DETAIL,
  ITEM_IN_USE_PRICES_DETAIL,
  ITEM_IN_USE_QUEUE_DETAIL,
  ITEM_MERGE_CHAINS_DETAIL,
  ITEM_MERGED_INTO_DETAIL,
  ITEM_MERGED_ITEM_DETAIL,
  ItemInUseException,
  ItemMergedException,
  ItemMergeFormatDiffersException,
  ItemMergeTwoArticlesOneChainException,
} from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import { NatsClient } from '../messaging/nats-client';
import { AdminCatalogItemsController } from './catalog-admin.controller';

/**
 * The merge route and the delete it changes, over real HTTP (plan 0239).
 *
 * The validation pipe decides what reaches catalog, and the global filter
 * makes the status and the `code` of a refusal from the exception's class.
 * Catalog's own rules are proven against Postgres in
 * `item-merge.integration.spec.ts`; this file proves what the gateway lets
 * through and how it answers.
 */

interface SentMessage {
  readonly subject: string;
  readonly payload: Record<string, unknown>;
}

const ITEM_ID = '11111111-1111-4111-8111-111111111111';
const INTO_ID = '22222222-2222-4222-8222-222222222222';
const CHAIN = '33333333-3333-4333-8333-333333333333';

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

const merge = (origin: string, body: unknown, id = ITEM_ID) =>
  fetch(`${origin}/v1/admin/catalog/items/${id}/merge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/** A result shaped like catalog's, for the fake to answer. */
const result = (payload: Record<string, unknown>) => ({
  itemId: payload['itemId'],
  intoItemId: payload['intoItemId'],
  dryRun: payload['dryRun'] === true,
  mergedIntoId: payload['intoItemId'],
  mergedAt: payload['dryRun'] === true ? null : '2026-10-31T00:00:00.000Z',
  prices: 2,
  scopeRows: 1,
  shopRows: 1,
  shopRowsKept: 0,
  barcodes: [],
  survivorEan: null,
  linkedImages: 0,
  repointedItemIds: [],
  queueRows: 3,
});

describe('the merge route, over HTTP (plan 0239)', () => {
  it('sends item.merge with the operator credential and answers 201 with what moved', async () => {
    const { nest, sent, origin } = await boot(result);
    try {
      const res = await merge(origin, {
        intoItemId: INTO_ID,
        dryRun: true,
        allowSecondArticle: true,
        allowFormatDifference: false,
      });

      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({
        itemId: ITEM_ID,
        intoItemId: INTO_ID,
        dryRun: true,
        mergedAt: null,
        queueRows: 3,
      });
      expect(sent).toEqual([
        {
          subject: ITEM_PATTERNS.merge,
          payload: {
            userId: 'admin-1',
            adminToken: 'operator-token',
            itemId: ITEM_ID,
            intoItemId: INTO_ID,
            dryRun: true,
            allowSecondArticle: true,
            allowFormatDifference: false,
          },
        },
      ]);
    } finally {
      await nest.close();
    }
  });

  it('sends absent flags as absent, which catalog reads as false', async () => {
    const { nest, sent, origin } = await boot(result);
    try {
      const res = await merge(origin, { intoItemId: INTO_ID });

      expect(res.status).toBe(201);
      expect(sent[0].payload).toMatchObject({
        itemId: ITEM_ID,
        intoItemId: INTO_ID,
      });
      expect(sent[0].payload['dryRun']).toBeUndefined();
    } finally {
      await nest.close();
    }
  });

  it.each([
    ['no survivor', {}],
    ['a survivor that is not a uuid', { intoItemId: 'nope' }],
    ['a flag spelled as a string', { intoItemId: INTO_ID, dryRun: 'false' }],
    ['a flag that is a number', { intoItemId: INTO_ID, allowSecondArticle: 1 }],
    ['a field it does not know', { intoItemId: INTO_ID, force: true }],
  ])(
    'refuses %s with validation_failed, and sends nothing',
    async (_what, body) => {
      const { nest, sent, origin } = await boot(result);
      try {
        const res = await merge(origin, body);

        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ code: 'validation_failed' });
        expect(sent).toEqual([]);
      } finally {
        await nest.close();
      }
    }
  );

  it.each([
    [
      'item_merge_two_articles_one_chain',
      () =>
        new ItemMergeTwoArticlesOneChainException('two articles', {
          details: { [ITEM_MERGE_CHAINS_DETAIL]: [CHAIN] },
        }),
      { supermarketIds: [CHAIN] },
    ],
    [
      'item_merge_format_differs',
      () =>
        new ItemMergeFormatDiffersException('formats', {
          details: {
            item: { unitSize: 80, defaultUnit: 'MILLILITER' },
            into: { unitSize: 300, defaultUnit: 'MILLILITER' },
          },
        }),
      {
        item: { unitSize: 80, defaultUnit: 'MILLILITER' },
        into: { unitSize: 300, defaultUnit: 'MILLILITER' },
      },
    ],
    [
      'item_merged',
      () =>
        new ItemMergedException('merged', {
          details: {
            [ITEM_MERGED_ITEM_DETAIL]: ITEM_ID,
            [ITEM_MERGED_INTO_DETAIL]: INTO_ID,
          },
        }),
      { itemId: ITEM_ID, mergedIntoId: INTO_ID },
    ],
  ])(
    'answers catalog’s %s as a 409 with its details',
    async (code, refusal, details) => {
      const { nest, origin } = await boot(() => {
        throw refusal();
      });
      try {
        const res = await merge(origin, { intoItemId: INTO_ID });

        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ code, details });
      } finally {
        await nest.close();
      }
    }
  );

  it('answers a delete that something still names as a 409 with the counts', async () => {
    const counts = {
      [ITEM_IN_USE_PRICES_DETAIL]: 4,
      [ITEM_IN_USE_MERGED_DETAIL]: 0,
      [ITEM_IN_USE_QUEUE_DETAIL]: 2,
      [ITEM_IN_USE_LINES_DETAIL]: 1,
    };
    const { nest, sent, origin } = await boot(() => {
      throw new ItemInUseException('in use', { details: counts });
    });
    try {
      const res = await fetch(`${origin}/v1/admin/catalog/items/${ITEM_ID}`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        code: 'item_in_use',
        details: counts,
      });
      expect(sent[0]).toEqual({
        subject: ITEM_PATTERNS.delete,
        payload: {
          userId: 'admin-1',
          adminToken: 'operator-token',
          itemId: ITEM_ID,
        },
      });
    } finally {
      await nest.close();
    }
  });

  it('passes merged=true on the operator list, and nothing when it is absent', async () => {
    const { nest, sent, origin } = await boot(() => ({
      items: [],
      nextCursor: null,
    }));
    try {
      const history = await fetch(
        `${origin}/v1/admin/catalog/items?merged=true`
      );
      const live = await fetch(`${origin}/v1/admin/catalog/items`);

      expect(history.status).toBe(200);
      expect(live.status).toBe(200);
      expect(sent.map((m) => m.payload['merged'])).toEqual([true, undefined]);
    } finally {
      await nest.close();
    }
  });
});
