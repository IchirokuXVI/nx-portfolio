import {
  BASKET_RULE_ACT_SKIPPED,
  BASKET_RULE_STATES,
  cheapestOf,
  lineProductOf,
  needsPriceChoice,
  progressOf,
  rowNumbersOf,
  rowStateOf,
  type BasketRuleAct,
  type BasketRuleEntry,
  type BasketRuleLine,
  type BasketRulePrice,
} from './basket-rules';

const T1 = '2026-10-13T10:00:00.000Z';
const T2 = '2026-10-13T10:05:00.000Z';
const T3 = '2026-10-13T10:10:00.000Z';

function act(outcome: string, at = T1, participantId = 'p1'): BasketRuleAct {
  return { participantId, at, outcome };
}

function entry(over: Partial<BasketRuleEntry> = {}): BasketRuleEntry {
  return {
    left: 1,
    bought: 0,
    boughtElsewhere: 0,
    skipped: false,
    closed: false,
    act: null,
    ...over,
  };
}

const bought = (at = T1) => act('BOUGHT', at);
const closed = (at = T1) => act('NOT_AVAILABLE', at);
const skipped = (at = T1) => act(BASKET_RULE_ACT_SKIPPED, at);

describe('rowStateOf, the state table of plan 0130 section 4', () => {
  describe('WANTED', () => {
    it('is a row nobody touched', () => {
      expect(rowStateOf([entry({ left: 2 })])).toBe(BASKET_RULE_STATES.WANTED);
    });

    it('is a row with no entries', () => {
      expect(rowStateOf([])).toBe(BASKET_RULE_STATES.WANTED);
    });

    it('is a row at zero that nobody bought', () => {
      expect(rowStateOf([entry({ left: 0 })])).toBe(BASKET_RULE_STATES.WANTED);
    });

    it('is a row whose close ran out', () => {
      expect(
        rowStateOf([entry({ left: 1, closed: false, act: closed() })])
      ).toBe(BASKET_RULE_STATES.WANTED);
    });

    it('is a row whose skip ran out', () => {
      expect(
        rowStateOf([entry({ left: 1, skipped: false, act: skipped() })])
      ).toBe(BASKET_RULE_STATES.WANTED);
    });

    it('is a row that another basket bought some of, with some left', () => {
      expect(rowStateOf([entry({ left: 2, boughtElsewhere: 1 })])).toBe(
        BASKET_RULE_STATES.WANTED
      );
    });
  });

  describe('PARTLY', () => {
    it('is something left and something bought here', () => {
      expect(rowStateOf([entry({ left: 2, bought: 1, act: bought() })])).toBe(
        BASKET_RULE_STATES.PARTLY
      );
    });

    it('sums over the entries: one bought out, one untouched', () => {
      expect(
        rowStateOf([
          entry({ left: 0, bought: 2, act: bought() }),
          entry({ left: 1 }),
        ])
      ).toBe(BASKET_RULE_STATES.PARTLY);
    });
  });

  describe('DONE', () => {
    it('is nothing left and something bought here', () => {
      expect(rowStateOf([entry({ left: 0, bought: 3, act: bought() })])).toBe(
        BASKET_RULE_STATES.DONE
      );
    });

    it('is nothing left, some bought here and the rest elsewhere', () => {
      expect(
        rowStateOf([entry({ left: 0, bought: 2, boughtElsewhere: 1 })])
      ).toBe(BASKET_RULE_STATES.DONE);
    });

    it('wins over a close when nothing is left', () => {
      expect(
        rowStateOf([
          entry({ left: 0, bought: 1, closed: true, act: closed(T2) }),
        ])
      ).toBe(BASKET_RULE_STATES.DONE);
    });
  });

  describe('BOUGHT_ELSEWHERE (plan 0203, section 3)', () => {
    it('is nothing left, none bought here and some bought elsewhere', () => {
      expect(rowStateOf([entry({ left: 0, boughtElsewhere: 2 })])).toBe(
        BASKET_RULE_STATES.BOUGHT_ELSEWHERE
      );
    });

    it('needs nothing left on any entry', () => {
      expect(
        rowStateOf([entry({ left: 0, boughtElsewhere: 1 }), entry({ left: 1 })])
      ).toBe(BASKET_RULE_STATES.WANTED);
    });

    it('needs this basket to have bought none of any entry', () => {
      expect(
        rowStateOf([
          entry({ left: 0, boughtElsewhere: 1 }),
          entry({ left: 0, bought: 1, act: bought() }),
        ])
      ).toBe(BASKET_RULE_STATES.DONE);
    });

    it('is not met by a skip or a close, which need something left', () => {
      expect(
        rowStateOf([
          entry({
            left: 0,
            boughtElsewhere: 1,
            skipped: true,
            act: skipped(),
          }),
        ])
      ).toBe(BASKET_RULE_STATES.BOUGHT_ELSEWHERE);
      expect(
        rowStateOf([
          entry({ left: 0, boughtElsewhere: 1, closed: true, act: closed() }),
        ])
      ).toBe(BASKET_RULE_STATES.BOUGHT_ELSEWHERE);
    });

    it('becomes WANTED when a line is raised above zero', () => {
      expect(rowStateOf([entry({ left: 1, boughtElsewhere: 1 })])).toBe(
        BASKET_RULE_STATES.WANTED
      );
    });
  });

  describe('NOT_AVAILABLE', () => {
    it('is something left and a close that holds', () => {
      expect(
        rowStateOf([entry({ left: 1, closed: true, act: closed() })])
      ).toBe(BASKET_RULE_STATES.NOT_AVAILABLE);
    });

    it('wins over PARTLY', () => {
      expect(
        rowStateOf([
          entry({ left: 1, bought: 1, closed: true, act: closed(T2) }),
        ])
      ).toBe(BASKET_RULE_STATES.NOT_AVAILABLE);
    });

    it('follows the newest purchase or close over the row', () => {
      const closedFirst = [
        entry({ left: 1, closed: true, act: closed(T1) }),
        entry({ left: 1, bought: 1, act: bought(T2) }),
      ];
      const closedLast = [
        entry({ left: 1, bought: 1, act: bought(T1) }),
        entry({ left: 1, closed: true, act: closed(T2) }),
      ];
      expect(rowStateOf(closedFirst)).toBe(BASKET_RULE_STATES.PARTLY);
      expect(rowStateOf(closedLast)).toBe(BASKET_RULE_STATES.NOT_AVAILABLE);
    });

    it('does not depend on the order of the entries', () => {
      const entries = [
        entry({ left: 1, bought: 1, act: bought(T1) }),
        entry({ left: 1, closed: true, act: closed(T2) }),
      ];
      expect(rowStateOf([...entries].reverse())).toBe(rowStateOf(entries));
    });

    it('holds beside an entry that was skipped later', () => {
      // One entry is not skipped, so the row is not `SKIPPED`, and the skip of
      // the other is no purchase or close to be the newest of.
      expect(
        rowStateOf([
          entry({ left: 1, closed: true, act: closed(T1) }),
          entry({ left: 1, skipped: true, act: skipped(T2) }),
        ])
      ).toBe(BASKET_RULE_STATES.NOT_AVAILABLE);
    });
  });

  describe('SKIPPED', () => {
    it('is every asking entry skipped', () => {
      expect(
        rowStateOf([
          entry({ left: 1, skipped: true, act: skipped() }),
          entry({ left: 2, skipped: true, act: skipped() }),
        ])
      ).toBe(BASKET_RULE_STATES.SKIPPED);
    });

    it('does not ask an entry at zero', () => {
      expect(
        rowStateOf([
          entry({ left: 0, bought: 1, act: bought() }),
          entry({ left: 2, skipped: true, act: skipped(T2) }),
        ])
      ).toBe(BASKET_RULE_STATES.SKIPPED);
    });

    it('is lost to one asking entry that is not skipped', () => {
      expect(
        rowStateOf([
          entry({ left: 1, skipped: true, act: skipped() }),
          entry({ left: 1 }),
        ])
      ).toBe(BASKET_RULE_STATES.WANTED);
    });

    it('is tested before NOT_AVAILABLE', () => {
      expect(
        rowStateOf([
          entry({ left: 1, skipped: true, act: skipped(T2) }),
          entry({ left: 0, closed: true, act: closed(T1) }),
        ])
      ).toBe(BASKET_RULE_STATES.SKIPPED);
    });

    it('is not a row with nothing left', () => {
      expect(
        rowStateOf([entry({ left: 0, skipped: true, act: skipped() })])
      ).toBe(BASKET_RULE_STATES.WANTED);
    });
  });

  it('never answers REMOVED', () => {
    const all = [
      [],
      [entry()],
      [entry({ left: 0 })],
      [entry({ left: 0, bought: 1 })],
      [entry({ skipped: true })],
      [entry({ closed: true, act: closed() })],
    ].map((entries) => rowStateOf(entries));
    expect(all).not.toContain(BASKET_RULE_STATES.REMOVED);
  });
});

describe('rowNumbersOf', () => {
  it('sums the entries, and asked is bought plus left', () => {
    expect(
      rowNumbersOf([
        entry({ left: 2, bought: 1, boughtElsewhere: 1 }),
        entry({ left: 0, bought: 3, boughtElsewhere: 0 }),
      ])
    ).toEqual({ left: 2, bought: 4, asked: 6, boughtElsewhere: 1, act: null });
  });

  it('keeps bought elsewhere out of asked', () => {
    expect(rowNumbersOf([entry({ left: 1, boughtElsewhere: 5 })]).asked).toBe(
      1
    );
  });

  it('answers zeros and no act for no entries', () => {
    expect(rowNumbersOf([])).toEqual({
      left: 0,
      bought: 0,
      asked: 0,
      boughtElsewhere: 0,
      act: null,
    });
  });

  it('names the newest act, whatever its kind', () => {
    const numbers = rowNumbersOf([
      entry({ act: bought(T1) }),
      entry({ act: skipped(T3) }),
      entry({ act: closed(T2) }),
    ]);
    expect(numbers.act).toEqual(skipped(T3));
  });

  it('prefers a purchase to a skip at the same instant, in either order', () => {
    const settled = bought(T2);
    expect(
      rowNumbersOf([entry({ act: skipped(T2) }), entry({ act: settled })]).act
    ).toEqual(settled);
    expect(
      rowNumbersOf([entry({ act: settled }), entry({ act: skipped(T2) })]).act
    ).toEqual(settled);
  });
});

describe('progressOf', () => {
  const rows = (...states: string[]) => states.map((state) => ({ state }));

  it('counts done, unavailable and the rest as pending', () => {
    expect(
      progressOf(
        rows('WANTED', 'PARTLY', 'DONE', 'DONE', 'NOT_AVAILABLE', 'SKIPPED')
      )
    ).toEqual({ done: 2, unavailable: 1, total: 6, pending: 3 });
  });

  it('counts a removed row for nothing', () => {
    expect(progressOf(rows('REMOVED', 'DONE', 'WANTED'))).toEqual({
      done: 1,
      unavailable: 0,
      total: 2,
      pending: 1,
    });
  });

  it('counts a row bought elsewhere for nothing (plan 0203, section 4)', () => {
    expect(
      progressOf(rows('BOUGHT_ELSEWHERE', 'DONE', 'WANTED', 'NOT_AVAILABLE'))
    ).toEqual({ done: 1, unavailable: 1, total: 3, pending: 1 });
  });

  it('answers zeros for no rows', () => {
    expect(progressOf([])).toEqual({
      done: 0,
      unavailable: 0,
      total: 0,
      pending: 0,
    });
  });
});

describe('applying a patch twice', () => {
  it('gives the state that applying it once gives', () => {
    const before = [entry({ left: 3 }), entry({ left: 1 })];
    const patch = entry({ left: 2, bought: 1, act: bought(T2) });
    const once = [patch, before[1]];
    const twice = [patch, once[1]];
    expect(rowStateOf(twice)).toBe(rowStateOf(once));
    expect(rowNumbersOf(twice)).toEqual(rowNumbersOf(once));
  });
});

function ruleLine(over: Partial<BasketRuleLine> = {}): BasketRuleLine {
  return {
    itemIds: [],
    favoriteItemId: null,
    tripItemId: null,
    ...over,
  };
}

describe('lineProductOf, the product of a line (plan 0201, section 1)', () => {
  it('step 1: is the product of its latest buy in this trip', () => {
    // It wins over the favourite, over a pick and over the order of the line.
    expect(
      lineProductOf(
        ruleLine({
          itemIds: ['a', 'b', 'c'],
          favoriteItemId: 'b',
          tripItemId: 'c',
        }),
        'a'
      )
    ).toBe('c');
  });

  it('step 1: follows a buy that named a product outside the line', () => {
    // A change "for this trip only": the line does not hold the product, and
    // it counts as it until the trip ends.
    expect(
      lineProductOf(
        ruleLine({ itemIds: ['a', 'b'], favoriteItemId: 'a', tripItemId: 'z' })
      )
    ).toBe('z');
    // Also for a line that holds no product at all.
    expect(lineProductOf(ruleLine({ tripItemId: 'z' }))).toBe('z');
  });

  it('step 1: says nothing once the buy was taken back', () => {
    // The caller hands the standing buys alone, so a reverted buy is a line
    // with no product of the trip, and the favourite decides again.
    expect(
      lineProductOf(
        ruleLine({ itemIds: ['a', 'b'], favoriteItemId: 'b', tripItemId: null })
      )
    ).toBe('b');
  });

  it('step 2: is its favourite, also over a pick', () => {
    // The favourite wins also when the shop of the read does not sell it, so
    // the cheapest product of that shop does not move the line.
    expect(
      lineProductOf(ruleLine({ itemIds: ['a', 'b'], favoriteItemId: 'b' }), 'a')
    ).toBe('b');
  });

  it('step 2: ignores a favourite that is no longer on the line', () => {
    const line = ruleLine({ itemIds: ['a', 'b'], favoriteItemId: 'gone' });

    expect(lineProductOf(line)).toBe('a');
    expect(lineProductOf(line, 'b')).toBe('b');
  });

  it('step 3: is the pick of a caller that read the prices', () => {
    expect(lineProductOf(ruleLine({ itemIds: ['a', 'b', 'c'] }), 'c')).toBe(
      'c'
    );
  });

  it('step 3: ignores a pick that is not a product of the line', () => {
    expect(lineProductOf(ruleLine({ itemIds: ['a', 'b'] }), 'z')).toBe('a');
    expect(lineProductOf(ruleLine(), 'z')).toBeNull();
  });

  it('step 4: is its first product with no pick', () => {
    const line = ruleLine({ itemIds: ['b', 'a'] });

    expect(lineProductOf(line)).toBe('b');
    expect(lineProductOf(line, null)).toBe('b');
    expect(lineProductOf(line, undefined)).toBe('b');
  });

  it('step 5: is nothing for a line with no products', () => {
    expect(lineProductOf(ruleLine())).toBeNull();
    expect(lineProductOf(ruleLine({ favoriteItemId: 'a' }))).toBeNull();
  });
});

describe('needsPriceChoice, the lines the gateway prices', () => {
  it('is a line with two or more products, no favourite and no buy', () => {
    expect(needsPriceChoice(ruleLine({ itemIds: ['a', 'b'] }))).toBe(true);
    expect(needsPriceChoice(ruleLine({ itemIds: ['a', 'b', 'c'] }))).toBe(true);
  });

  it('is not a line with one product or with none', () => {
    expect(needsPriceChoice(ruleLine({ itemIds: ['a'] }))).toBe(false);
    expect(needsPriceChoice(ruleLine())).toBe(false);
  });

  it('is not a line with a favourite among its products', () => {
    expect(
      needsPriceChoice(ruleLine({ itemIds: ['a', 'b'], favoriteItemId: 'b' }))
    ).toBe(false);
  });

  it('is a line whose favourite is no longer one of its products', () => {
    expect(
      needsPriceChoice(
        ruleLine({ itemIds: ['a', 'b'], favoriteItemId: 'gone' })
      )
    ).toBe(true);
  });

  it('is not a line with a buy in this trip', () => {
    expect(
      needsPriceChoice(ruleLine({ itemIds: ['a', 'b'], tripItemId: 'a' }))
    ).toBe(false);
    // Also when the buy named a product outside the line.
    expect(
      needsPriceChoice(ruleLine({ itemIds: ['a', 'b'], tripItemId: 'z' }))
    ).toBe(false);
  });

  it('agrees with lineProductOf: only such a line follows a pick', () => {
    const lines = [
      ruleLine(),
      ruleLine({ itemIds: ['a'] }),
      ruleLine({ itemIds: ['a', 'b'] }),
      ruleLine({ itemIds: ['a', 'b'], favoriteItemId: 'a' }),
      ruleLine({ itemIds: ['a', 'b'], favoriteItemId: 'gone' }),
      ruleLine({ itemIds: ['a', 'b'], tripItemId: 'a' }),
    ];

    for (const line of lines) {
      const moved = lineProductOf(line, 'b') !== lineProductOf(line);
      expect(moved).toBe(needsPriceChoice(line));
    }
  });
});

describe('cheapestOf, the one comparison of prices (plan 0201, section 1)', () => {
  const price = (
    itemId: string,
    value: number | null,
    unitPrice: number | null = null
  ): BasketRulePrice => ({ itemId, price: value, unitPrice });

  it('compares the price for each kilo or litre before the price', () => {
    // The big carton costs more and is cheaper for each litre.
    expect(cheapestOf([price('small', 1.2, 1.2), price('big', 2, 1)])).toBe(
      'big'
    );
  });

  it('compares the price when the unit prices are equal', () => {
    expect(cheapestOf([price('a', 3, 2), price('b', 2.5, 2)])).toBe('b');
  });

  it('compares the price when no product has a unit price', () => {
    expect(cheapestOf([price('a', 3), price('b', 2.5), price('c', 4)])).toBe(
      'b'
    );
  });

  it('keeps the order of the input on a tie', () => {
    expect(cheapestOf([price('a', 2, 1), price('b', 2, 1)])).toBe('a');
    expect(cheapestOf([price('b', 2, 1), price('a', 2, 1)])).toBe('b');
    expect(cheapestOf([price('a', 2), price('b', 2)])).toBe('a');
  });

  it('puts a product with no unit price after one that has it', () => {
    // Also when the product with no unit price costs less.
    expect(cheapestOf([price('plain', 1), price('measured', 5, 9)])).toBe(
      'measured'
    );
    expect(cheapestOf([price('measured', 5, 9), price('plain', 1)])).toBe(
      'measured'
    );
  });

  it('leaves out a product with no price', () => {
    // With a shop, only the prices of that shop count, so a product the shop
    // does not sell arrives here with no price and is not a candidate.
    expect(cheapestOf([price('a', null), price('b', 9, 9)])).toBe('b');
    // A unit price with no price is still no price.
    expect(cheapestOf([price('a', null, 0.1), price('b', 9, 9)])).toBe('b');
  });

  it('answers null when no product has a price', () => {
    expect(cheapestOf([price('a', null), price('b', null)])).toBeNull();
    expect(cheapestOf([])).toBeNull();
  });

  it('answers the only product that has a price', () => {
    expect(cheapestOf([price('a', null), price('b', 4)])).toBe('b');
  });
});
