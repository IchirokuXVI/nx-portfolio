import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import {
  ADMIN_TOKEN_AUDIENCE,
  ITEM_PATTERNS,
  UnitOfMeasure,
  UserKind,
} from '@portfolio/luna-shopper/contracts';
import {
  BRAND_LABELS_DETAIL,
  BrandUnregisteredException,
  createValidationPipe,
  GlobalExceptionFilter,
  ITEM_EXPECTATION_FAILURES_DETAIL,
  ITEM_GRAMS_DETAIL,
  ITEM_UNIT_BECOMES_DETAIL,
  ITEM_UNIT_DETAIL,
  ITEM_UNIT_SIZE_DETAIL,
  ItemExpectationFailedException,
  ItemKilogramHasSizeException,
  ItemUnitNotBaseException,
} from '@portfolio/luna-shopper/platform';
import { generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import { AdminJwtStrategy } from '../admin/admin-jwt.strategy';
import { JwtStrategy } from '../auth/jwt.strategy';
import { NatsClient } from '../messaging/nats-client';
import { AdminCatalogItemsController } from './catalog-admin.controller';

/**
 * The admin routes an audit is applied through, over real HTTP (plan 0237,
 * sections 3.2 to 3.7).
 *
 * Over HTTP for the reason `item-ean.http.spec.ts` gives: the validation pipe
 * decides what reaches catalog, and the global filter makes the status and
 * the `code` of a refusal from the exception's class. Catalog's own rules are
 * proven against Postgres in `catalog-audit-operations.integration.spec.ts`;
 * this file proves what the gateway lets through and how it answers.
 */

interface SentMessage {
  readonly subject: string;
  readonly payload: Record<string, unknown>;
}

type Answers = Record<
  string,
  unknown | ((payload: Record<string, unknown>) => unknown)
>;

const ITEM_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';

async function boot(answers: Answers = {}) {
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
              const answer = answers[subject];
              return typeof answer === 'function'
                ? (answer as (payload: Record<string, unknown>) => unknown)(
                    payload
                  )
                : (answer ?? { id: ITEM_ID, items: [] });
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

function send(
  origin: string,
  method: 'POST' | 'PATCH',
  path: string,
  body: unknown
): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('an audit through the admin item routes, over HTTP (plan 0237)', () => {
  describe('3.2: an entry states what it expects', () => {
    const expectation = {
      name: { es: 'Galletas', en: 'Biscuits' },
      brand: null,
      unitSize: 4000,
      defaultUnit: UnitOfMeasure.GRAM,
      packCount: null,
      categorySlugs: ['biscuits'],
    };

    it('carries expect on a batch entry and on the single edit to catalog as sent', async () => {
      const { nest, sent, origin } = await boot();
      try {
        const batch = await send(
          origin,
          'PATCH',
          '/v1/admin/catalog/items/batch',
          {
            items: [{ itemId: ITEM_ID, brand: 'Pierrot', expect: expectation }],
          }
        );
        const single = await send(
          origin,
          'PATCH',
          `/v1/admin/catalog/items/${ITEM_ID}`,
          { brand: 'Pierrot', expect: { brand: 'Cuétara' } }
        );

        expect(batch.status).toBe(200);
        expect(single.status).toBe(200);
        expect(sent[0]).toMatchObject({
          subject: ITEM_PATTERNS.updateMany,
          payload: { items: [{ itemId: ITEM_ID, expect: expectation }] },
        });
        expect(sent[1]).toMatchObject({
          subject: ITEM_PATTERNS.update,
          payload: { itemId: ITEM_ID, expect: { brand: 'Cuétara' } },
        });
      } finally {
        await nest.close();
      }
    });

    it.each([
      ['a field it does not know', { colour: 'red' }],
      ['a unit that is not one', { defaultUnit: 'BUSHEL' }],
      ['a pack count that is not whole', { packCount: 2.5 }],
      ['slugs that are not a list', { categorySlugs: 'biscuits' }],
    ])(
      'refuses an expectation with %s, and sends nothing',
      async (_what, bad) => {
        const { nest, sent, origin } = await boot();
        try {
          const res = await send(
            origin,
            'PATCH',
            '/v1/admin/catalog/items/batch',
            { items: [{ itemId: ITEM_ID, packCount: 6, expect: bad }] }
          );

          expect(res.status).toBe(400);
          expect(await res.json()).toMatchObject({ code: 'validation_failed' });
          expect(sent).toEqual([]);
        } finally {
          await nest.close();
        }
      }
    );

    it('refuses a null expectation on the batch and on the single edit, and sends nothing', async () => {
      const { nest, sent, origin } = await boot();
      try {
        const batch = await send(
          origin,
          'PATCH',
          '/v1/admin/catalog/items/batch',
          { items: [{ itemId: ITEM_ID, packCount: 6, expect: null }] }
        );
        const single = await send(
          origin,
          'PATCH',
          `/v1/admin/catalog/items/${ITEM_ID}`,
          { packCount: 6, expect: null }
        );

        expect(batch.status).toBe(400);
        expect(await batch.json()).toMatchObject({ code: 'validation_failed' });
        expect(single.status).toBe(400);
        expect(await single.json()).toMatchObject({
          code: 'validation_failed',
        });
        expect(sent).toEqual([]);
      } finally {
        await nest.close();
      }
    });

    it('answers catalog’s refusal as 409 item_expectation_failed, with each product, field and value', async () => {
      const failures = [
        {
          itemId: OTHER_ID,
          fields: [{ field: 'brand', expected: 'Cuétara', actual: 'Pierrot' }],
        },
      ];
      const { nest, origin } = await boot({
        [ITEM_PATTERNS.updateMany]: () => {
          throw new ItemExpectationFailedException('moved', {
            details: { [ITEM_EXPECTATION_FAILURES_DETAIL]: failures },
          });
        },
      });
      try {
        const res = await send(
          origin,
          'PATCH',
          '/v1/admin/catalog/items/batch',
          {
            items: [
              { itemId: ITEM_ID, packCount: 6 },
              { itemId: OTHER_ID, packCount: 6, expect: { brand: 'Cuétara' } },
            ],
          }
        );

        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({
          code: 'item_expectation_failed',
          details: { [ITEM_EXPECTATION_FAILURES_DETAIL]: failures },
        });
      } finally {
        await nest.close();
      }
    });
  });

  describe('3.3: the unit rules', () => {
    it.each([
      [
        'item_unit_not_base',
        () =>
          new ItemUnitNotBaseException('LITER', {
            details: {
              itemId: ITEM_ID,
              [ITEM_UNIT_DETAIL]: UnitOfMeasure.LITER,
              [ITEM_UNIT_BECOMES_DETAIL]: UnitOfMeasure.MILLILITER,
              [ITEM_UNIT_SIZE_DETAIL]: 1000,
            },
          }),
        { defaultUnit: UnitOfMeasure.LITER, unitSize: 1 },
      ],
      [
        'item_kilogram_has_size',
        () =>
          new ItemKilogramHasSizeException('KILOGRAM', {
            details: {
              itemId: ITEM_ID,
              [ITEM_UNIT_SIZE_DETAIL]: 4000,
              [ITEM_GRAMS_DETAIL]: 4_000_000,
            },
          }),
        { defaultUnit: UnitOfMeasure.KILOGRAM },
      ],
    ])(
      'answers catalog’s %s as a 400 with its details',
      async (code, refusal, edit) => {
        const { nest, origin } = await boot({
          [ITEM_PATTERNS.updateMany]: () => {
            throw refusal();
          },
        });
        try {
          const res = await send(
            origin,
            'PATCH',
            '/v1/admin/catalog/items/batch',
            { items: [{ itemId: ITEM_ID, ...edit }] }
          );

          expect(res.status).toBe(400);
          expect(await res.json()).toMatchObject({
            code,
            details: refusal().details,
          });
        } finally {
          await nest.close();
        }
      }
    );
  });

  describe('3.4: category slugs on the item routes', () => {
    const CATEGORY_ID = '9aa24ae9-19c9-5583-a093-b97cb81771c4';
    const product = (categories: Record<string, unknown>) => ({
      name: { es: 'Batidora', en: 'Blender' },
      defaultUnit: UnitOfMeasure.UNIT,
      ...categories,
    });

    it('sends slugs, or ids, on a create, a batch create, an edit and a batch edit', async () => {
      const { nest, sent, origin } = await boot();
      try {
        const answers = await Promise.all([
          send(
            origin,
            'POST',
            '/v1/admin/catalog/items',
            product({ categorySlugs: ['small-appliances'] })
          ),
          send(origin, 'POST', '/v1/admin/catalog/items/batch', {
            items: [
              product({ categorySlugs: ['small-appliances'] }),
              product({ categoryIds: [CATEGORY_ID] }),
            ],
          }),
          send(origin, 'PATCH', `/v1/admin/catalog/items/${ITEM_ID}`, {
            categorySlugs: ['small-appliances'],
          }),
          send(origin, 'PATCH', '/v1/admin/catalog/items/batch', {
            items: [
              { itemId: ITEM_ID, categorySlugs: ['small-appliances'] },
              { itemId: OTHER_ID, packCount: 6 },
            ],
          }),
        ]);

        expect(answers.map((res) => res.status)).toEqual([201, 201, 200, 200]);
        const bySubject = new Map(
          sent.map((message) => [message.subject, message.payload])
        );
        expect(bySubject.get(ITEM_PATTERNS.create)).toMatchObject({
          categorySlugs: ['small-appliances'],
        });
        expect(bySubject.get(ITEM_PATTERNS.createMany)).toMatchObject({
          items: [
            { categorySlugs: ['small-appliances'] },
            { categoryIds: [CATEGORY_ID] },
          ],
        });
        expect(bySubject.get(ITEM_PATTERNS.update)).toMatchObject({
          categorySlugs: ['small-appliances'],
        });
      } finally {
        await nest.close();
      }
    });

    it.each([
      [
        'a create with both lists',
        'POST',
        '/v1/admin/catalog/items',
        product({
          categoryIds: [CATEGORY_ID],
          categorySlugs: ['small-appliances'],
        }),
      ],
      [
        'a create with neither list',
        'POST',
        '/v1/admin/catalog/items',
        product({}),
      ],
      [
        'a batch edit with both lists',
        'PATCH',
        '/v1/admin/catalog/items/batch',
        {
          items: [
            {
              itemId: ITEM_ID,
              categoryIds: [CATEGORY_ID],
              categorySlugs: ['small-appliances'],
            },
          ],
        },
      ],
      [
        'an empty list of slugs',
        'PATCH',
        `/v1/admin/catalog/items/${ITEM_ID}`,
        { categorySlugs: [] },
      ],
      [
        'eleven slugs',
        'PATCH',
        `/v1/admin/catalog/items/${ITEM_ID}`,
        { categorySlugs: Array.from({ length: 11 }, (_, i) => `aisle-${i}`) },
      ],
    ] as const)(
      'refuses %s with validation_failed, and sends nothing',
      async (_what, method, path, body) => {
        const { nest, sent, origin } = await boot();
        try {
          const res = await send(origin, method, path, body);

          expect(res.status).toBe(400);
          expect(await res.json()).toMatchObject({ code: 'validation_failed' });
          expect(sent).toEqual([]);
        } finally {
          await nest.close();
        }
      }
    );
  });

  describe('3.6: a batch that refuses a brand the registry lacks', () => {
    const created = {
      name: { es: 'Galletas', en: 'Biscuits' },
      brand: 'Marca Nueva',
      defaultUnit: UnitOfMeasure.GRAM,
      categorySlugs: ['biscuits'],
    };

    it('carries the flag on both batches, and sends nothing when it is absent', async () => {
      const { nest, sent, origin } = await boot();
      try {
        await send(origin, 'POST', '/v1/admin/catalog/items/batch', {
          items: [created],
          requireRegisteredBrands: true,
        });
        await send(origin, 'PATCH', '/v1/admin/catalog/items/batch', {
          items: [{ itemId: ITEM_ID, brand: 'Marca Nueva' }],
          requireRegisteredBrands: true,
        });
        await send(origin, 'PATCH', '/v1/admin/catalog/items/batch', {
          items: [{ itemId: ITEM_ID, brand: 'Marca Nueva' }],
        });

        expect(sent[0].payload).toMatchObject({
          requireRegisteredBrands: true,
        });
        expect(sent[1].payload).toMatchObject({
          requireRegisteredBrands: true,
        });
        expect(sent[2].payload['requireRegisteredBrands']).toBeUndefined();
      } finally {
        await nest.close();
      }
    });

    it('refuses a flag that is not a JSON boolean, and sends nothing', async () => {
      const { nest, sent, origin } = await boot();
      try {
        const res = await send(
          origin,
          'PATCH',
          '/v1/admin/catalog/items/batch',
          {
            items: [{ itemId: ITEM_ID, brand: 'Marca Nueva' }],
            requireRegisteredBrands: 'false',
          }
        );

        expect(res.status).toBe(400);
        expect(sent).toEqual([]);
      } finally {
        await nest.close();
      }
    });

    it('answers catalog’s refusal as 409 brand_unregistered, naming the labels', async () => {
      const { nest, origin } = await boot({
        [ITEM_PATTERNS.createMany]: () => {
          throw new BrandUnregisteredException('unregistered', {
            details: { [BRAND_LABELS_DETAIL]: ['Marca Nueva'] },
          });
        },
      });
      try {
        const res = await send(
          origin,
          'POST',
          '/v1/admin/catalog/items/batch',
          {
            items: [created],
            requireRegisteredBrands: true,
          }
        );

        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({
          code: 'brand_unregistered',
          details: { [BRAND_LABELS_DETAIL]: ['Marca Nueva'] },
        });
      } finally {
        await nest.close();
      }
    });
  });

  describe('3.7: an admin read of many products', () => {
    /** `n` distinct uuids, in order. */
    const uuids = (n: number, from = 0) =>
      Array.from(
        { length: n },
        (_, i) =>
          `00000000-0000-4000-8000-${(from + i).toString(16).padStart(12, '0')}`
      );

    /** A catalog that answers every id it is asked for, except `missing`. */
    const catalog = (missing: readonly string[] = []) => ({
      [ITEM_PATTERNS.getMany]: (payload: Record<string, unknown>) => ({
        items: (payload['ids'] as string[])
          .filter((id) => !missing.includes(id))
          .map((id) => ({ id })),
      }),
    });

    it('reads 1,000 ids in one call, as two pages of the catalog lookup, reading through every time', async () => {
      const ids = uuids(1000);
      const { nest, sent, origin } = await boot(catalog([ids[7]]));
      try {
        const res = await send(
          origin,
          'POST',
          '/v1/admin/catalog/items/lookup',
          {
            ids,
          }
        );
        const again = await send(
          origin,
          'POST',
          '/v1/admin/catalog/items/lookup',
          { ids: ids.slice(0, 3) }
        );

        expect(res.status).toBe(201);
        const { items } = (await res.json()) as { items: { id: string }[] };
        // The unknown id is absent, as on the shopper's lookup.
        expect(items).toHaveLength(999);
        expect(items.map((item) => item.id)).not.toContain(ids[7]);
        expect(again.status).toBe(201);
        // Two pages for the first call, one for the second: nothing cached.
        expect(sent.map((message) => message.subject)).toEqual([
          ITEM_PATTERNS.getMany,
          ITEM_PATTERNS.getMany,
          ITEM_PATTERNS.getMany,
        ]);
        expect(
          sent.map((message) => (message.payload['ids'] as string[]).length)
        ).toEqual([500, 500, 3]);
        // No scope and no price: the products alone.
        expect(sent[0].payload).toEqual({ ids: ids.slice(0, 500) });
      } finally {
        await nest.close();
      }
    });

    it('asks once for an id named twice', async () => {
      const [id] = uuids(1);
      const { nest, sent, origin } = await boot(catalog());
      try {
        const res = await send(
          origin,
          'POST',
          '/v1/admin/catalog/items/lookup',
          {
            ids: [id, id],
          }
        );

        expect(res.status).toBe(201);
        expect(sent[0].payload).toEqual({ ids: [id] });
      } finally {
        await nest.close();
      }
    });

    it.each([
      ['1,001 ids', { ids: uuids(1001) }],
      ['an id that is not a uuid', { ids: ['not-a-uuid'] }],
      ['no list', {}],
    ])(
      'refuses %s with validation_failed, and sends nothing',
      async (_what, body) => {
        const { nest, sent, origin } = await boot(catalog());
        try {
          const res = await send(
            origin,
            'POST',
            '/v1/admin/catalog/items/lookup',
            body
          );

          expect(res.status).toBe(400);
          expect(await res.json()).toMatchObject({ code: 'validation_failed' });
          expect(sent).toEqual([]);
        } finally {
          await nest.close();
        }
      }
    );

    describe('behind the real admin guard', () => {
      const authKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const adminKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const pem = (key: { export: (o: object) => string | Buffer }) =>
        key.export({ type: 'spki', format: 'pem' }).toString();
      const jwt = new JwtService();

      beforeAll(() => {
        // Each registers itself with passport under the name its guard asks for.
        new JwtStrategy({
          getOrThrow: () => ({ authJwtPublicKey: pem(authKeys.publicKey) }),
        } as never);
        new AdminJwtStrategy({
          getOrThrow: () => ({ adminJwtPublicKey: pem(adminKeys.publicKey) }),
        } as never);
      });

      async function bootGuarded() {
        const sent: SentMessage[] = [];
        const nest = (
          await Test.createTestingModule({
            controllers: [AdminCatalogItemsController],
            providers: [
              {
                provide: NatsClient,
                useValue: {
                  send: async (
                    subject: string,
                    payload: Record<string, unknown>
                  ) => {
                    sent.push({ subject, payload });
                    return { items: [] };
                  },
                },
              },
            ],
          }).compile()
        ).createNestApplication();
        nest.useGlobalPipes(createValidationPipe());
        nest.setGlobalPrefix('v1');
        await nest.init();
        await nest.listen(0);
        const { port } = nest.getHttpServer().address() as AddressInfo;
        return { nest, sent, origin: `http://127.0.0.1:${port}` };
      }

      function lookup(origin: string, token: string): Promise<Response> {
        return fetch(`${origin}/v1/admin/catalog/items/lookup`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ ids: uuids(2) }),
        });
      }

      it('refuses a shopper token and reads with an operator token', async () => {
        const shopper = jwt.sign(
          { sub: 'u1', kind: UserKind.REGISTERED },
          {
            privateKey: authKeys.privateKey,
            algorithm: 'RS256',
            expiresIn: '15m',
          }
        );
        const operator = jwt.sign(
          { sub: 'a1' },
          {
            privateKey: adminKeys.privateKey,
            algorithm: 'RS256',
            audience: ADMIN_TOKEN_AUDIENCE,
            expiresIn: '15m',
          }
        );
        const { nest, sent, origin } = await bootGuarded();
        try {
          const refused = await lookup(origin, shopper);
          expect(refused.status).toBe(401);
          expect(sent).toEqual([]);

          const read = await lookup(origin, operator);
          expect(read.status).toBe(201);
          expect(sent).toHaveLength(1);
        } finally {
          await nest.close();
        }
      });
    });
  });
});
