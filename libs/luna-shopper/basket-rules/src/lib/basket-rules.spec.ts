import {
  BASKET_RULE_ACT_SKIPPED,
  BASKET_RULE_STATES,
  progressOf,
  rowNumbersOf,
  rowStateOf,
  type BasketRuleAct,
  type BasketRuleEntry,
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
