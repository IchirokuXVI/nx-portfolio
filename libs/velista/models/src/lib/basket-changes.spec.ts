import {
  basketChangeOriginLine,
  basketChangeSentence,
  type BasketChange,
  type BasketChangeActor,
} from './basket-changes';
import type { BasketRow, BasketRowState } from './basket-view';
import { countableBasketRows } from './basket-view';

/**
 * Which sentence a change reads as, and which rows a count is over
 * (velista `0093`, sections 4 and 6).
 *
 * Both are pure functions in `models` for the same reason: each is a rule about
 * the product that two different screens would otherwise answer differently. A
 * template holding the seven way table would drift from the sheet's spec the
 * first time somebody edited one branch.
 */

function change(over: Partial<BasketChange> = {}): BasketChange {
  return {
    id: 'chg-1',
    kind: 'UNKNOWN',
    rowKey: 'zl-1',
    contentBefore: null,
    contentAfter: 'Milk',
    quantityBefore: null,
    quantityAfter: null,
    approvalBefore: null,
    approvalAfter: null,
    rowContent: null,
    actor: null,
    origin: null,
    list: null,
    at: new Date('2026-09-01T09:00:00.000Z'),
    unseen: true,
    ...over,
  };
}

function row(state: BasketRowState, rowKey = 'zl-1'): BasketRow {
  return {
    rowKey,
    content: 'Milk',
    left: 1,
    bought: 0,
    asked: 1,
    boughtElsewhere: 0,
    state,
    note: null,
    noteAt: null,
    mark: null,
    awaitingApproval: false,
    productId: null,
    touchedBy: null,
    touchedAt: null,
    usual: null,
    entries: [],
  };
}

describe('basketChangeSentence', () => {
  it('names an addition and how many it asks for', () => {
    expect(
      basketChangeSentence(change({ kind: 'ADDED', quantityAfter: 2 }))
    ).toEqual({
      key: 'basket.changes.entry.added',
      args: { name: 'Milk', count: 2 },
    });
  });

  it('names both numbers when the demand moved', () => {
    expect(
      basketChangeSentence(
        change({
          kind: 'QUANTITY_CHANGED',
          quantityBefore: 2,
          quantityAfter: 3,
        })
      )
    ).toEqual({
      key: 'basket.changes.entry.quantity',
      args: { name: 'Milk', after: 3, before: 2 },
    });
  });

  it('says a line is not needed rather than quoting a zero', () => {
    // "asks for 0 instead of 2" is a number nobody says out loud. The line is
    // still on the list, so this is not a deletion either.
    expect(
      basketChangeSentence(
        change({
          kind: 'QUANTITY_CHANGED',
          quantityBefore: 2,
          quantityAfter: 0,
        })
      )
    ).toEqual({
      key: 'basket.changes.entry.notNeeded',
      args: { name: 'Milk' },
    });
  });

  it('names both spellings of a rename', () => {
    expect(
      basketChangeSentence(
        change({
          kind: 'RENAMED',
          contentBefore: 'Leche',
          contentAfter: 'Milk',
        })
      )
    ).toEqual({
      key: 'basket.changes.entry.renamed',
      args: { name: 'Milk', before: 'Leche' },
    });
  });

  it('names the survivor a merge folded a line into', () => {
    // The survivor's text is not on the wire: it is read off the row `rowKey`
    // names when the change is mapped.
    expect(
      basketChangeSentence(
        change({
          kind: 'MERGED',
          contentBefore: 'Leche',
          contentAfter: 'Leche',
          rowContent: 'Milk',
        })
      )
    ).toEqual({
      key: 'basket.changes.entry.merged',
      args: { name: 'Milk', before: 'Leche' },
    });
  });

  it('names the line a deletion took away, which only has a before', () => {
    expect(
      basketChangeSentence(
        change({ kind: 'DELETED', contentBefore: 'Milk', contentAfter: null })
      )
    ).toEqual({
      key: 'basket.changes.entry.deleted',
      args: { name: 'Milk' },
    });
  });

  it.each([
    ['APPROVED', 'basket.changes.entry.approved'],
    ['REJECTED', 'basket.changes.entry.rejected'],
    ['PENDING', 'basket.changes.entry.pendingAgain'],
  ] as const)('picks the approval sentence from after, %s', (after, key) => {
    // From `approvalAfter` and never from `approvalBefore`: a reader who missed
    // three moves wants the one that stands.
    expect(
      basketChangeSentence(
        change({
          kind: 'APPROVAL_CHANGED',
          approvalBefore: 'PENDING',
          approvalAfter: after,
        })
      ).key
    ).toBe(key);
  });

  it('falls back rather than guessing an approval it cannot read', () => {
    expect(
      basketChangeSentence(
        change({ kind: 'APPROVAL_CHANGED', approvalAfter: null })
      ).key
    ).toBe('basket.changes.entry.unknown');
  });

  it('still says something happened for a kind this build has not heard of', () => {
    expect(basketChangeSentence(change({ kind: 'UNKNOWN' }))).toEqual({
      key: 'basket.changes.entry.unknown',
      args: { name: 'Milk' },
    });
  });

  it('falls back to the name before the change when there is no name after', () => {
    expect(
      basketChangeSentence(
        change({ kind: 'UNKNOWN', contentAfter: null, contentBefore: 'Milk' })
      ).args['name']
    ).toBe('Milk');
  });
});

describe('basketChangeSentence: a buy (velista 0142, section 4)', () => {
  it('says what is needed now after a buy that left some', () => {
    expect(
      basketChangeSentence(
        change({
          kind: 'BOUGHT',
          contentAfter: null,
          rowContent: 'Milk',
          quantityBefore: 3,
          quantityAfter: 2,
        })
      )
    ).toEqual({
      key: 'basket.changes.entry.bought',
      args: { name: 'Milk', after: 2 },
    });
  });

  it('has its own sentence for a buy that left nothing', () => {
    expect(
      basketChangeSentence(
        change({ kind: 'BOUGHT', quantityBefore: 2, quantityAfter: 0 })
      )
    ).toEqual({
      key: 'basket.changes.entry.boughtAll',
      args: { name: 'Milk' },
    });
  });

  it('says what is needed again after a buy was undone', () => {
    expect(
      basketChangeSentence(
        change({ kind: 'BUY_REVERTED', quantityBefore: 0, quantityAfter: 3 })
      )
    ).toEqual({
      key: 'basket.changes.entry.buyReverted',
      args: { name: 'Milk', after: 3 },
    });
  });
});

describe('basketChangeOriginLine', () => {
  const reader = { participantId: 'p-me', userId: 'u-me' };
  const names: Record<string, string> = { 'u-alice': 'Alice' };
  const nameOf = (actor: BasketChangeActor) =>
    actor.name ??
    (actor.userId === null ? null : (names[actor.userId] ?? null));
  const person = (userId: string): BasketChangeActor => ({
    participantId: null,
    userId,
    name: null,
  });

  it('draws nothing for a change with no origin, which keeps who and the list', () => {
    expect(basketChangeOriginLine(change(), reader, nameOf)).toBeNull();
  });

  it('names the owner of the other shopping list', () => {
    expect(
      basketChangeOriginLine(
        change({
          kind: 'BOUGHT',
          origin: { kind: 'ANOTHER_BASKET', owner: person('u-alice') },
        }),
        reader,
        nameOf
      )
    ).toEqual({
      key: 'basket.changes.origin.anotherBasket',
      args: { name: 'Alice' },
    });
  });

  it('tells the reader that the other shopping list is one of theirs', () => {
    expect(
      basketChangeOriginLine(
        change({
          kind: 'BOUGHT',
          origin: { kind: 'ANOTHER_BASKET', owner: person('u-me') },
        }),
        reader,
        nameOf
      )?.key
    ).toBe('basket.changes.origin.anotherBasketYours');
  });

  it('says someone for an owner the server withheld or the client cannot name', () => {
    for (const owner of [null, person('u-stranger')]) {
      expect(
        basketChangeOriginLine(
          change({ kind: 'BOUGHT', origin: { kind: 'ANOTHER_BASKET', owner } }),
          reader,
          nameOf
        )
      ).toEqual({
        key: 'basket.changes.origin.anotherBasketSomeone',
        args: {},
      });
    }
  });

  it('names who bought it on the list page', () => {
    expect(
      basketChangeOriginLine(
        change({
          kind: 'BOUGHT',
          actor: person('u-alice'),
          origin: { kind: 'LIST' },
        }),
        reader,
        nameOf
      )
    ).toEqual({ key: 'basket.changes.origin.list', args: { name: 'Alice' } });
  });

  it('tells the reader they bought it on the list page, by either key', () => {
    for (const actor of [
      person('u-me'),
      { participantId: 'p-me', userId: null, name: 'Dana' },
    ]) {
      expect(
        basketChangeOriginLine(
          change({ kind: 'BOUGHT', actor, origin: { kind: 'LIST' } }),
          reader,
          nameOf
        )?.key
      ).toBe('basket.changes.origin.listYou');
    }
  });

  it('says someone for a list page buyer the server withheld, which is a guest’s view', () => {
    expect(
      basketChangeOriginLine(
        change({ kind: 'BOUGHT', actor: null, origin: { kind: 'LIST' } }),
        { participantId: 'p-guest', userId: null },
        nameOf
      )
    ).toEqual({ key: 'basket.changes.origin.listSomeone', args: {} });
  });
});

describe('countableBasketRows', () => {
  it('leaves a REMOVED row and a row bought outside this shopping list out', () => {
    const rows = [
      row('WANTED', 'a'),
      row('REMOVED', 'b'),
      row('DONE', 'c'),
      row('BOUGHT_ELSEWHERE', 'd'),
    ];

    expect(countableBasketRows(rows).map((each) => each.rowKey)).toEqual([
      'a',
      'c',
    ]);
  });

  it('answers the same array when there is nothing to drop', () => {
    // By identity, which is the ordinary case: no basket carries a `REMOVED`
    // row until somebody edits a list under it, so a page asking this on every
    // render re-renders nothing.
    const rows = [row('WANTED', 'a'), row('SKIPPED', 'b')];

    expect(countableBasketRows(rows)).toBe(rows);
  });
});
