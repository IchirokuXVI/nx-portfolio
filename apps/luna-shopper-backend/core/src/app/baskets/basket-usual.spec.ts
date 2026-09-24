import {
  BasketRowState,
  BasketRowUsualState,
  type BasketRowUsualView,
  type BasketRowView,
} from '@portfolio/luna-shopper/contracts';
import {
  roundHalfUp,
  usualLineIdsOf,
  usualOf,
  withUsual,
  type LineWindow,
} from './basket-usual';

/**
 * Where a row is usually bought, stated as a table (plan 0165, sections 1
 * and 3).
 *
 * A line's window is written as its purchases, newest first: `'M'` bought at
 * the read's chain, `'L'` at another chain, `'-'` at no chain anyone recorded.
 * `win` counts them the way `USUAL_WINDOWS_SQL` does, so each row of the table
 * reads as what happened in the shop. The query decides which six purchases are
 * in a window; the integration spec proves that half.
 */

const { NEVER_BOUGHT, NO_SHOP_KNOWN, ELSEWHERE, HERE } = BasketRowUsualState;

function win(purchases: string): LineWindow {
  const list = [...purchases];
  return {
    of: list.length,
    bought: list.filter((at) => at === 'M').length,
    named: list.filter((at) => at !== '-').length,
  };
}

function usual(
  state: BasketRowUsualState,
  bought: number,
  of: number
): BasketRowUsualView {
  return { state, bought, of };
}

describe('usualOf (plan 0165, section 1)', () => {
  const table: [string, string[], BasketRowUsualView][] = [
    // The four states.
    ['a row with no line bought', [''], usual(NEVER_BOUGHT, 0, 0)],
    ['a row with no lines at all', [], usual(NEVER_BOUGHT, 0, 0)],
    [
      'bought, and no purchase names a chain',
      ['---'],
      usual(NO_SHOP_KNOWN, 0, 3),
    ],
    ['bought only at another chain', ['LLL'], usual(ELSEWHERE, 0, 3)],
    ['bought at this chain every time', ['MMMMMM'], usual(HERE, 6, 6)],
    ['bought here once in six', ['LLMLLL'], usual(HERE, 1, 6)],
    // A chain named anywhere in a window decides between the last three.
    [
      'one named purchase among unnamed ones, elsewhere',
      ['---L'],
      usual(ELSEWHERE, 0, 4),
    ],
    [
      'one named purchase among unnamed ones, here',
      ['---M'],
      usual(HERE, 1, 4),
    ],
    ['bought here and elsewhere', ['MLML'], usual(HERE, 2, 4)],
    // Several lines: averages over the lines that have a window.
    ['two lines, 6 of 6 and 3 of 6', ['MMMMMM', 'MMMLLL'], usual(HERE, 5, 6)],
    [
      'two lines, averages of a half round up',
      ['MMMLLL', 'MMLLLL'],
      usual(HERE, 3, 6),
    ],
    [
      'two windows of 5 and 6 average 5.5 and round up',
      ['MLLLL', 'MLLLLL'],
      usual(HERE, 1, 6),
    ],
    [
      'three lines, 18 purchases, one here',
      ['MLLLLL', 'LLLLLL', 'LLLLLL'],
      usual(HERE, 1, 6),
    ],
    [
      'three lines, 4 here, an average of 1.33',
      ['MMLLLL', 'MLLLLL', 'MLLLLL'],
      usual(HERE, 1, 6),
    ],
    [
      'three lines, 5 here, an average of 1.67',
      ['MMLLLL', 'MMLLLL', 'MLLLLL'],
      usual(HERE, 2, 6),
    ],
    [
      'one line elsewhere, one never named',
      ['LL', '---'],
      usual(ELSEWHERE, 0, 3),
    ],
    ['two lines, neither named', ['--', '----'], usual(NO_SHOP_KNOWN, 0, 3)],
    // Section 3: the first weeks. A purchase before plan 0163 names no chain,
    // so a line bought only then is hidden; one purchase at a chosen shop heals
    // it, and it is here from then on.
    [
      'section 3: every purchase from before plan 0163',
      ['------'],
      usual(NO_SHOP_KNOWN, 0, 6),
    ],
    [
      'section 3: healed by one purchase at a chosen shop',
      ['M-----'],
      usual(HERE, 1, 6),
    ],
    [
      'section 3: healed at another chain, so elsewhere',
      ['L-----'],
      usual(ELSEWHERE, 0, 6),
    ],
    // Section 3: the averages ignore lines never bought.
    [
      'section 3: a never bought line does not halve the average',
      ['', 'MMMMMM'],
      usual(HERE, 6, 6),
    ],
    [
      'section 3: nor does it lower the window',
      ['', '', 'MM'],
      usual(HERE, 2, 2),
    ],
    [
      'section 3: a never bought line beside an elsewhere one',
      ['', 'LLL'],
      usual(ELSEWHERE, 0, 3),
    ],
    // Section 3: a settle is a purchase. Two taps on one trip are two
    // purchases, and both count.
    [
      'section 3: two settles on one trip count twice',
      ['MM'],
      usual(HERE, 2, 2),
    ],
  ];

  it.each(table)('%s', (_name, windows, expected) => {
    expect(usualOf(windows.map(win))).toEqual(expected);
  });

  it('never answers more purchases here than purchases counted', () => {
    const shapes = [
      '',
      'M',
      'L',
      '-',
      'MM',
      'ML',
      'M-',
      'L-',
      'MMMMMM',
      'LLLLLL',
    ];
    for (const a of shapes) {
      for (const b of shapes) {
        for (const c of shapes) {
          const answer = usualOf([a, b, c].map(win));
          expect(answer.bought).toBeLessThanOrEqual(answer.of);
          expect(answer.of).toBeLessThanOrEqual(6);
          // `of` is 0 only for a row never bought.
          expect(answer.of === 0).toBe(answer.state === NEVER_BOUGHT);
          // `HERE` never says 0, and nothing else says more.
          expect(answer.bought > 0).toBe(answer.state === HERE);
        }
      }
    }
  });
});

describe('roundHalfUp', () => {
  it.each([
    [0, 1, 0],
    [1, 3, 0],
    [1, 2, 1],
    [3, 2, 2],
    [5, 2, 3],
    [4, 3, 1],
    [5, 3, 2],
    [15, 6, 3],
    [17, 3, 6],
  ])('%i / %i is %i', (total, count, expected) => {
    expect(roundHalfUp(total, count)).toBe(expected);
  });
});

describe('withUsual (plan 0165, section 2)', () => {
  function row(rowKey: string, lineIds: string[]): BasketRowView {
    return {
      rowKey,
      content: rowKey,
      left: 1,
      bought: 0,
      asked: 1,
      state: BasketRowState.WANTED,
      note: null,
      noteAt: null,
      mark: null,
      awaitingApproval: false,
      optionIds: [],
      touchedBy: null,
      touchedAt: null,
      entries: lineIds.map((lineId) => ({
        lineId,
        left: 1,
        bought: 0,
        state: BasketRowState.WANTED,
        approvalStatus:
          'APPROVED' as BasketRowView['entries'][number]['approvalStatus'],
        demandEditable: true,
      })),
      usual: null,
    };
  }

  it('answers every row from the windows of its own entries', () => {
    const rows = [
      row('milk', ['l1', 'l2']),
      row('eggs', ['l3']),
      row('salt', ['l4']),
    ];
    const windows = [
      { lineId: 'l1', of: 6, bought: 6, named: 6 },
      { lineId: 'l2', of: 6, bought: 3, named: 6 },
      { lineId: 'l3', of: 2, bought: 0, named: 2 },
    ];
    expect(withUsual(rows, windows).map((r) => [r.rowKey, r.usual])).toEqual([
      ['milk', usual(HERE, 5, 6)],
      ['eggs', usual(ELSEWHERE, 0, 2)],
      ['salt', usual(NEVER_BOUGHT, 0, 0)],
    ]);
  });

  it('answers a removed row from the lines that went', () => {
    const gone = { ...row('gone', []), state: BasketRowState.REMOVED };
    const removed = new Map([['gone', ['l9']]]);
    expect(usualLineIdsOf([gone], removed)).toEqual(['l9']);
    const [answer] = withUsual(
      [gone],
      [{ lineId: 'l9', of: 1, bought: 1, named: 1 }],
      removed
    );
    expect(answer.usual).toEqual(usual(HERE, 1, 1));
  });

  it('asks about each line once, however many rows name it', () => {
    expect(
      usualLineIdsOf([row('a', ['l1', 'l2']), row('b', ['l2', 'l3'])])
    ).toEqual(['l1', 'l2', 'l3']);
  });
});
