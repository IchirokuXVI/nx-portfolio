import { Test } from '@nestjs/testing';
import {
  ITEM_PATTERNS,
  QUANTITY_STEPS,
} from '@portfolio/luna-shopper/contracts';
import {
  createValidationPipe,
  GlobalExceptionFilter,
  ITEM_QUANTITY_STEP_DETAIL,
  ITEM_QUANTITY_STEPS_ALLOWED_DETAIL,
  ItemQuantityStepNotAllowedException,
} from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import { NatsClient } from '../messaging/nats-client';
import { AdminCatalogItemsController } from './catalog-admin.controller';

/**
 * The step of a product on the admin product routes, over real HTTP (plan
 * 0261, section 3).
 *
 * The validation pipe refuses a step off the list before anything crosses the
 * broker, and the global filter answers catalog's refusal of a step on a
 * product that is not sold by the kilo or the litre with its code and its
 * details. Catalog's own rule is proven against Postgres in
 * `item-quantity-step.integration.spec.ts`.
 */

interface SentMessage {
  readonly subject: string;
  readonly payload: Record<string, unknown>;
}

const ITEM_ID = '11111111-1111-4111-8111-111111111111';

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

/** A product view shaped like catalog's, carrying the step it was sent. */
const view = (payload: Record<string, unknown>) => ({
  id: payload['itemId'] ?? ITEM_ID,
  quantityStep: payload['quantityStep'] ?? null,
});

describe('the step of a product, over HTTP (plan 0261)', () => {
  it('sends a step of 100 on an update and answers it', async () => {
    const { nest, sent, origin } = await boot(view);
    try {
      const res = await send(origin, 'PATCH', `/${ITEM_ID}`, {
        quantityStep: 100,
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ quantityStep: 100 });
      expect(sent).toEqual([
        {
          subject: ITEM_PATTERNS.update,
          payload: expect.objectContaining({
            itemId: ITEM_ID,
            quantityStep: 100,
          }),
        },
      ]);
    } finally {
      await nest.close();
    }
  });

  it('sends a null step, which clears it, and a step on a create, a batch and an expectation', async () => {
    const { nest, sent, origin } = await boot(view);
    try {
      expect(
        (await send(origin, 'PATCH', `/${ITEM_ID}`, { quantityStep: null }))
          .status
      ).toBe(200);
      expect(
        (
          await send(origin, 'POST', '', {
            name: { es: 'Pollo' },
            categoryIds: [ITEM_ID],
            defaultUnit: 'KILOGRAM',
            quantityStep: 250,
          })
        ).status
      ).toBe(201);
      expect(
        (
          await send(origin, 'PATCH', '/batch', {
            items: [
              {
                itemId: ITEM_ID,
                quantityStep: 5,
                expect: { quantityStep: null },
              },
            ],
          })
        ).status
      ).toBe(200);
      expect(sent.map((message) => message.payload['quantityStep'])).toEqual([
        null,
        250,
        undefined,
      ]);
      expect(sent[2].payload['items']).toEqual([
        { itemId: ITEM_ID, quantityStep: 5, expect: { quantityStep: null } },
      ]);
    } finally {
      await nest.close();
    }
  });

  it.each([[30], [0], [1500], [2.5], ['thirty']])(
    'refuses a step of %p with validation_failed naming the steps, and sends nothing',
    async (quantityStep) => {
      const { nest, sent, origin } = await boot(view);
      try {
        const res = await send(origin, 'PATCH', `/${ITEM_ID}`, {
          quantityStep,
        });

        expect(res.status).toBe(400);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body).toMatchObject({ code: 'validation_failed' });
        expect(JSON.stringify(body)).toContain('quantityStep');
        expect(JSON.stringify(body)).toContain(QUANTITY_STEPS.join(', '));
        expect(sent).toEqual([]);
      } finally {
        await nest.close();
      }
    }
  );

  it('reads a step written as a string as the number, as every number field of the body is', async () => {
    const { nest, sent, origin } = await boot(view);
    try {
      const res = await send(origin, 'PATCH', `/${ITEM_ID}`, {
        quantityStep: '100',
      });

      expect(res.status).toBe(200);
      expect(sent[0].payload['quantityStep']).toBe(100);
    } finally {
      await nest.close();
    }
  });

  it('answers catalog’s item_quantity_step_not_allowed as a 400 with the allowed steps', async () => {
    const details = {
      itemId: ITEM_ID,
      [ITEM_QUANTITY_STEP_DETAIL]: 100,
      [ITEM_QUANTITY_STEPS_ALLOWED_DETAIL]: [...QUANTITY_STEPS],
      defaultUnit: 'GRAM',
      unitSize: 500,
      approxWeight: null,
    };
    const { nest, origin } = await boot(() => {
      throw new ItemQuantityStepNotAllowedException('not loose', { details });
    });
    try {
      const res = await send(origin, 'PATCH', `/${ITEM_ID}`, {
        quantityStep: 100,
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        code: 'item_quantity_step_not_allowed',
        details,
      });
    } finally {
      await nest.close();
    }
  });
});
