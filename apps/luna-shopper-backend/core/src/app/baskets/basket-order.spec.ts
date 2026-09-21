import { PURCHASE_SESSION_GAP_MS } from '@portfolio/luna-shopper/contracts';
import {
  BasketOrderService,
  WALK_HISTORY_HORIZON_MS,
  WALK_SESSIONS,
  type OrderableRow,
} from './basket-order.service';
import { WALK_HISTORY_SQL, type WalkHistoryRow } from './basket-order.sql';

/**
 * The order a shopper walks (plan 0141), at the level the service decides it.
 *
 * Everything here is about **which row comes first**, which is the only part of
 * this feature a person can see. The query is faked by matching on the SQL
 * constant itself rather than on a string, so a rewritten query shows up as an
 * unmocked read rather than as a silently passing test.
 *
 * What this file cannot own is the query. What a session is, which sessions have
 * ended, whether a reverted settlement is excluded, whether a `NOT_AVAILABLE`
 * one counts and which of two purchases on one line the offset is taken from are
 * all Postgres's answers, and they are asserted in
 * `basket-order.integration.spec.ts`.
 */

const OWNER = 'u-owner';
/** Fixed only within a run: every timestamp below is derived from it. */
const NOW = new Date();

/** One shelf, in one past session. */
function visit(
  sessionId: string,
  content: string,
  offsetSeconds: number,
  settledItemIds: string[] = []
): WalkHistoryRow {
  return { sessionId, content, settledItemIds, offsetSeconds };
}

/** A basket row, which is all of one the order needs to see. */
function row(
  content: string,
  optionIds: string[] = [],
  key = `k-${content}`
): OrderableRow {
  return { key, content, optionIds };
}

interface Harness {
  service: BasketOrderService;
  /** Every parameter list the history query was asked with, in call order. */
  asked: unknown[][];
}

function build(history: WalkHistoryRow[]): Harness {
  const asked: unknown[][] = [];
  const dataSource = {
    query: async (sql: string, params: unknown[]): Promise<unknown[]> => {
      if (sql !== WALK_HISTORY_SQL) {
        throw new Error(`unmocked query: ${sql.slice(0, 60)}`);
      }
      asked.push(params);
      return history;
    },
  };
  return { service: new BasketOrderService(dataSource as never), asked };
}

/** The contents of the ordered rows, which is what the assertions are about. */
async function ordered(
  history: WalkHistoryRow[],
  rows: OrderableRow[]
): Promise<string[]> {
  const { service } = build(history);
  const walked = await service.order(OWNER, rows, NOW);
  return walked.map((entry) => entry.content);
}

/** Every arrangement of an array, for the property rule 2 of section 2 states. */
function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) {
    return [items];
  }
  return items.flatMap((item, at) =>
    permutations([...items.slice(0, at), ...items.slice(at + 1)]).map(
      (rest) => [item, ...rest]
    )
  );
}

describe('the order a shopper walks (plan 0141)', () => {
  it('orders a basket by when past sessions settled each shelf', async () => {
    // The case the feature exists for: milk, then skimmed milk three seconds
    // later, then juice, because those are aisles. The lists say otherwise and
    // the lists are wrong about the shop.
    const history = ['s1', 's2', 's3'].flatMap((session) => [
      visit(session, 'Milk', 0),
      visit(session, 'Skimmed milk', 3),
      visit(session, 'Juice', 13),
    ]);
    const rows = [row('Juice'), row('Milk'), row('Skimmed milk')];

    for (const arrangement of permutations(rows)) {
      expect(await ordered(history, arrangement)).toEqual([
        'Milk',
        'Skimmed milk',
        'Juice',
      ]);
    }
  });

  it('reads the owner, the horizon, the gap, now and seven sessions', async () => {
    const { service, asked } = build([]);

    await service.order(OWNER, [row('Milk')], NOW);

    expect(asked).toEqual([
      [
        OWNER,
        new Date(NOW.getTime() - WALK_HISTORY_HORIZON_MS),
        PURCHASE_SESSION_GAP_MS,
        NOW,
        WALK_SESSIONS,
      ],
    ]);
    // `now` is an argument and never a clock read inside the rule, which is what
    // lets the integration spec state "the current session teaches nothing".
    expect(WALK_SESSIONS).toBe(7);
  });

  it('takes the median over the sessions a shelf appears in', async () => {
    // Present in two of seven sessions and absent from the rest, which is a
    // median of two rather than of seven: a session that did not settle it says
    // nothing about where it sits.
    const history = [
      ...['s1', 's2', 's3', 's4', 's5', 's6', 's7'].map((session) =>
        visit(session, 'Milk', 5)
      ),
      visit('s1', 'Apples', 10),
      visit('s2', 'Apples', 30),
    ];

    // Apples sits at 20, the median of 10 and 30, so it comes after the milk.
    expect(await ordered(history, [row('Apples'), row('Milk')])).toEqual([
      'Milk',
      'Apples',
    ]);
  });

  it('puts what the shopper has never settled last, A to Z', async () => {
    const history = [visit('s1', 'Milk', 40)];

    expect(
      await ordered(history, [
        row('Zucchini'),
        row('Ábaco'),
        row('Milk'),
        row('bread'),
      ])
    ).toEqual(['Milk', 'Ábaco', 'bread', 'Zucchini']);
  });

  it('orders a first basket alphabetically, having nothing else to go on', async () => {
    expect(
      await ordered([], [row('Milk'), row('Bread'), row('Apples')])
    ).toEqual(['Apples', 'Bread', 'Milk']);
  });

  it('matches a row by any product a past purchase copied', async () => {
    // The basket offers two cartons and the shopper came back with the second.
    // Either product names that shelf, because the row's option set is what the
    // shopper was choosing between.
    const history = [
      visit('s1', 'Leche', 2, ['item-asturiana']),
      visit('s1', 'Bread', 60),
    ];

    expect(
      await ordered(history, [row('Bread'), row('Milk', ['item-asturiana'])])
    ).toEqual(['Milk', 'Bread']);
  });

  it('matches a free text row on normalized content', async () => {
    const history = [visit('s1', 'Café', 3), visit('s1', 'Bread', 90)];

    expect(await ordered(history, [row('Bread'), row('  cafe ')])).toEqual([
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
      visit('s1', 'Milk', 2, ['item-fresh']),
      visit('s1', 'Milk', 200, ['item-long-life']),
      visit('s1', 'Bread', 150),
    ];

    expect(
      await ordered(history, [row('Bread'), row('Milk', ['item-long-life'])])
    ).toEqual(['Bread', 'Milk']);
  });

  it('counts two history rows of one session under one key once, from the earlier', async () => {
    // Two lines of one name in two lists, settled in one session: one shelf,
    // reached once. It must not weigh as two sessions would, and the visit is
    // the earlier of the two.
    const history = [
      visit('s1', 'Milk', 5, ['item-milk']),
      visit('s1', 'Milk', 95, ['item-milk']),
      visit('s1', 'Bread', 50),
      visit('s2', 'Bread', 50),
    ];

    expect(
      await ordered(history, [row('Bread'), row('Milk', ['item-milk'])])
    ).toEqual(['Milk', 'Bread']);
  });

  it('breaks a tie on the text and then on the key, whatever order the rows arrive in', async () => {
    // Rule 2 of section 2, stated as a property. Two shelves reached at the same
    // moment, and two rows of one name keyed apart: neither may depend on the
    // order the grouping happened to produce, because nothing about that order
    // is stable across pods.
    const history = [
      visit('s1', 'Milk', 8),
      visit('s1', 'Butter', 8),
      visit('s1', 'Leche', 8, ['item-milk']),
    ];
    const rows = [
      row('Milk', [], 'k-2'),
      row('Butter', [], 'k-9'),
      row('Milk', ['item-milk'], 'k-1'),
    ];

    for (const arrangement of permutations(rows)) {
      const { service } = build(history);
      const walked = await service.order(OWNER, arrangement, NOW);
      expect(walked.map((entry) => entry.key)).toEqual(['k-9', 'k-1', 'k-2']);
    }
  });

  it('inserts a row that arrives and moves nothing above it', async () => {
    // What happens during a shop: the basket follows its lists, so the set of
    // rows changes while the history does not. The new row takes its computed
    // slot, and every other row keeps its place relative to the rest.
    const history = [
      visit('s1', 'Milk', 0),
      visit('s1', 'Bread', 30),
      visit('s1', 'Juice', 60),
    ];
    const before = [row('Juice'), row('Milk'), row('Anchovies')];

    const was = await ordered(history, before);
    const now = await ordered(history, [...before, row('Bread')]);

    expect(was).toEqual(['Milk', 'Juice', 'Anchovies']);
    expect(now).toEqual(['Milk', 'Bread', 'Juice', 'Anchovies']);
    expect(now.filter((content) => content !== 'Bread')).toEqual(was);
  });

  it('asks nothing for a basket with no rows', async () => {
    const { service, asked } = build([]);

    expect(await service.order(OWNER, [], NOW)).toEqual([]);
    expect(asked).toEqual([]);
  });
});
