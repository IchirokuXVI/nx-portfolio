import {
  composeListGroups,
  reorderWithinSlots,
  type GroupLineFacts,
  type ListGroupsInput,
} from './compose-list-groups';
import {
  DEFAULT_LIST_VIEW_STATE,
  NO_CATEGORY,
  type ListCategoryPick,
  type ListViewContext,
  type ListViewState,
} from './compose-list-view';
import { tripKey, type Trip, type TripRow } from './trips';

interface Row {
  readonly id: string;
  readonly content: string;
}

interface Seed extends Partial<GroupLineFacts> {
  readonly id: string;
  readonly content?: string;
  readonly category?: ListCategoryPick;
}

function trip(id: string, overrides: Partial<Trip> = {}): Trip {
  return {
    id,
    kind: 'BASKET',
    name: null,
    live: false,
    startedAt: new Date('2026-09-10T10:00:00.000Z'),
    lineCount: 1,
    boughtLineCount: 1,
    ...overrides,
  };
}

function tripRow(lineId: string, overrides: Partial<TripRow> = {}): TripRow {
  return {
    lineId,
    asked: 1,
    bought: 1,
    left: 0,
    outcome: 'BOUGHT',
    settledByUserId: null,
    ...overrides,
  };
}

function compose(
  seeds: readonly Seed[],
  options: {
    live?: readonly Trip[];
    past?: readonly Trip[];
    rows?: Readonly<Record<string, readonly TripRow[]>>;
    open?: readonly string[];
    reordering?: boolean;
    state?: Partial<ListViewState>;
    query?: string;
    due?: readonly string[];
  } = {}
) {
  const facts = new Map(
    seeds.map((seed) => [
      seed.id,
      {
        quantity: seed.quantity ?? 1,
        boughtCount: seed.boughtCount ?? 0,
        claimed: seed.claimed ?? false,
        rejected: seed.rejected ?? false,
      },
    ])
  );
  const input: ListGroupsInput<Row> = {
    lines: seeds.map((seed) => ({
      id: seed.id,
      content: seed.content ?? seed.id,
    })),
    factsOf: (lineId) => facts.get(lineId) ?? null,
    live: options.live ?? [],
    past: options.past ?? [],
    rowsOf: (key) => options.rows?.[key],
    openKeys: new Set(options.open ?? []),
    reordering: options.reordering ?? false,
    dueLineIds: options.due,
  };
  const context: ListViewContext = {
    query: options.query ?? '',
    locale: 'en',
    categoriesOf: (lineId) => [
      seeds.find((seed) => seed.id === lineId)?.category ?? NO_CATEGORY,
    ],
    productNamesOf: () => [],
    categoryLabel: (category) => category,
  };

  return composeListGroups(
    input,
    { ...DEFAULT_LIST_VIEW_STATE, ...options.state },
    context
  );
}

function groups(view: ReturnType<typeof compose>) {
  if (view.kind !== 'groups') {
    throw new Error('expected groups');
  }
  return view;
}

const ids = (rows: readonly { id: string }[]) => rows.map((row) => row.id);

describe('composeListGroups (velista 0088)', () => {
  const live = trip('b-live', { live: true });
  const liveKey = tripKey(live);

  describe('To buy (test 2)', () => {
    it('draws a claimed line in its live trip once the rows have arrived', () => {
      const view = groups(
        compose([{ id: 'milk', claimed: true }, { id: 'bread' }], {
          live: [live],
          rows: { [liveKey]: [tripRow('milk', { left: 1, bought: 0 })] },
          open: [liveKey],
        })
      );

      expect(ids(view.toBuy)).toEqual(['bread']);
      expect(view.trips[0].rows?.map((joined) => joined.line.id)).toEqual([
        'milk',
      ]);
    });

    it('keeps a claimed line in To buy while its trip has no rows yet', () => {
      const view = groups(
        compose([{ id: 'milk', claimed: true }, { id: 'bread' }], {
          live: [live],
        })
      );

      expect(ids(view.toBuy)).toEqual(['milk', 'bread']);
      expect(view.trips[0].rows).toBeNull();
    });

    it('puts a zero line with no purchase last, and a zero line with purchases nowhere in To buy', () => {
      const view = groups(
        compose([
          { id: 'saffron', quantity: 0, boughtCount: 0 },
          { id: 'eggs', quantity: 0, boughtCount: 3 },
          { id: 'bread', quantity: 2 },
        ])
      );

      expect(ids(view.toBuy)).toEqual(['bread', 'saffron']);
    });

    it('keeps rejected lines last of all', () => {
      const view = groups(
        compose([
          { id: 'rum', rejected: true },
          { id: 'saffron', quantity: 0 },
          { id: 'bread' },
        ])
      );

      expect(ids(view.toBuy)).toEqual(['bread', 'saffron', 'rum']);
    });
  });

  describe('trips (test 3)', () => {
    it('lists live trips first, then past trips, each open only when its key is open', () => {
      const older = trip('b-live-old', { live: true });
      const past = trip('b-past');
      const view = groups(
        compose([{ id: 'bread' }], {
          live: [live, older],
          past: [past],
          open: [liveKey],
        })
      );

      expect(view.trips.map((group) => [group.trip.id, group.open])).toEqual([
        ['b-live', true],
        ['b-live-old', false],
        ['b-past', false],
      ]);
    });

    it('draws nothing under To buy when there is no history', () => {
      expect(groups(compose([{ id: 'bread' }])).trips).toEqual([]);
    });

    it('does not draw a row whose line is not held', () => {
      const past = trip('b-past');
      const view = groups(
        compose([{ id: 'bread' }], {
          past: [past],
          rows: { [tripKey(past)]: [tripRow('gone'), tripRow('bread')] },
        })
      );

      expect(view.trips[0].rows?.map((joined) => joined.line.id)).toEqual([
        'bread',
      ]);
    });
  });

  describe('search, A to Z and the category (tests 10 and 11)', () => {
    it('flattens the page while a query is active, reaching lines that live only in trips', () => {
      const view = compose(
        [
          { id: 'eggs', content: 'Eggs', quantity: 0, boughtCount: 4 },
          { id: 'bread', content: 'Bread' },
        ],
        { live: [live], query: 'egg' }
      );

      expect(view.kind).toBe('flat');
      expect(view.kind === 'flat' && ids(view.lines)).toEqual(['eggs']);
    });

    it('orders the rows inside a trip A to Z and leaves the trips in date order', () => {
      const newer = trip('b-new', { startedAt: new Date('2026-09-15') });
      const older = trip('b-old', { startedAt: new Date('2026-09-01') });
      const view = groups(
        compose(
          [
            { id: 'milk', content: 'Milk', quantity: 0, boughtCount: 1 },
            { id: 'apples', content: 'Apples', quantity: 0, boughtCount: 1 },
          ],
          {
            past: [newer, older],
            rows: {
              [tripKey(newer)]: [tripRow('milk'), tripRow('apples')],
              [tripKey(older)]: [tripRow('milk')],
            },
            state: { order: 'alpha' },
          }
        )
      );

      expect(view.trips.map((group) => group.trip.id)).toEqual([
        'b-new',
        'b-old',
      ]);
      expect(view.trips[0].rows?.map((joined) => joined.line.id)).toEqual([
        'apples',
        'milk',
      ]);
    });

    it('narrows To buy and the rows to a category, and hides a trip with no row in it', () => {
      const dairy = trip('b-dairy');
      const bakery = trip('b-bakery');
      const view = groups(
        compose(
          [
            { id: 'milk', category: 'DAIRY' },
            { id: 'bread', category: 'BAKERY' },
            { id: 'cheese', category: 'DAIRY', quantity: 0, boughtCount: 1 },
          ],
          {
            past: [dairy, bakery],
            rows: {
              [tripKey(dairy)]: [tripRow('cheese'), tripRow('bread')],
              [tripKey(bakery)]: [tripRow('bread')],
            },
            state: { view: 'category', category: 'DAIRY' },
          }
        )
      );

      expect(view.category).toBe('DAIRY');
      expect(ids(view.toBuy)).toEqual(['milk']);
      expect(view.trips.map((group) => group.trip.id)).toEqual(['b-dairy']);
      expect(view.trips[0].rows?.map((joined) => joined.line.id)).toEqual([
        'cheese',
      ]);
    });
  });

  describe('reorder mode (test 12)', () => {
    it('shows To buy alone, without the zero lines and without any trip', () => {
      const view = groups(
        compose(
          [
            { id: 'bread' },
            { id: 'saffron', quantity: 0 },
            { id: 'milk', claimed: true },
          ],
          {
            live: [live],
            rows: { [liveKey]: [tripRow('milk')] },
            reordering: true,
          }
        )
      );

      expect(ids(view.toBuy)).toEqual(['bread']);
      expect(view.trips).toEqual([]);
    });
  });
});

describe('composeListGroups, the due lines (velista 0089)', () => {
  const bought = { quantity: 0, boughtCount: 3 };

  it('draws the due lines in the server order and says where the wanted lines end', () => {
    const view = groups(
      compose(
        [
          { id: 'bread' },
          { id: 'eggs', ...bought },
          { id: 'saffron', quantity: 0 },
          { id: 'coffee', ...bought },
        ],
        { due: ['coffee', 'eggs'] }
      )
    );

    expect(ids(view.due)).toEqual(['coffee', 'eggs']);
    expect(ids(view.toBuy)).toEqual(['bread', 'saffron']);
    expect(view.wantedCount).toBe(1);
  });

  it('leaves out a due line whose line is above zero or is not held (test 3)', () => {
    const view = groups(
      compose(
        [
          { id: 'eggs', quantity: 2, boughtCount: 3 },
          { id: 'coffee', ...bought },
        ],
        {
          due: ['eggs', 'gone', 'coffee'],
        }
      )
    );

    expect(ids(view.due)).toEqual(['coffee']);
  });

  it('leaves out a rejected or claimed line, and names a line once', () => {
    const view = groups(
      compose(
        [
          { id: 'eggs', ...bought, rejected: true },
          { id: 'milk', ...bought, claimed: true },
          { id: 'coffee', ...bought },
        ],
        { due: ['eggs', 'milk', 'coffee', 'coffee'] }
      )
    );

    expect(ids(view.due)).toEqual(['coffee']);
  });

  it('draws none in reorder mode, during a search, or when nothing is due (test 4)', () => {
    const seeds = [{ id: 'bread' }, { id: 'eggs', ...bought }];

    expect(
      groups(compose(seeds, { due: ['eggs'], reordering: true })).due
    ).toEqual([]);
    expect(compose(seeds, { due: ['eggs'], query: 'egg' }).kind).toBe('flat');
    expect(groups(compose(seeds, { due: [] })).due).toEqual([]);
    expect(groups(compose(seeds)).due).toEqual([]);
  });

  it('keeps only the due lines of the category on view, in the server order (test 5)', () => {
    const view = groups(
      compose(
        [
          { id: 'yogurt', ...bought, category: 'DAIRY', content: 'Yogurt' },
          { id: 'coffee', ...bought, category: 'PANTRY', content: 'Coffee' },
          { id: 'butter', ...bought, category: 'DAIRY', content: 'Butter' },
        ],
        {
          due: ['yogurt', 'coffee', 'butter'],
          state: { view: 'category', category: 'DAIRY', order: 'alpha' },
        }
      )
    );

    expect(ids(view.due)).toEqual(['yogurt', 'butter']);
  });
});

describe('reorderWithinSlots (velista 0088, test 12)', () => {
  const all = ['a', 'hidden-1', 'b', 'hidden-2', 'c'];

  it('moves the shown lines through their own slots and keeps every unseen line in its slot', () => {
    expect(reorderWithinSlots(all, ['a', 'b', 'c'], 'c', 0)).toEqual([
      'c',
      'hidden-1',
      'a',
      'hidden-2',
      'b',
    ]);
  });

  it('answers null for a move that changes nothing or names a stranger', () => {
    expect(reorderWithinSlots(all, ['a', 'b', 'c'], 'a', 0)).toBeNull();
    expect(reorderWithinSlots(all, ['a', 'b', 'c'], 'a', 3)).toBeNull();
    expect(reorderWithinSlots(all, ['a', 'x'], 'a', 1)).toBeNull();
  });
});
