import {
  basketChangeSentence,
  type BasketChange,
  type BasketListRef,
} from '@portfolio/velista/models';
import {
  toBasketChange,
  toBasketChangePage,
  type BasketChangeContext,
} from './basket-change-mappers';

/**
 * Rule D4 at the change boundary (velista `0093`, section 13, test 1).
 *
 * Three things this has to get right and each is a way the sheet breaks. An
 * entry it cannot write a sentence about is refused rather than drawn blank. A
 * kind it has not heard of becomes `UNKNOWN` rather than throwing, so a server
 * that grows a seventh kind does not take the sheet down. And one bad entry
 * loses one row rather than the page it was on.
 */

const LIST: BasketListRef = {
  listId: 'list-weekly',
  name: 'Weekly shop',
  zoneId: 'zone-flat',
  zoneName: 'Flat 3B',
};

/** What the store hands the mapper: three lookups into the basket on screen. */
function context(over: Partial<BasketChangeContext> = {}): BasketChangeContext {
  return {
    nameFor: (participantId) => (participantId === 'p-1' ? 'Dani' : null),
    listFor: (listId) => (listId === LIST.listId ? LIST : null),
    contentFor: (rowKey) => (rowKey === 'zl-1' ? 'Milk' : null),
    ...over,
  };
}

/** One wire entry, as backend `0138` section 8 serves it. */
function wire(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'chg-1',
    kind: 'RENAMED',
    at: '2026-09-01T09:00:00.000Z',
    unseen: true,
    rowKey: 'zl-1',
    contentBefore: 'Leche',
    contentAfter: 'Milk',
    quantityBefore: 1,
    quantityAfter: 1,
    approvalBefore: null,
    approvalAfter: null,
    ...over,
  };
}

describe('toBasketChange', () => {
  it('reads every field the sheet draws', () => {
    expect(
      toBasketChange(
        wire({ listId: LIST.listId, actor: { participantId: 'p-1' } }),
        context()
      )
    ).toEqual({
      id: 'chg-1',
      kind: 'RENAMED',
      rowKey: 'zl-1',
      contentBefore: 'Leche',
      contentAfter: 'Milk',
      quantityBefore: 1,
      quantityAfter: 1,
      approvalBefore: null,
      approvalAfter: null,
      rowContent: 'Milk',
      actor: { participantId: 'p-1', userId: null, name: 'Dani' },
      list: LIST,
      at: new Date('2026-09-01T09:00:00.000Z'),
      unseen: true,
    });
  });

  it('refuses an entry with no id', () => {
    expect(toBasketChange(wire({ id: null }), context())).toBeNull();
  });

  it('refuses an entry with no date', () => {
    // The second line of an entry is who, which list and when, and a change
    // with no time is one this sheet cannot place among the others.
    expect(toBasketChange(wire({ at: 'not a date' }), context())).toBeNull();
  });

  it('names a change the wire sent no text for by its row', () => {
    // **The case a live run found.** Backend `0138` fills only the columns
    // that moved, so a quantity change arrives with both content columns null
    // and two numbers. Requiring content here dropped every one of them, and
    // the sheet drew its empty state over a basket full of changes.
    const change = toBasketChange(
      wire({
        kind: 'QUANTITY_CHANGED',
        contentBefore: null,
        contentAfter: null,
        quantityBefore: 2,
        quantityAfter: 3,
      }),
      context()
    );

    expect(change?.rowContent).toBe('Milk');
    expect(basketChangeSentence(change as BasketChange)).toEqual({
      key: 'basket.changes.entry.quantity',
      args: { name: 'Milk', after: 3, before: 2 },
    });
  });

  it('refuses an entry it can find no name for anywhere', () => {
    // Every sentence in the table quotes the line. With no content on either
    // side and no row to read one off, the entry renders as a pair of quotes
    // with nothing between them.
    expect(
      toBasketChange(
        wire({ contentBefore: null, contentAfter: null, rowKey: 'gone' }),
        context()
      )
    ).toBeNull();
  });

  it('keeps an entry whose row has gone, because the change still happened', () => {
    // The wire serves no line id at all, so a null `rowKey` is the ordinary
    // answer for a line that left rather than a failure to read one.
    const change = toBasketChange(
      wire({ kind: 'DELETED', rowKey: null, contentAfter: null }),
      context()
    );

    expect(change?.rowKey).toBeNull();
    expect(change?.rowContent).toBeNull();
  });

  it('maps a kind it has not heard of to UNKNOWN rather than throwing', () => {
    expect(toBasketChange(wire({ kind: 'TELEPORTED' }), context())?.kind).toBe(
      'UNKNOWN'
    );
  });

  it('leaves the list null when the reader was served no ref for it', () => {
    // The redaction rule, and it is the data that decides: a guest is served no
    // refs at all, so every entry they hold is unplaceable.
    expect(
      toBasketChange(wire({ listId: 'list-somebody-elses' }), context())?.list
    ).toBeNull();
  });

  it('leaves the list null when the wire named none', () => {
    expect(toBasketChange(wire(), context())?.list).toBeNull();
  });

  it('leaves the actor null when the wire named nobody', () => {
    expect(toBasketChange(wire(), context())?.actor).toBeNull();
  });

  it('keeps an actor this client cannot name, with a null name', () => {
    // "Somebody, and this build cannot say who" is a real answer: the sheet
    // draws "Someone" for it, and an entry with the id dropped would lose the
    // difference between that and nobody at all.
    expect(
      toBasketChange(wire({ actor: { userId: 'u-9' } }), context())?.actor
    ).toEqual({ participantId: null, userId: 'u-9', name: null });
  });

  it('never invents an unseen flag', () => {
    // The server's answer, and anything but an explicit true is "seen": the
    // quiet direction is a tag missing rather than a tag on every entry.
    expect(toBasketChange(wire({ unseen: 'yes' }), context())?.unseen).toBe(
      false
    );
  });
});

describe('toBasketChangePage', () => {
  it('drops one bad entry without failing the page', () => {
    const page = toBasketChangePage(
      {
        items: [wire(), { id: 'chg-2' }, wire({ id: 'chg-3' })],
        nextCursor: 'cursor-2',
      },
      context()
    );

    expect(page.items.map((change) => change.id)).toEqual(['chg-1', 'chg-3']);
    expect(page.nextCursor).toBe('cursor-2');
  });

  it('answers an empty page for an answer it cannot read at all', () => {
    expect(toBasketChangePage('not an object', context())).toEqual({
      items: [],
      nextCursor: null,
    });
  });
});
