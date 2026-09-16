import { Test } from '@nestjs/testing';
import {
  BRAND_PATTERNS,
  SOURCE_ENTRY_PATTERNS,
} from '@portfolio/luna-shopper/contracts';
import {
  BRAND_KEY_HOLDER_DETAIL,
  BrandKeyTakenException,
  BrandLabelEmptyException,
  createValidationPipe,
  GlobalExceptionFilter,
} from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import { NatsClient } from '../messaging/nats-client';
import {
  AdminCatalogBrandsController,
  AdminCatalogBrandSuggestionsController,
} from './catalog-admin.controller';

/**
 * The six brand routes over real HTTP (plan 0115, section 10).
 *
 * Over HTTP rather than as function calls, for the reason
 * `catalog-admin-query.http.spec.ts` sets out at length: a handler called as a
 * function never meets the global validation pipe, and for a `@Query()` argument
 * that pipe validates the **whole** query object against the declared class. A
 * parameter the class does not carry is a 400 however correctly the handler
 * reads it.
 *
 * Two of the six are composed, and what has to be true about them is the order
 * and the second call's payload: the suggestions route reads catalog's registry
 * first and hands the harvester the keys, and the spellings route reads the
 * brand first so a missing id answers 404 from the service that owns the row.
 */

interface SentMessage {
  readonly subject: string;
  readonly payload: Record<string, unknown>;
}

/** What the stub broker answers for one subject, by subject. */
type Answers = Record<string, unknown | (() => unknown)>;

async function boot(answers: Answers = {}) {
  const sent: SentMessage[] = [];

  const nest = (
    await Test.createTestingModule({
      controllers: [
        AdminCatalogBrandsController,
        AdminCatalogBrandSuggestionsController,
      ],
      providers: [
        {
          provide: NatsClient,
          useValue: {
            send: async (subject: string, payload: Record<string, unknown>) => {
              sent.push({ subject, payload });
              const answer = answers[subject];
              return typeof answer === 'function'
                ? (answer as () => unknown)()
                : (answer ?? { items: [], nextCursor: null });
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
  // The real filter rather than a stub, because what the two refusals below are
  // about is exactly what it does: the status from the code's map, and the
  // `details` bag published only by a class that opted in.
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

const BRAND = {
  id: '22222222-2222-4222-8222-222222222222',
  key: 'mahou',
  label: 'Mahou',
  privateLabelSupermarketId: null,
  itemCount: 38,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

describe('the brand routes, over HTTP', () => {
  it('lists the registry with its query, filter and order', async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/brands?query=el%20pozo&order=itemCount` +
          '&privateLabelSupermarketId=33333333-3333-4333-8333-333333333333' +
          '&limit=50'
      );

      expect(res.status).toBe(200);
      expect(sent[0].subject).toBe(BRAND_PATTERNS.list);
      expect(sent[0].payload).toMatchObject({
        userId: 'admin-1',
        query: 'el pozo',
        order: 'itemCount',
        privateLabelSupermarketId: '33333333-3333-4333-8333-333333333333',
        limit: 50,
      });
    } finally {
      await nest.close();
    }
  });

  it('refuses an order the registry does not have', async () => {
    const { nest, origin } = await boot();
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/brands?order=relevance`
      );
      expect(res.status).toBe(400);
    } finally {
      await nest.close();
    }
  });

  it('creates a brand and answers how many products it picked up', async () => {
    const { nest, sent, origin } = await boot({
      [BRAND_PATTERNS.create]: { ...BRAND, linkedItems: 38 },
    });
    try {
      const res = await fetch(`${origin}/v1/admin/catalog/brands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'Mahou' }),
      });

      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({ linkedItems: 38 });
      expect(sent[0].subject).toBe(BRAND_PATTERNS.create);
      expect(sent[0].payload).toMatchObject({
        userId: 'admin-1',
        adminToken: 'operator-token',
        label: 'Mahou',
      });
    } finally {
      await nest.close();
    }
  });

  it('refuses a key on a create, because the key follows the label', async () => {
    const { nest, origin } = await boot();
    try {
      const res = await fetch(`${origin}/v1/admin/catalog/brands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'Mahou', key: 'mahou' }),
      });
      expect(res.status).toBe(400);
    } finally {
      await nest.close();
    }
  });

  it('answers 400 brand_label_empty for a label of punctuation', async () => {
    const { nest, origin } = await boot({
      [BRAND_PATTERNS.create]: () => {
        throw new BrandLabelEmptyException('The label makes no key.');
      },
    });
    try {
      const res = await fetch(`${origin}/v1/admin/catalog/brands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: '---' }),
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'brand_label_empty' });
    } finally {
      await nest.close();
    }
  });

  it('answers 409 brand_key_taken carrying the holder', async () => {
    const { nest, origin } = await boot({
      [BRAND_PATTERNS.create]: () => {
        throw new BrandKeyTakenException('A brand already holds that key.', {
          details: { [BRAND_KEY_HOLDER_DETAIL]: BRAND.id },
        });
      },
    });
    try {
      const res = await fetch(`${origin}/v1/admin/catalog/brands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'MAHOU' }),
      });

      expect(res.status).toBe(409);
      // The id is the whole reason this code exists rather than a plain
      // conflict: the panel links to the brand that holds the key.
      expect(await res.json()).toMatchObject({
        code: 'brand_key_taken',
        details: { brandId: BRAND.id },
      });
    } finally {
      await nest.close();
    }
  });

  it('reads one brand by id', async () => {
    const { nest, sent, origin } = await boot({
      [BRAND_PATTERNS.get]: BRAND,
    });
    try {
      const res = await fetch(`${origin}/v1/admin/catalog/brands/${BRAND.id}`);

      expect(res.status).toBe(200);
      expect(sent[0].subject).toBe(BRAND_PATTERNS.get);
      expect(sent[0].payload).toMatchObject({ brandId: BRAND.id });
    } finally {
      await nest.close();
    }
  });

  it('renames a brand', async () => {
    const { nest, sent, origin } = await boot({
      [BRAND_PATTERNS.update]: BRAND,
    });
    try {
      const res = await fetch(`${origin}/v1/admin/catalog/brands/${BRAND.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'Hacendado' }),
      });

      expect(res.status).toBe(200);
      expect(sent[0].subject).toBe(BRAND_PATTERNS.update);
      expect(sent[0].payload).toMatchObject({
        brandId: BRAND.id,
        label: 'Hacendado',
        adminToken: 'operator-token',
      });
    } finally {
      await nest.close();
    }
  });

  it('asks the harvester for the spellings of the brand it just read', async () => {
    const { nest, sent, origin } = await boot({
      [BRAND_PATTERNS.get]: BRAND,
      [SOURCE_ENTRY_PATTERNS.brandSpellings]: { spellings: [] },
    });
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/brands/${BRAND.id}/spellings`
      );

      expect(res.status).toBe(200);
      // The brand first, so a missing id answers 404 from catalog rather than
      // an empty list from the harvester.
      expect(sent.map((message) => message.subject)).toEqual([
        BRAND_PATTERNS.get,
        SOURCE_ENTRY_PATTERNS.brandSpellings,
      ]);
      expect(sent[1].payload).toMatchObject({ keys: ['mahou'] });
    } finally {
      await nest.close();
    }
  });

  it('hands the harvester every registered key, then the page', async () => {
    const { nest, sent, origin } = await boot({
      [BRAND_PATTERNS.keys]: { keys: ['mahou', 'hacendado'] },
      [SOURCE_ENTRY_PATTERNS.brandSuggestions]: {
        items: [],
        nextCursor: null,
      },
    });
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/brand-suggestions?query=el%20pozo&limit=25`
      );

      expect(res.status).toBe(200);
      expect(sent.map((message) => message.subject)).toEqual([
        BRAND_PATTERNS.keys,
        SOURCE_ENTRY_PATTERNS.brandSuggestions,
      ]);
      expect(sent[1].payload).toMatchObject({
        registeredKeys: ['mahou', 'hacendado'],
        query: 'el pozo',
        limit: 25,
      });
    } finally {
      await nest.close();
    }
  });
});
