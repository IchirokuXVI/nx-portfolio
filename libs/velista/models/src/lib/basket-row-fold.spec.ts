import { basketProgressOf, foldBasketEntries } from './basket-row-fold';
import type { BasketRow, BasketRowEntry } from './basket-view';

function entry(
  lineId: string,
  overrides: Partial<BasketRowEntry> = {}
): BasketRowEntry {
  const left = overrides.left ?? 2;
  const bought = overrides.bought ?? 0;
  return {
    lineId,
    listId: 'l-weekly',
    content: 'Leche',
    itemIds: ['p-milk'],
    favoriteItemId: null,
    canWrite: true,
    tripItemId: null,
    skipped: false,
    closed: false,
    act: null,
    left,
    bought,
    asked: left + bought,
    boughtElsewhere: 0,
    state: 'WANTED',
    awaitingApproval: false,
    demandEditable: true,
    ...overrides,
  };
}

function row(
  rowKey: string,
  entries: readonly BasketRowEntry[],
  overrides: Partial<BasketRow> = {}
): BasketRow {
  return {
    rowKey,
    content: 'Leche',
    productId: 'p-milk',
    left: entries.reduce((sum, held) => sum + held.left, 0),
    bought: 0,
    asked: entries.reduce((sum, held) => sum + held.left, 0),
    boughtElsewhere: 0,
    state: 'WANTED',
    note: null,
    noteAt: null,
    mark: null,
    awaitingApproval: false,
    touchedBy: null,
    touchedAt: null,
    entries,
    usual: { state: 'HERE', bought: 3, of: 6 },
    ...overrides,
  };
}

const SERVED = new Set(['l-weekly', 'l-basics']);

describe('foldBasketEntries', () => {
  const milk = row('a', [entry('a'), entry('b', { listId: 'l-basics' })]);
  const bread = row('c', [entry('c', { content: 'Pan', itemIds: [] })], {
    content: 'Pan',
    productId: null,
  });

  it('puts the answered lines back and rebuilds the row with the shared rules', () => {
    const act = {
      participantId: 'p-me',
      at: '2026-10-14T10:00:00.000Z',
      outcome: 'BOUGHT',
    };
    const [folded] = foldBasketEntries(
      [milk, bread],
      [
        entry('a', { left: 0, bought: 2, state: 'DONE', act }),
        entry('b', {
          listId: 'l-basics',
          left: 1,
          bought: 1,
          state: 'PARTLY',
          act,
        }),
      ],
      ['a', 'b'],
      SERVED
    );

    expect(folded).toMatchObject({
      rowKey: 'a',
      left: 1,
      bought: 3,
      asked: 4,
      state: 'PARTLY',
      touchedBy: 'p-me',
      // A fact of the read that no line carries, kept until the next read.
      usual: { state: 'HERE', bought: 3, of: 6 },
    });
    expect(folded.touchedAt?.toISOString()).toBe('2026-10-14T10:00:00.000Z');
  });

  it('leaves the rows the write did not touch as they were', () => {
    const folded = foldBasketEntries(
      [milk, bread],
      [entry('a')],
      ['a'],
      SERVED
    );

    expect(folded[1]).toBe(bread);
  });

  it('takes a named line that is not in the answer off its row, and keys the row by the next line', () => {
    const folded = foldBasketEntries([milk, bread], [], ['a'], SERVED);

    expect(folded.map((held) => held.rowKey)).toEqual(['b', 'c']);
    expect(folded[0].entries.map((held) => held.lineId)).toEqual(['b']);
  });

  it('drops a row whose every line left', () => {
    const folded = foldBasketEntries([milk, bread], [], ['c'], SERVED);

    expect(folded.map((held) => held.rowKey)).toEqual(['a']);
  });

  it('puts a line raised from zero into the row of its product, last', () => {
    const folded = foldBasketEntries(
      [milk, bread],
      [
        entry('z', {
          listId: 'l-basics',
          content: 'Leche para el café',
          left: 1,
        }),
      ],
      ['z'],
      SERVED
    );

    expect(folded[0].entries.map((held) => held.lineId)).toEqual([
      'a',
      'b',
      'z',
    ]);
    expect(folded[0].left).toBe(5);
  });

  it('puts a line counting as another product into its own row at the end', () => {
    const folded = foldBasketEntries(
      [milk, bread],
      [entry('n', { content: 'Avena', itemIds: ['p-oat', 'p-milk'], left: 1 })],
      [],
      SERVED
    );

    expect(folded[2]).toMatchObject({
      rowKey: 'n',
      content: 'Avena',
      productId: 'p-oat',
      left: 1,
    });
  });

  it('puts a free text line beside the row of its name', () => {
    const folded = foldBasketEntries(
      [milk, bread],
      [entry('d', { content: ' pan ', itemIds: [] })],
      [],
      SERVED
    );

    expect(folded).toHaveLength(2);
    expect(folded[1].entries.map((held) => held.lineId)).toEqual(['c', 'd']);
  });

  it('names a row by its anchor as the answer states it, after a rename', () => {
    const [, folded] = foldBasketEntries(
      [milk, bread],
      [entry('c', { content: 'Pan de centeno', itemIds: [] })],
      ['c'],
      SERVED
    );

    expect(folded.content).toBe('Pan de centeno');
  });

  it('names no list the reader was not served', () => {
    const [folded] = foldBasketEntries(
      [milk],
      [entry('a', { listId: 'l-office' })],
      ['a'],
      SERVED
    );

    expect(folded.entries[0].listId).toBeNull();
  });

  it('states a row bought elsewhere as the server does, by the shared rule', () => {
    const [folded] = foldBasketEntries(
      [row('a', [entry('a')])],
      [entry('a', { left: 0, boughtElsewhere: 2, state: 'BOUGHT_ELSEWHERE' })],
      ['a'],
      SERVED
    );

    expect(folded.state).toBe('BOUGHT_ELSEWHERE');
  });
});

describe('basketProgressOf', () => {
  it('counts rows, leaving out REMOVED and BOUGHT_ELSEWHERE, with SKIPPED pending', () => {
    const rows = (
      [
        'DONE',
        'NOT_AVAILABLE',
        'SKIPPED',
        'WANTED',
        'REMOVED',
        'BOUGHT_ELSEWHERE',
      ] as const
    ).map((state, at) => row(`r${at}`, [], { state }));

    expect(basketProgressOf(rows)).toEqual({
      progress: { done: 1, unavailable: 1, total: 4 },
      pending: 2,
    });
  });
});
