import { Test } from '@nestjs/testing';
import {
  BRAND_PATTERNS,
  BrandBatchOutcome,
  SOURCE_ENTRY_PATTERNS,
} from '@portfolio/luna-shopper/contracts';
import {
  BRAND_KEY_HOLDER_DETAIL,
  BRAND_LINK_BLOCKER_DETAIL,
  BrandKeyTakenException,
  BrandLabelEmptyException,
  BrandLinkKeepsKeyException,
  BrandLinkOwnsNoChainException,
  BrandLinkTooDeepException,
  BrandLinkToSelfException,
  BrandNotLinkedException,
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
 * The brand routes over real HTTP (plan 0115, section 10, and plan 0124).
 *
 * Over HTTP rather than as function calls, for the reason
 * `catalog-admin-query.http.spec.ts` sets out at length: a handler called as a
 * function never meets the global validation pipe, and for a `@Query()` argument
 * that pipe validates the **whole** query object against the declared class. A
 * parameter the class does not carry is a 400 however correctly the handler
 * reads it.
 *
 * Two of them are composed, and what has to be true about them is the order and
 * the later calls' payloads: the suggestions route reads catalog's registry
 * first and hands the harvester the keys, and the spellings route reads the
 * brand first so a missing id answers 404 from the service that owns the row,
 * then the brands linked to it.
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
  canonicalBrandId: null,
  canonicalLabel: null,
  linkCount: 0,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

/** A brand registered as a spelling of {@link BRAND}. */
const SPELLING = {
  ...BRAND,
  id: '44444444-4444-4444-8444-444444444444',
  key: 'mahou5estrellas',
  label: 'MAHOU 5 ESTRELLAS',
  canonicalBrandId: BRAND.id,
  canonicalLabel: BRAND.label,
  itemCount: 0,
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

  it('lists the brands linked to one brand, which is its spellings', async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/brands?canonicalBrandId=${BRAND.id}`
      );

      expect(res.status).toBe(200);
      expect(sent[0].payload).toMatchObject({ canonicalBrandId: BRAND.id });
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

  it('registers a suggestion under a typed name, in one request', async () => {
    const { nest, sent, origin } = await boot({
      [BRAND_PATTERNS.registerSuggestion]: {
        brand: BRAND,
        linked: SPELLING,
        canonicalCreated: false,
        linkedItems: 12,
      },
    });
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/brands/register-suggestion`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            spelling: 'MAHOU 5 ESTRELLAS',
            label: 'Mahou',
          }),
        }
      );

      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({
        canonicalCreated: false,
        linkedItems: 12,
      });
      // The literal path, not a brand id: one request for one decision.
      expect(sent[0].subject).toBe(BRAND_PATTERNS.registerSuggestion);
      expect(sent[0].payload).toMatchObject({
        userId: 'admin-1',
        adminToken: 'operator-token',
        spelling: 'MAHOU 5 ESTRELLAS',
        label: 'Mahou',
      });
    } finally {
      await nest.close();
    }
  });

  it('refuses a register-suggestion body that names only one of the two', async () => {
    const { nest, origin } = await boot();
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/brands/register-suggestion`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ label: 'Mahou' }),
        }
      );
      expect(res.status).toBe(400);
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
      [BRAND_PATTERNS.update]: { ...BRAND, movedItems: 0 },
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

  it('links a brand to the brand it spells, and says how many products moved', async () => {
    const { nest, sent, origin } = await boot({
      [BRAND_PATTERNS.update]: {
        ...SPELLING,
        movedItems: 12,
      },
    });
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/brands/${SPELLING.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ canonicalBrandId: BRAND.id }),
        }
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ movedItems: 12 });
      expect(sent[0].payload).toMatchObject({
        brandId: SPELLING.id,
        canonicalBrandId: BRAND.id,
      });
    } finally {
      await nest.close();
    }
  });

  it('unlinks a brand with an explicit null', async () => {
    const { nest, sent, origin } = await boot({
      [BRAND_PATTERNS.update]: { ...BRAND, movedItems: 12 },
    });
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/brands/${SPELLING.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ canonicalBrandId: null }),
        }
      );

      // Null is the unlink, so the uuid check has to let it through rather than
      // refusing everything that is not a uuid.
      expect(res.status).toBe(200);
      expect(sent[0].payload).toMatchObject({ canonicalBrandId: null });
    } finally {
      await nest.close();
    }
  });

  it('refuses a link that is not a uuid', async () => {
    const { nest, origin } = await boot();
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/brands/${SPELLING.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ canonicalBrandId: 'mahou' }),
        }
      );
      expect(res.status).toBe(400);
    } finally {
      await nest.close();
    }
  });

  it('answers 400 brand_link_to_self', async () => {
    const { nest, origin } = await boot({
      [BRAND_PATTERNS.update]: () => {
        throw new BrandLinkToSelfException('A brand is already itself.');
      },
    });
    try {
      const res = await fetch(`${origin}/v1/admin/catalog/brands/${BRAND.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ canonicalBrandId: BRAND.id }),
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'brand_link_to_self' });
    } finally {
      await nest.close();
    }
  });

  it('answers 409 brand_link_too_deep carrying the brand that breaks the rule', async () => {
    const { nest, origin } = await boot({
      [BRAND_PATTERNS.update]: () => {
        throw new BrandLinkTooDeepException('A link is one level deep.', {
          details: { [BRAND_LINK_BLOCKER_DETAIL]: SPELLING.id },
        });
      },
    });
    try {
      const res = await fetch(`${origin}/v1/admin/catalog/brands/${BRAND.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ canonicalBrandId: SPELLING.id }),
      });

      expect(res.status).toBe(409);
      // The id is why this is not a plain conflict: the panel opens the brand
      // that already holds a link.
      expect(await res.json()).toMatchObject({
        code: 'brand_link_too_deep',
        details: { brandId: SPELLING.id },
      });
    } finally {
      await nest.close();
    }
  });

  it('answers 400 brand_link_owns_no_chain', async () => {
    const { nest, origin } = await boot({
      [BRAND_PATTERNS.create]: () => {
        throw new BrandLinkOwnsNoChainException(
          'A linked brand owns no chain.'
        );
      },
    });
    try {
      const res = await fetch(`${origin}/v1/admin/catalog/brands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          label: 'MAHOU 5 ESTRELLAS',
          canonicalBrandId: BRAND.id,
          privateLabelSupermarketId: '33333333-3333-4333-8333-333333333333',
        }),
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        code: 'brand_link_owns_no_chain',
      });
    } finally {
      await nest.close();
    }
  });

  it('answers 409 brand_link_keeps_key for a rename that changes a spelling’s key', async () => {
    const { nest, origin } = await boot({
      [BRAND_PATTERNS.update]: () => {
        throw new BrandLinkKeepsKeyException('A spelling keeps its key.');
      },
    });
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/brands/${SPELLING.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ label: 'Mahou 7 Estrellas' }),
        }
      );

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'brand_link_keeps_key' });
    } finally {
      await nest.close();
    }
  });

  it('deletes a spelling and says how many products went back', async () => {
    const { nest, sent, origin } = await boot({
      [BRAND_PATTERNS.delete]: { id: SPELLING.id, movedItems: 4 },
    });
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/brands/${SPELLING.id}`,
        { method: 'DELETE' }
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: SPELLING.id, movedItems: 4 });
      expect(sent[0].subject).toBe(BRAND_PATTERNS.delete);
      expect(sent[0].payload).toMatchObject({
        brandId: SPELLING.id,
        adminToken: 'operator-token',
      });
    } finally {
      await nest.close();
    }
  });

  it('answers 409 brand_not_linked for a brand that is nobody’s spelling', async () => {
    const { nest, origin } = await boot({
      [BRAND_PATTERNS.delete]: () => {
        throw new BrandNotLinkedException('Only a spelling can be deleted.');
      },
    });
    try {
      const res = await fetch(`${origin}/v1/admin/catalog/brands/${BRAND.id}`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'brand_not_linked' });
    } finally {
      await nest.close();
    }
  });

  it('asks the harvester for the spellings of the brand and of its links', async () => {
    const { nest, sent, origin } = await boot({
      [BRAND_PATTERNS.get]: BRAND,
      [BRAND_PATTERNS.list]: { items: [SPELLING], nextCursor: null },
      [SOURCE_ENTRY_PATTERNS.brandSpellings]: { spellings: [] },
    });
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/brands/${BRAND.id}/spellings`
      );

      expect(res.status).toBe(200);
      // The brand first, so a missing id answers 404 from catalog rather than
      // an empty list from the harvester, then the brands linked to it.
      expect(sent.map((message) => message.subject)).toEqual([
        BRAND_PATTERNS.get,
        BRAND_PATTERNS.list,
        SOURCE_ENTRY_PATTERNS.brandSpellings,
      ]);
      expect(sent[1].payload).toMatchObject({ canonicalBrandId: BRAND.id });
      // Both keys, which is what puts a linked spelling in the table.
      expect(sent[2].payload).toMatchObject({
        keys: ['mahou', 'mahou5estrellas'],
      });
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

describe('registering many brands, over HTTP (plan 0160)', () => {
  const post = (origin: string, body: unknown) =>
    fetch(`${origin}/v1/admin/catalog/brands/register-many`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('sends the names with the operator credential and answers one outcome per name', async () => {
    const results = {
      results: [
        {
          label: 'Mahou',
          outcome: BrandBatchOutcome.CREATED,
          brandId: BRAND.id,
          linkedItems: 38,
          reason: null,
        },
        {
          label: 'ELPOZO',
          outcome: BrandBatchOutcome.EXISTS,
          brandId: SPELLING.id,
          linkedItems: null,
          reason: null,
        },
        {
          label: '---',
          outcome: BrandBatchOutcome.REFUSED,
          brandId: null,
          linkedItems: null,
          reason: { code: 'brand_label_empty', detail: 'No key.' },
        },
      ],
    };
    const { nest, sent, origin } = await boot({
      [BRAND_PATTERNS.registerMany]: results,
    });
    try {
      const res = await post(origin, {
        brands: [
          { label: 'Mahou' },
          { label: 'ELPOZO' },
          {
            label: '---',
            privateLabelSupermarketId: '33333333-3333-4333-8333-333333333333',
          },
        ],
      });

      // A refused name is an outcome, not a failed request.
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual(results);
      expect(sent[0].subject).toBe(BRAND_PATTERNS.registerMany);
      expect(sent[0].payload).toEqual({
        userId: 'admin-1',
        adminToken: 'operator-token',
        brands: [
          { label: 'Mahou' },
          { label: 'ELPOZO' },
          {
            label: '---',
            privateLabelSupermarketId: '33333333-3333-4333-8333-333333333333',
          },
        ],
      });
    } finally {
      await nest.close();
    }
  });

  it.each([
    ['an empty list', { brands: [] }],
    [
      '201 names',
      {
        brands: Array.from({ length: 201 }, (_, i) => ({ label: `B${i}` })),
      },
    ],
    [
      'a chain that is not a uuid',
      {
        brands: [
          { label: 'Hacendado', privateLabelSupermarketId: 'mercadona' },
        ],
      },
    ],
    ['a label over the length', { brands: [{ label: 'x'.repeat(121) }] }],
  ])('refuses %s with a 400 and sends nothing', async (_, body) => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await post(origin, body);
      expect(res.status).toBe(400);
      expect(sent).toHaveLength(0);
    } finally {
      await nest.close();
    }
  });

  it('takes 200 names, the most one batch may carry', async () => {
    const { nest, sent, origin } = await boot({
      [BRAND_PATTERNS.registerMany]: { results: [] },
    });
    try {
      const res = await post(origin, {
        brands: Array.from({ length: 200 }, (_, i) => ({ label: `B${i}` })),
      });
      expect(res.status).toBe(201);
      expect(sent[0].payload['brands']).toHaveLength(200);
    } finally {
      await nest.close();
    }
  });
});
