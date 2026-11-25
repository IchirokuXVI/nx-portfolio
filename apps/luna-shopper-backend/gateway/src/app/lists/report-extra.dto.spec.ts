import {
  BASKET_PATTERNS,
  LINE_PATTERNS,
} from '@portfolio/luna-shopper/contracts';
import { createValidationPipe } from '@portfolio/luna-shopper/platform';
import { BasketController } from '../baskets/basket.controller';
import {
  AddBasketLineDto,
  CountBasketRowExtraDto,
  SetBasketRowDemandDto,
} from '../baskets/basket.dto';
import { LinesController, ListsController } from './list.controller';
import { AddLineDto, AddLineQuantityDto, UpdateLineDto } from './list.dto';

/**
 * The flag of plan 0276 on the five requests that can raise a line, and the
 * body of the basket's count (spec 15 and 16), as the pipe every route uses
 * reads them; then what each controller hands core.
 */
const LINE = 'cf000000-0000-4000-a000-0000000000c2';
const LIST = 'cf000000-0000-4000-a000-0000000000c1';
const BASKET = 'cf000000-0000-4000-a000-0000000000d1';

const pipe = createValidationPipe();
const validate = (metatype: unknown, body: unknown) =>
  pipe.transform(body, { type: 'body', metatype: metatype as never });

const BODIES: [string, unknown, Record<string, unknown>][] = [
  ['AddLineQuantityDto', AddLineQuantityDto, { delta: 2, unit: 'UNIT' }],
  ['UpdateLineDto', UpdateLineDto, { quantity: 4 }],
  ['AddLineDto', AddLineDto, { content: 'Milk' }],
  [
    'AddBasketLineDto',
    AddBasketLineDto,
    { targetListId: LIST, content: 'Milk' },
  ],
  [
    'SetBasketRowDemandDto',
    SetBasketRowDemandDto,
    { lineId: LINE, quantity: 2, unit: 'UNIT', from: 0 },
  ],
];

describe.each(BODIES)('%s takes reportExtra (spec 15)', (_, dto, body) => {
  it.each([true, false])('accepts %s and keeps it', async (reportExtra) => {
    await expect(
      validate(dto, { ...body, reportExtra })
    ).resolves.toMatchObject({ reportExtra });
  });

  it('leaves it absent when the body does not send it', async () => {
    const read = (await validate(dto, body)) as Record<string, unknown>;
    expect(read['reportExtra']).toBeUndefined();
  });

  it.each(['true', 'false', 1, null])('refuses %p with a 400', async (flag) => {
    await expect(
      validate(dto, { ...body, reportExtra: flag })
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('AddLineQuantityDto after plan 0276', () => {
  it('refuses countExtra as an unknown field', async () => {
    await expect(
      validate(AddLineQuantityDto, { delta: 2, unit: 'UNIT', countExtra: true })
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('CountBasketRowExtraDto (spec 16)', () => {
  const body = { lineId: LINE, unit: 'UNIT', amount: 2, expect: 2 };

  it('accepts a count of what the line holds', async () => {
    await expect(validate(CountBasketRowExtraDto, body)).resolves.toMatchObject(
      body
    );
  });

  it.each([
    ['no lineId', { ...body, lineId: undefined }],
    ['no unit', { ...body, unit: undefined }],
    ['no amount', { ...body, amount: undefined }],
    ['no expect', { ...body, expect: undefined }],
    ['an amount of 0', { ...body, amount: 0 }],
    ['a fractional amount', { ...body, amount: 1.5 }],
    ['an amount above expect', { ...body, amount: 3 }],
    ['an amount spelled as a string', { ...body, amount: '2' }],
    ['an expect spelled as a string', { ...body, expect: '2' }],
    ['a negative expect', { ...body, amount: 1, expect: -1 }],
  ])('refuses %s with a 400', async (_, refused) => {
    await expect(
      validate(CountBasketRowExtraDto, refused)
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('what the controllers hand core (plan 0276)', () => {
  function broker() {
    const sent: { subject: unknown; payload: Record<string, unknown> }[] = [];
    const nats = {
      send: async (subject: unknown, payload: unknown) => {
        const body = JSON.parse(JSON.stringify(payload)) as Record<
          string,
          unknown
        >;
        if (subject === 'item.getMany') {
          return { items: [] };
        }
        sent.push({ subject, payload: body });
        return { entries: [], progress: { boughtCount: 0, lineCount: 0 } };
      },
    };
    return { sent, nats };
  }
  const USER = { userId: 'user-1' } as never;
  const OWNER = { participantId: 'p-1', userId: 'user-1' } as never;

  it('passes reportExtra on the delta, the edit and the add', async () => {
    const { sent, nats } = broker();
    const lines = new LinesController(nats as never, {} as never, {} as never);
    const lists = new ListsController(nats as never);

    await lines.addQuantity(USER, LINE, {
      delta: 2,
      unit: 'UNIT',
      reportExtra: true,
    });
    await lines.update(USER, LINE, { quantity: 4, reportExtra: true });
    await lists.addLine(USER, LIST, { content: 'Milk', reportExtra: true });

    expect(
      sent.find((s) => s.subject === LINE_PATTERNS.addQuantity)
    ).toMatchObject({ payload: { reportExtra: true } });
    expect(sent.find((s) => s.subject === LINE_PATTERNS.update)).toMatchObject({
      payload: { reportExtra: true },
    });
    expect(sent.find((s) => s.subject === LINE_PATTERNS.add)).toMatchObject({
      payload: { reportExtra: true },
    });
  });

  it('passes reportExtra on the demand and the basket add, and the count with its numbers', async () => {
    const { sent, nats } = broker();
    const basket = new BasketController(
      nats as never,
      {} as never,
      {} as never
    );

    await basket.demand(OWNER, BASKET, LINE, {
      lineId: LINE,
      quantity: 2,
      unit: 'UNIT',
      from: 0,
      reportExtra: true,
    });
    await basket.addLine(OWNER, BASKET, {
      targetListId: LIST,
      content: 'Milk',
      reportExtra: true,
    } as AddBasketLineDto);
    await basket.countExtra(OWNER, BASKET, LINE, {
      lineId: LINE,
      unit: 'UNIT',
      amount: 2,
      expect: 2,
    });

    expect(sent).toEqual([
      expect.objectContaining({
        subject: BASKET_PATTERNS.rowDemand,
        payload: expect.objectContaining({ reportExtra: true }),
      }),
      expect.objectContaining({
        subject: BASKET_PATTERNS.lineAdd,
        payload: expect.objectContaining({ reportExtra: true }),
      }),
      {
        subject: BASKET_PATTERNS.rowCountExtra,
        payload: {
          basketId: BASKET,
          participantId: 'p-1',
          rowKey: LINE,
          lineId: LINE,
          unit: 'UNIT',
          amount: 2,
          expect: 2,
        },
      },
    ]);
  });
});
