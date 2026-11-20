import {
  BasketStatus,
  type AddBasketLineRequest,
  type AddLineRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  LineAddNeedsChoiceException,
  LineUnitDiffersException,
} from '@portfolio/luna-shopper/platform';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import type { LineService } from '../lists/line.service';
import type { ProfileService } from '../profiles/profile.service';
import { BasketLineAddService } from './basket-line-add.service';
import type { BasketProductChangeService } from './basket-product-change.service';
import type { BasketWriteContext } from './basket-write.context';

/**
 * The basket's add is the list's add (plan 0228, section "Context").
 *
 * `BasketLineAddService` decides nothing about where a typed name lands: it
 * hands the three fields of plan 0228 to `LineService.add` as they arrived, and
 * the refusal that asks which line reaches the basket route unchanged. Which
 * line the add lands on is `line-add-merge.spec.ts`.
 */

const BASKET = 'b-1';
const PARTICIPANT = 'p-1';
const USER = 'u-1';
const LIST = 'l-1';

function build(add: (req: AddLineRequest) => Promise<unknown>) {
  const sent: AddLineRequest[] = [];
  const context = {
    open: async () => ({
      basket: { id: BASKET, status: BasketStatus.OPEN },
      participant: { id: PARTICIPANT, userId: USER },
      servedListIds: new Set([LIST]),
      coveredListIds: [LIST],
      via: () => ({
        participantId: PARTICIPANT,
        basketId: BASKET,
        userId: USER,
      }),
      result: async (lineIds: string[]) => ({ lineIds }),
    }),
  } as unknown as BasketWriteContext;
  const lines = {
    add: async (req: AddLineRequest) => {
      sent.push(req);
      return add(req);
    },
  } as unknown as LineService;
  const service = new BasketLineAddService(
    context,
    lines,
    {} as ProfileService,
    {} as CoreEventsPublisher,
    {} as BasketProductChangeService
  );
  return { service, sent };
}

const request = (
  extra: Partial<AddBasketLineRequest> = {}
): AddBasketLineRequest => ({
  basketId: BASKET,
  participantId: PARTICIPANT,
  userId: USER,
  targetListId: LIST,
  content: 'Leche entera',
  ...extra,
});

describe('a typed name added from a basket (plan 0228)', () => {
  it('hands the question and its answers to the list add as they arrived', async () => {
    const { service, sent } = build(async () => ({
      line: { id: 'li-1' },
      merged: true,
    }));

    await service.add(
      request({ askIfAmbiguous: true, intoLineId: 'li-1', newLine: false })
    );

    expect(sent).toEqual([
      expect.objectContaining({
        userId: USER,
        listId: LIST,
        content: 'Leche entera',
        askIfAmbiguous: true,
        intoLineId: 'li-1',
        newLine: false,
      }),
    ]);
  });

  it('adds nothing of its own when the body carries none of the three', async () => {
    const { service, sent } = build(async () => ({
      line: { id: 'li-1' },
      merged: false,
    }));

    await service.add(request());

    expect(sent[0].askIfAmbiguous).toBeUndefined();
    expect(sent[0].intoLineId).toBeUndefined();
    expect(sent[0].newLine).toBeUndefined();
  });

  it('lets the refusal that asks which line reach the route unchanged', async () => {
    const refusal = new LineAddNeedsChoiceException('two lines', {
      details: { lines: [] },
      messageArgs: { content: 'Leche entera' },
    });
    const { service } = build(async () => {
      throw refusal;
    });

    await expect(service.add(request({ askIfAmbiguous: true }))).rejects.toBe(
      refusal
    );
  });
});

describe('what a basket add answers (plan 0260, section 2)', () => {
  it('passes the outcome on as addOutcome, naming the line it wrote', async () => {
    for (const outcome of ['CREATED', 'RAISED'] as const) {
      const { service } = build(async () => ({
        line: { id: 'li-1' },
        merged: outcome === 'RAISED',
        outcome,
        alreadyOnList: [],
      }));

      expect(await service.add(request())).toEqual({
        lineIds: ['li-1'],
        addOutcome: outcome,
      });
    }
  });

  it('names every line met in the entries when the add met wanted lines', async () => {
    const { service } = build(async () => ({
      line: { id: 'li-1' },
      merged: true,
      outcome: 'ALREADY_ON_LIST',
      alreadyOnList: [{ id: 'li-1' }, { id: 'li-2' }],
    }));

    expect(await service.add(request())).toEqual({
      lineIds: ['li-1', 'li-2'],
      addOutcome: 'ALREADY_ON_LIST',
    });
  });

  it('lets the refusal of another unit reach the route unchanged', async () => {
    const refusal = new LineUnitDiffersException('another unit', {
      details: {
        line: { lineId: 'li-1', content: 'Leche', unit: 'UNIT', quantity: 2 },
        unit: 'GRAM',
        index: null,
      },
      messageArgs: { content: 'Leche' },
    });
    const { service } = build(async () => {
      throw refusal;
    });

    await expect(
      service.add(request({ itemIds: ['i-1'], unit: 'GRAM' }))
    ).rejects.toBe(refusal);
  });
});
