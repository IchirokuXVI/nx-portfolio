import { Test } from '@nestjs/testing';
import {
  ITEM_PRICE_PATTERNS,
  ItemPriceWrittenBy,
  PriceShownBecause,
} from '@portfolio/luna-shopper/contracts';
import {
  createValidationPipe,
  GlobalExceptionFilter,
} from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import { NatsClient } from '../messaging/nats-client';
import {
  AdminCatalogItemPricesController,
  AdminCatalogItemsController,
} from './catalog-admin.controller';

/**
 * The price reads and the dated write that replace psql (plan 0160), over real
 * HTTP.
 *
 * Over HTTP for the reason `catalog-admin-query.http.spec.ts` gives: the
 * global validation pipe checks the whole query object and body against the
 * declared class, and a handler called as a function never meets it. The 30
 * day window and the run read's field rules are exactly that kind of check.
 */

interface SentMessage {
  readonly subject: string;
  readonly payload: Record<string, unknown>;
}

async function boot(answers: Record<string, unknown> = {}) {
  const sent: SentMessage[] = [];

  const nest = (
    await Test.createTestingModule({
      controllers: [
        AdminCatalogItemPricesController,
        AdminCatalogItemsController,
      ],
      providers: [
        {
          provide: NatsClient,
          useValue: {
            send: async (subject: string, payload: Record<string, unknown>) => {
              sent.push({ subject, payload });
              return answers[subject] ?? { items: [], nextCursor: null };
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

const ITEM = '11111111-1111-4111-8111-111111111111';
const SCOPE = '22222222-2222-4222-8222-222222222222';
const RUN = '33333333-3333-4333-8333-333333333333';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('the price rows a run wrote (plan 0160)', () => {
  it('forwards runId, and an optional itemId beside it', async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/item-prices?runId=${RUN}&itemId=${ITEM}&limit=50`
      );

      expect(res.status).toBe(200);
      expect(sent[0].subject).toBe(ITEM_PRICE_PATTERNS.list);
      expect(sent[0].payload).toMatchObject({
        userId: 'admin-1',
        adminToken: 'operator-token',
        runId: RUN,
        itemId: ITEM,
        limit: 50,
      });
    } finally {
      await nest.close();
    }
  });

  it('answers each row with the writtenBy catalog sent', async () => {
    const row = { id: 'p1', writtenBy: ItemPriceWrittenBy.CONFIRMED };
    const { nest, origin } = await boot({
      [ITEM_PRICE_PATTERNS.list]: { items: [row], nextCursor: null },
    });
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/item-prices?runId=${RUN}`
      );
      expect(await res.json()).toEqual({ items: [row], nextCursor: null });
    } finally {
      await nest.close();
    }
  });

  it('still reads a history by item and scope', async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/item-prices?itemId=${ITEM}&priceScopeId=${SCOPE}`
      );
      expect(res.status).toBe(200);
      expect(sent[0].payload).toMatchObject({
        itemId: ITEM,
        priceScopeId: SCOPE,
      });
      expect(sent[0].payload['runId']).toBeUndefined();
    } finally {
      await nest.close();
    }
  });

  it.each([
    ['neither a run nor a key', ''],
    ['an item with no scope and no run', `itemId=${ITEM}`],
    ['a run with a scope', `runId=${RUN}&priceScopeId=${SCOPE}`],
    ['a run id that is not a uuid', 'runId=walk-2'],
  ])('refuses %s with a 400 and sends nothing', async (_, query) => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/item-prices?${query}`
      );
      expect(res.status).toBe(400);
      expect(sent).toHaveLength(0);
    } finally {
      await nest.close();
    }
  });
});

describe('one product at every scope (plan 0160)', () => {
  it('asks catalog for the item, paged, and answers what it said', async () => {
    const page = {
      items: [
        {
          priceScopeId: SCOPE,
          shownItemPriceId: 'p1',
          shownBecause: PriceShownBecause.PROTECTED_ADMIN,
          protectedUntil: '2026-09-30T12:00:00.000Z',
        },
      ],
      nextCursor: 'next',
    };
    const { nest, sent, origin } = await boot({
      [ITEM_PRICE_PATTERNS.byItem]: page,
    });
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/items/${ITEM}/prices?limit=20&cursor=abc`
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(page);
      expect(sent[0].subject).toBe(ITEM_PRICE_PATTERNS.byItem);
      expect(sent[0].payload).toEqual({
        userId: 'admin-1',
        adminToken: 'operator-token',
        itemId: ITEM,
        cursor: 'abc',
        limit: 20,
      });
    } finally {
      await nest.close();
    }
  });

  it('refuses an item id that is not a uuid', async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await fetch(`${origin}/v1/admin/catalog/items/dorada/prices`);
      expect(res.status).toBe(400);
      expect(sent).toHaveLength(0);
    } finally {
      await nest.close();
    }
  });
});

describe('a hand price with a past observedAt (plan 0160)', () => {
  async function post(observedAt: string | null | undefined) {
    const { nest, sent, origin } = await boot({
      [ITEM_PRICE_PATTERNS.add]: { id: 'p1' },
    });
    try {
      const res = await fetch(`${origin}/v1/admin/catalog/item-prices`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          itemId: ITEM,
          priceScopeId: SCOPE,
          price: 1.29,
          ...(observedAt === undefined ? {} : { observedAt }),
        }),
      });
      return { status: res.status, body: await res.json(), sent };
    } finally {
      await nest.close();
    }
  }

  it('forwards a date 29 days back', async () => {
    const observedAt = new Date(Date.now() - 29 * DAY_MS).toISOString();
    const { status, sent } = await post(observedAt);
    expect(status).toBe(201);
    expect(sent[0].payload).toMatchObject({ observedAt });
  });

  it('forwards no date, which means now', async () => {
    const { status, sent } = await post(undefined);
    expect(status).toBe(201);
    expect(sent[0].payload['observedAt']).toBeUndefined();
  });

  it('refuses a date more than 30 days back, and sends nothing', async () => {
    const { status, body, sent } = await post(
      new Date(Date.now() - 31 * DAY_MS).toISOString()
    );
    expect(status).toBe(400);
    expect(JSON.stringify(body)).toContain('observedAt');
    expect(sent).toHaveLength(0);
  });

  it('refuses a date in the future, and sends nothing', async () => {
    const { status, sent } = await post(
      new Date(Date.now() + 60 * 60 * 1000).toISOString()
    );
    expect(status).toBe(400);
    expect(sent).toHaveLength(0);
  });
});
