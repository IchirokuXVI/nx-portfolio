import { GeneratedListStatus } from '@portfolio/luna-shopper/contracts';
import {
  GeneratedListOrderService,
  type OrderableLine,
} from './generated-list-order.service';
import { ORDER_HISTORY_SQL, type OrderHistoryRow } from './generated-list.sql';

/**
 * The order a shopper walks (plan 0110), at the level the service decides it.
 *
 * Everything here is about **which line comes first**, which is the only part of
 * this feature a person can see. The query is faked by matching on the SQL
 * constant itself rather than on a string, the way the run spec beside it does,
 * so a rewritten query shows up as an unmocked read rather than as a silently
 * passing test.
 *
 * What this file cannot own is the query. Whether a reverted settlement is
 * excluded, whether a `NOT_AVAILABLE` one counts, whether a basket nobody
 * settled anything in uses up one of the seven, and which of two settlements on
 * one line the offset is taken from are all Postgres's answers, and they are
 * asserted in `generated-list-order.integration.spec.ts`.
 */

const OWNER = 'u-owner';

/** One shelf on one trip, with the two matching keys spelled out. */
function visit(
  tripId: string,
  content: string,
  offsetSeconds: number,
  items: { pick?: string | null; settled?: string[] } = {}
): OrderHistoryRow {
  return {
    tripId,
    content,
    pickItemId: items.pick ?? null,
    settledItemIds: items.settled ?? [],
    offsetSeconds,
  };
}

/** A composed line, which is all of one the order needs to see. */
function line(content: string, options: string[] = []): OrderableLine {
  return { content, options };
}

interface Harness {
  service: GeneratedListOrderService;
  /** Every parameter list the history query was asked with, in call order. */
  asked: unknown[][];
}

function build(history: OrderHistoryRow[]): Harness {
  const asked: unknown[][] = [];
  const lists = {
    query: async (sql: string, params: unknown[]): Promise<unknown[]> => {
      if (sql !== ORDER_HISTORY_SQL) {
        throw new Error(`unmocked query: ${sql.slice(0, 60)}`);
      }
      asked.push(params);
      return history;
    },
  };
  return { service: new GeneratedListOrderService(lists as never), asked };
}

/** The contents of the ordered lines, which is what the assertions are about. */
async function ordered(
  history: OrderHistoryRow[],
  composed: OrderableLine[]
): Promise<string[]> {
  const { service } = build(history);
  const walked = await service.order(OWNER, composed);
  return walked.map((entry) => entry.content);
}

describe('the order a shopper walks (plan 0110)', () => {
  it('orders a basket by when past trips settled each shelf', async () => {
    // The case the plan exists for: milk, then skimmed milk three seconds later,
    // then juice, because those are aisles. The lists say otherwise and the
    // lists are wrong about the shop.
    const history = ['t1', 't2', 't3'].flatMap((trip) => [
      visit(trip, 'Milk', 0),
      visit(trip, 'Skimmed milk', 3),
      visit(trip, 'Juice', 13),
    ]);

    expect(
      await ordered(history, [
        line('Juice'),
        line('Milk'),
        line('Skimmed milk'),
      ])
    ).toEqual(['Milk', 'Skimmed milk', 'Juice']);
  });

  it('reads the last seven finished trips, and only finished ones', async () => {
    const { service, asked } = build([]);

    await service.order(OWNER, [line('Milk')]);

    expect(asked).toEqual([
      [OWNER, [GeneratedListStatus.COMPLETED, GeneratedListStatus.ARCHIVED], 7],
    ]);
  });

  it('takes the median over the trips a product appears in', async () => {
    // Present in two trips of the history and absent from the third, which is
    // a median of two rather than of three: a trip that did not settle it says
    // nothing about where it sits.
    const history = [
      visit('t1', 'Milk', 5),
      visit('t1', 'Apples', 10),
      visit('t2', 'Milk', 5),
      visit('t2', 'Apples', 30),
      visit('t3', 'Milk', 5),
    ];

    expect(await ordered(history, [line('Apples'), line('Milk')])).toEqual([
      'Milk',
      'Apples',
    ]);
  });

  it('puts what the shopper has never settled last, A to Z', async () => {
    const history = [visit('t1', 'Milk', 40)];

    expect(
      await ordered(history, [
        line('Zucchini'),
        line('Ábaco'),
        line('Milk'),
        line('bread'),
      ])
    ).toEqual(['Milk', 'Ábaco', 'bread', 'Zucchini']);
  });

  it('orders a first basket alphabetically, having nothing else to go on', async () => {
    expect(
      await ordered([], [line('Milk'), line('Bread'), line('Apples')])
    ).toEqual(['Apples', 'Bread', 'Milk']);
  });

  it('keeps the composed order between two shelves reached at the same moment', async () => {
    const history = [visit('t1', 'Milk', 8), visit('t1', 'Butter', 8)];

    expect(await ordered(history, [line('Milk'), line('Butter')])).toEqual([
      'Milk',
      'Butter',
    ]);
    expect(await ordered(history, [line('Butter'), line('Milk')])).toEqual([
      'Butter',
      'Milk',
    ]);
  });

  it('matches a past line whose pick was swapped in the aisle', async () => {
    // The basket said Pascual and the shopper came back with Asturiana. Either
    // product names that shelf, because the option set is what the run composed
    // from.
    const history = [
      visit('t1', 'Leche', 2, {
        pick: 'item-pascual',
        settled: ['item-asturiana'],
      }),
      visit('t1', 'Bread', 60),
    ];

    expect(
      await ordered(history, [line('Bread'), line('Milk', ['item-asturiana'])])
    ).toEqual(['Milk', 'Bread']);
    expect(
      await ordered(history, [line('Bread'), line('Milk', ['item-pascual'])])
    ).toEqual(['Milk', 'Bread']);
  });

  it('matches a free text line on normalized content', async () => {
    const history = [visit('t1', 'Café', 3), visit('t1', 'Bread', 90)];

    expect(await ordered(history, [line('Bread'), line('  cafe ')])).toEqual([
      '  cafe ',
      'Bread',
    ]);
  });

  it('takes the product before the text, and does not fall back once it hits', async () => {
    // Two past shelves whose text agrees and whose products do not. The product
    // is an identity and the text is a spelling, so the product decides: on the
    // product the long life milk sits at 200 and comes after the bread, and on
    // the text it would sit at the median of the two, 101, and come before it.
    const history = [
      visit('t1', 'Milk', 2, { pick: 'item-fresh' }),
      visit('t1', 'Milk', 200, { pick: 'item-long-life' }),
      visit('t1', 'Bread', 150),
    ];

    expect(
      await ordered(history, [line('Bread'), line('Milk', ['item-long-life'])])
    ).toEqual(['Bread', 'Milk']);
  });

  it('counts a product twice in one trip as one visit to one shelf', async () => {
    // What a line split by the product that was got leaves behind (plan 0094):
    // two past lines, one trip, one shelf. The earliest of them is the visit,
    // and it must not weigh as two trips would.
    const history = [
      visit('t1', 'Milk', 5, { pick: 'item-milk' }),
      visit('t1', 'Milk', 95, { pick: 'item-milk' }),
      visit('t2', 'Bread', 50),
      visit('t1', 'Bread', 50),
    ];

    expect(
      await ordered(history, [line('Bread'), line('Milk', ['item-milk'])])
    ).toEqual(['Milk', 'Bread']);
  });

  it('asks nothing for a basket with no lines', async () => {
    const { service, asked } = build([]);

    expect(await service.order(OWNER, [])).toEqual([]);
    expect(asked).toEqual([]);
  });
});
