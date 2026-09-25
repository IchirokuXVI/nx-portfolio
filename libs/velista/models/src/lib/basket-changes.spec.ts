import { basketChangeSentence, type BasketChange } from './basket-changes';
import { countableBasketRows } from './basket-view';
import type { BasketRow, BasketRowState } from './basket-view';

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
    state,
    note: null,
    noteAt: null,
    mark: null,
    awaitingApproval: false,
    optionIds: [],
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
        change({ kind: 'RENAMED', contentBefore: 'Leche', contentAfter: 'Milk' })
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

describe('countableBasketRows', () => {
  it('leaves a REMOVED row out', () => {
    const rows = [row('WANTED', 'a'), row('REMOVED', 'b'), row('DONE', 'c')];

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
