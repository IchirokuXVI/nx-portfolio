import { Test } from '@nestjs/testing';
import {
  ITEM_PATTERNS,
  LINE_PATTERNS,
  UnitOfMeasure,
  type GetItemsRequest,
  type LineUnitBasis,
} from '@portfolio/luna-shopper/contracts';
import {
  createValidationPipe,
  ERROR_CODES,
  GlobalExceptionFilter,
  LineUnitMismatchException,
} from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BasketController } from '../baskets/basket.controller';
import type { AddBasketLineDto } from '../baskets/basket.dto';
import { SettlePriceService } from '../baskets/settle-price.service';
import { NatsClient } from '../messaging/nats-client';
import { CommentTranscriptionService } from './comment-transcription.service';
import { LinesController, ListsController } from './list.controller';
import { VoiceRecordingInterceptor } from './voice-recording.interceptor';

/**
 * The unit of a line over real HTTP (plan 0246, sections 3.2, 4.1 and 4.2).
 *
 * Over HTTP because two of the three refusals are the gateway's own: the
 * validation pipe refuses a delta with no unit before core hears of it, and
 * the unit check refuses a unit the products of the line do not offer, with
 * the units they do offer in `details`. The third, a delta in another unit, is
 * core's, and this proves it reaches the client as a 409 with its code.
 */

const LIST = 'cf000000-0000-4000-a000-0000000000c1';
const LINE = 'cf000000-0000-4000-a000-0000000000c2';
/** A product sold by the kilo, with no size and no weight (plan 0244). */
const LOOSE = 'cf000000-0000-4000-a000-0000000000c3';
/** A pack of 500 g, which serves pieces and grams. */
const BAG = 'cf000000-0000-4000-a000-0000000000c4';
/** A box of six eggs, which serves pieces alone. */
const EGGS = 'cf000000-0000-4000-a000-0000000000c5';

/** What catalog knows of each product's size. */
const SIZES: Record<
  string,
  {
    defaultUnit: UnitOfMeasure;
    unitSize: number | null;
    approxWeight: number | null;
  }
> = {
  [LOOSE]: {
    defaultUnit: UnitOfMeasure.KILOGRAM,
    unitSize: null,
    approxWeight: null,
  },
  [BAG]: { defaultUnit: UnitOfMeasure.GRAM, unitSize: 500, approxWeight: null },
  [EGGS]: { defaultUnit: UnitOfMeasure.UNIT, unitSize: 6, approxWeight: null },
};

async function boot() {
  const sent: { subject: unknown; payload: Record<string, unknown> }[] = [];
  /** What core says the line counts in and holds. */
  let basis: LineUnitBasis = { unit: 'GRAM', itemIds: [LOOSE] };

  const nest = (
    await Test.createTestingModule({
      controllers: [ListsController, LinesController],
      providers: [
        {
          provide: NatsClient,
          useValue: {
            send: async (subject: unknown, payload: unknown) => {
              const body = JSON.parse(JSON.stringify(payload)) as Record<
                string,
                unknown
              >;
              sent.push({ subject, payload: body });
              if (subject === ITEM_PATTERNS.getMany) {
                const { ids } = body as unknown as GetItemsRequest;
                return {
                  items: ids
                    .filter((id) => SIZES[id])
                    .map((id) => ({ id, ...SIZES[id] })),
                };
              }
              if (subject === LINE_PATTERNS.unitBasis) {
                return basis;
              }
              if (
                subject === LINE_PATTERNS.addQuantity &&
                body['unit'] !== basis.unit
              ) {
                // Core's own refusal, as the broker hands it back.
                throw new LineUnitMismatchException(
                  'The line counts in another unit'
                );
              }
              return { id: LINE, line: { id: LINE }, merged: false };
            },
          },
        },
        { provide: CommentTranscriptionService, useValue: {} },
        { provide: SettlePriceService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp(): { getRequest(): Record<string, unknown> };
        }) => {
          context.switchToHttp().getRequest()['user'] = { userId: 'user-1' };
          return true;
        },
      })
      .overrideInterceptor(VoiceRecordingInterceptor)
      .useValue({
        intercept: (_: unknown, next: { handle(): unknown }) => next.handle(),
      })
      .compile()
  ).createNestApplication();

  nest.useGlobalPipes(createValidationPipe());
  nest.useGlobalFilters(
    new GlobalExceptionFilter({
      setContext: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    } as unknown as ConstructorParameters<typeof GlobalExceptionFilter>[0])
  );
  nest.setGlobalPrefix('v1');

  await nest.init();
  await nest.listen(0);
  const { port } = nest.getHttpServer().address() as AddressInfo;

  return {
    nest,
    sent,
    origin: `http://127.0.0.1:${port}`,
    setBasis: (next: LineUnitBasis) => {
      basis = next;
    },
  };
}

describe('the unit of a line over HTTP (plan 0246)', () => {
  let app: Awaited<ReturnType<typeof boot>>;

  const send = (method: string, path: string, body: unknown) =>
    fetch(`${app.origin}/v1/${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const coreWrites = () =>
    app.sent.filter(
      (entry) =>
        entry.subject !== ITEM_PATTERNS.getMany &&
        entry.subject !== LINE_PATTERNS.unitBasis
    );

  beforeAll(async () => {
    app = await boot();
  });

  afterAll(async () => {
    await app.nest.close();
  });

  beforeEach(() => {
    app.sent.length = 0;
    app.setBasis({ unit: 'GRAM', itemIds: [LOOSE] });
  });

  describe('POST /v1/lines/:id/quantity', () => {
    it('answers 400 for a delta without a unit, and core hears nothing', async () => {
      const response = await send('POST', `lines/${LINE}/quantity`, {
        delta: -250,
      });

      expect(response.status).toBe(400);
      expect(app.sent).toEqual([]);
    });

    it('answers 409 line_unit_mismatch for a delta in another unit than the line', async () => {
      const response = await send('POST', `lines/${LINE}/quantity`, {
        delta: 1,
        unit: 'UNIT',
      });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: ERROR_CODES.LINE_UNIT_MISMATCH,
      });
    });

    it('sends the unit to core with the delta', async () => {
      const response = await send('POST', `lines/${LINE}/quantity`, {
        delta: -250,
        unit: 'GRAM',
      });

      expect(response.status).toBe(201);
      expect(coreWrites()).toEqual([
        {
          subject: LINE_PATTERNS.addQuantity,
          payload: {
            userId: 'user-1',
            lineId: LINE,
            delta: -250,
            unit: 'GRAM',
          },
        },
      ]);
    });

    it('answers 400 for a unit that is not one of the three', async () => {
      const response = await send('POST', `lines/${LINE}/quantity`, {
        delta: 1,
        unit: 'KILOGRAM',
      });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /v1/lists/:id/lines', () => {
    it('answers 422 naming the offered units for a unit the products do not offer', async () => {
      const response = await send('POST', `lists/${LIST}/lines`, {
        content: 'Bananas',
        itemIds: [LOOSE],
        unit: 'UNIT',
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        code: ERROR_CODES.LINE_UNIT_NOT_OFFERED,
        details: { offered: ['GRAM'] },
      });
      // Nothing was written.
      expect(coreWrites()).toEqual([]);
    });

    it('treats an absent unit as UNIT, which a loose product does not offer', async () => {
      const response = await send('POST', `lists/${LIST}/lines`, {
        content: 'Bananas',
        itemIds: [LOOSE],
      });

      expect(response.status).toBe(422);
    });

    it('adds a loose product in grams and sends the unit to core', async () => {
      const response = await send('POST', `lists/${LIST}/lines`, {
        content: 'Bananas',
        itemIds: [LOOSE],
        unit: 'GRAM',
        quantity: 1000,
      });

      expect(response.status).toBe(201);
      expect(coreWrites()).toEqual([
        {
          subject: LINE_PATTERNS.add,
          payload: {
            userId: 'user-1',
            listId: LIST,
            content: 'Bananas',
            quantity: 1000,
            unit: 'GRAM',
            itemIds: [LOOSE],
          },
        },
      ]);
    });

    it('offers UNIT alone for a free text line, without asking catalog', async () => {
      const refused = await send('POST', `lists/${LIST}/lines`, {
        content: 'Ham 300 g',
        unit: 'GRAM',
      });
      expect(refused.status).toBe(422);
      expect(await refused.json()).toMatchObject({
        details: { offered: ['UNIT'] },
      });

      app.sent.length = 0;
      const counted = await send('POST', `lists/${LIST}/lines`, {
        content: 'Ham 300 g',
      });
      expect(counted.status).toBe(201);
      expect(app.sent.map((entry) => entry.subject)).toEqual([
        LINE_PATTERNS.add,
      ]);
    });

    it('lets a product the catalog no longer names widen nothing', async () => {
      const response = await send('POST', `lists/${LIST}/lines`, {
        content: 'Gone',
        itemIds: ['cf000000-0000-4000-a000-0000000000cf'],
        unit: 'GRAM',
      });

      expect(response.status).toBe(422);
    });
  });

  describe('POST /v1/lists/:id/lines/batch', () => {
    it('refuses the batch when one item asks for a unit its products do not offer', async () => {
      const response = await send('POST', `lists/${LIST}/lines/batch`, {
        items: [
          { content: 'Rice', itemIds: [BAG], unit: 'GRAM', quantity: 750 },
          { content: 'Bananas', itemIds: [LOOSE], unit: 'MILLILITER' },
        ],
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        details: { offered: ['GRAM'] },
      });
      // One catalog read for the whole batch, and no write.
      expect(app.sent.map((entry) => entry.subject)).toEqual([
        ITEM_PATTERNS.getMany,
      ]);
    });
  });

  describe('PATCH /v1/lines/:id', () => {
    it('checks a new unit against the products the line holds', async () => {
      const response = await send('PATCH', `lines/${LINE}`, {
        unit: 'UNIT',
        quantity: 1,
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        details: { offered: ['GRAM'] },
      });
      expect(app.sent.map((entry) => entry.subject)).toEqual([
        LINE_PATTERNS.unitBasis,
        ITEM_PATTERNS.getMany,
      ]);
    });

    it('checks new products against the unit the line counts in', async () => {
      // A line counted in grams, given a box of six eggs only.
      app.setBasis({ unit: 'GRAM', itemIds: [LOOSE] });

      const response = await send('PATCH', `lines/${LINE}`, {
        itemIds: [EGGS],
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        details: { offered: ['UNIT'] },
      });
    });

    it('passes a unit the products offer to core with its quantity', async () => {
      app.setBasis({ unit: 'UNIT', itemIds: [BAG] });

      const response = await send('PATCH', `lines/${LINE}`, {
        unit: 'GRAM',
        quantity: 1000,
      });

      expect(response.status).toBe(200);
      expect(coreWrites()).toEqual([
        {
          subject: LINE_PATTERNS.update,
          payload: {
            userId: 'user-1',
            lineId: LINE,
            quantity: 1000,
            unit: 'GRAM',
          },
        },
      ]);
    });

    it('asks nothing of core or catalog for an edit that names no unit and no product', async () => {
      const response = await send('PATCH', `lines/${LINE}`, { quantity: 3 });

      expect(response.status).toBe(200);
      expect(app.sent.map((entry) => entry.subject)).toEqual([
        LINE_PATTERNS.update,
      ]);
    });
  });
});

describe('the basket add checks the unit too (plan 0246, sections 3.2 and 4.2)', () => {
  /** A basket controller over a broker that answers catalog and records core. */
  function controller() {
    const sent: { subject: unknown; payload: Record<string, unknown> }[] = [];
    const nats = {
      send: async (subject: unknown, payload: unknown) => {
        const body = JSON.parse(JSON.stringify(payload)) as Record<
          string,
          unknown
        >;
        if (subject === ITEM_PATTERNS.getMany) {
          const { ids } = body as unknown as GetItemsRequest;
          return {
            items: ids
              .filter((id) => SIZES[id])
              .map((id) => ({ id, ...SIZES[id] })),
          };
        }
        sent.push({ subject, payload: body });
        return { lines: [] };
      },
    };
    return {
      sent,
      basket: new BasketController(nats as never, {} as never, {} as never),
    };
  }
  const OWNER = { participantId: 'p-1', userId: 'user-1' } as never;
  const BASKET = 'cf000000-0000-4000-a000-0000000000d1';

  it('refuses a unit the products do not offer, naming the offered units', async () => {
    const w = controller();

    await expect(
      w.basket.addLine(OWNER, BASKET, {
        targetListId: LIST,
        content: 'Bananas',
        itemIds: [LOOSE],
        unit: 'UNIT',
      } as AddBasketLineDto)
    ).rejects.toMatchObject({
      code: ERROR_CODES.LINE_UNIT_NOT_OFFERED,
      details: { offered: ['GRAM'] },
    });
    expect(w.sent).toEqual([]);
  });

  it('hands the unit to core beside the quantity', async () => {
    const w = controller();

    await w.basket.addLine(OWNER, BASKET, {
      targetListId: LIST,
      content: 'Bananas',
      itemIds: [LOOSE],
      unit: 'GRAM',
      quantity: 1000,
    } as AddBasketLineDto);

    expect(w.sent).toHaveLength(1);
    expect(w.sent[0].payload).toMatchObject({ unit: 'GRAM', quantity: 1000 });
  });
});
