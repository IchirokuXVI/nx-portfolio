import { Test } from '@nestjs/testing';
import {
  ITEM_PATTERNS,
  UnitOfMeasure,
} from '@portfolio/luna-shopper/contracts';
import {
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
import type { AddressInfo } from 'node:net';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
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
});
