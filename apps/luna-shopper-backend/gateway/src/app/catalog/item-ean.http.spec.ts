import { Test } from '@nestjs/testing';
import {
  ITEM_PATTERNS,
  UnitOfMeasure,
} from '@portfolio/luna-shopper/contracts';
import {
  createValidationPipe,
  GlobalExceptionFilter,
  ITEM_EAN_DETAIL,
  ITEM_EAN_HOLDER_DETAIL,
  ITEM_EAN_REASON_DETAIL,
  ItemEanHeldException,
  ItemEanInvalidException,
} from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import { NatsClient } from '../messaging/nats-client';
import { AdminCatalogItemsController } from './catalog-admin.controller';

/**
 * The EAN of a product write, over real HTTP (plan 0184).
 *
 * Over HTTP rather than as function calls, for the reason
 * `catalog-admin-query.http.spec.ts` sets out: the status and the `code` of a
 * refusal are made by the global filter from the exception's class, and a
 * handler called as a function never meets it.
 *
 * Two things are asserted. The create refuses an EAN that is not a real
 * barcode before anything crosses the broker, with `item_ean_invalid`. The
 * update leaves that decision to catalog, which is the only service that
 * knows whether the write changes the EAN, and the gateway answers catalog's
 * refusal with the same status and the same code.
 */

interface SentMessage {
  readonly subject: string;
  readonly payload: Record<string, unknown>;
}

type Answers = Record<string, unknown | (() => unknown)>;

const ITEM_ID = '11111111-1111-4111-8111-111111111111';
const CATEGORY_ID = '22222222-2222-4222-8222-222222222222';

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
                ? (answer as () => unknown)()
                : (answer ?? { id: ITEM_ID });
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
  // The real filter, because the status and the code are what it makes.
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

function product(ean: unknown): Record<string, unknown> {
  return {
    name: { es: 'Queso', en: 'Cheese' },
    categoryIds: [CATEGORY_ID],
    defaultUnit: UnitOfMeasure.GRAM,
    ean,
  };
}

function post(origin: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('the EAN of a product write, over HTTP (plan 0184)', () => {
  it('answers 400 item_ean_invalid for a create with an 11 digit EAN, and sends nothing', async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await post(
        origin,
        '/v1/admin/catalog/items',
        product('84100100012')
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        status: 400,
        code: 'item_ean_invalid',
        details: {
          [ITEM_EAN_DETAIL]: '84100100012',
          [ITEM_EAN_REASON_DETAIL]: 'LENGTH',
        },
      });
      expect(sent).toEqual([]);
    } finally {
      await nest.close();
    }
  });

  it.each([
    ['an in-store code', '2204500000000', 'IN_STORE'],
    ['a wrong check digit', '4006381333932', 'CHECK_DIGIT'],
    ['a code with a space in it', '4006381 333931', 'NOT_DIGITS'],
  ])('refuses a create with %s the same way', async (_what, ean, reason) => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await post(origin, '/v1/admin/catalog/items', product(ean));

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        code: 'item_ean_invalid',
        details: { [ITEM_EAN_REASON_DETAIL]: reason },
      });
      expect(sent).toEqual([]);
    } finally {
      await nest.close();
    }
  });

  it('sends a real barcode on, trimmed, and no barcode as null', async () => {
    const { nest, sent, origin } = await boot();
    try {
      const real = await post(
        origin,
        '/v1/admin/catalog/items',
        product(' 4006381333931 ')
      );
      const none = await post(origin, '/v1/admin/catalog/items', product(null));

      expect(real.status).toBe(201);
      expect(none.status).toBe(201);
      expect(sent.map((message) => message.subject)).toEqual([
        ITEM_PATTERNS.create,
        ITEM_PATTERNS.create,
      ]);
      expect(sent[0].payload).toMatchObject({ ean: '4006381333931' });
      expect(sent[1].payload).toMatchObject({ ean: null });
    } finally {
      await nest.close();
    }
  });

  it('refuses a batch for one bad EAN, and sends nothing', async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await post(origin, '/v1/admin/catalog/items/batch', {
        items: [product('4006381333931'), product('84100100012')],
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'item_ean_invalid' });
      expect(sent).toEqual([]);
    } finally {
      await nest.close();
    }
  });

  it('leaves an update to catalog, and answers its refusal as 400 item_ean_invalid', async () => {
    const { nest, sent, origin } = await boot({
      [ITEM_PATTERNS.update]: () => {
        throw new ItemEanInvalidException('EAN 84100100012 is not a barcode.', {
          details: {
            [ITEM_EAN_DETAIL]: '84100100012',
            [ITEM_EAN_REASON_DETAIL]: 'LENGTH',
          },
        });
      },
    });
    try {
      const res = await fetch(`${origin}/v1/admin/catalog/items/${ITEM_ID}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ean: '84100100012' }),
      });

      // The gateway did not judge it: only catalog knows whether the product
      // already holds this code, and an unchanged code is never refused.
      expect(sent[0].subject).toBe(ITEM_PATTERNS.update);
      expect(sent[0].payload).toMatchObject({ ean: '84100100012' });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'item_ean_invalid' });
    } finally {
      await nest.close();
    }
  });

  it('sends an update that names an in-store code on, because the product may already hold it', async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await fetch(`${origin}/v1/admin/catalog/items/${ITEM_ID}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ean: '2204500000000', sku: 'X-1' }),
      });

      expect(res.status).toBe(200);
      expect(sent[0].payload).toMatchObject({
        itemId: ITEM_ID,
        ean: '2204500000000',
        sku: 'X-1',
      });
    } finally {
      await nest.close();
    }
  });
});

/**
 * A product's further barcodes, over real HTTP (plan 0185).
 *
 * The add refuses a code that is not a real barcode before anything crosses
 * the broker, as the create does. Whether another product holds the barcode is
 * catalog's to say, and the gateway answers that refusal with its own status
 * and code.
 */
describe('the barcodes of a product, over HTTP (plan 0185)', () => {
  const OTHER_ITEM = '33333333-3333-4333-8333-333333333333';
  const eans = `/v1/admin/catalog/items/${ITEM_ID}/eans`;

  it('adds a barcode: sends it on trimmed, and answers 201', async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await post(origin, eans, { ean: ' 8402001047251 ' });

      expect(res.status).toBe(201);
      expect(sent).toEqual([
        {
          subject: ITEM_PATTERNS.addEan,
          payload: expect.objectContaining({
            itemId: ITEM_ID,
            ean: '8402001047251',
          }),
        },
      ]);
    } finally {
      await nest.close();
    }
  });

  it.each([
    ['an in-store code', '2204500000000', 'IN_STORE'],
    ['an 11 digit code', '84100100012', 'LENGTH'],
    ['a wrong check digit', '4006381333932', 'CHECK_DIGIT'],
  ])(
    'refuses %s with 400 item_ean_invalid, and sends nothing',
    async (_what, ean, reason) => {
      const { nest, sent, origin } = await boot();
      try {
        const res = await post(origin, eans, { ean });

        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({
          code: 'item_ean_invalid',
          details: {
            [ITEM_EAN_DETAIL]: ean,
            [ITEM_EAN_REASON_DETAIL]: reason,
          },
        });
        expect(sent).toEqual([]);
      } finally {
        await nest.close();
      }
    }
  );

  it('refuses a body with no barcode as a validation failure', async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await post(origin, eans, {});

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'validation_failed' });
      expect(sent).toEqual([]);
    } finally {
      await nest.close();
    }
  });

  it('answers 409 item_ean_held, naming the holder, when another product holds the barcode', async () => {
    const { nest, origin } = await boot({
      [ITEM_PATTERNS.addEan]: () => {
        throw new ItemEanHeldException('Another product holds it.', {
          details: {
            [ITEM_EAN_DETAIL]: '8402001047251',
            [ITEM_EAN_HOLDER_DETAIL]: OTHER_ITEM,
          },
        });
      },
    });
    try {
      const res = await post(origin, eans, { ean: '8402001047251' });

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        status: 409,
        code: 'item_ean_held',
        details: {
          [ITEM_EAN_DETAIL]: '8402001047251',
          [ITEM_EAN_HOLDER_DETAIL]: OTHER_ITEM,
        },
      });
    } finally {
      await nest.close();
    }
  });

  it('removes a barcode named in the path', async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await fetch(`${origin}${eans}/8402001047251`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      expect(sent).toEqual([
        {
          subject: ITEM_PATTERNS.removeEan,
          payload: expect.objectContaining({
            itemId: ITEM_ID,
            ean: '8402001047251',
          }),
        },
      ]);
    } finally {
      await nest.close();
    }
  });
});
