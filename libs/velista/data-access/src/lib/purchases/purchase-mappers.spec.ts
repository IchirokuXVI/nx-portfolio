import {
  toPurchaseEntry,
  toPurchaseEntryPage,
  toPurchaseEntryRow,
} from './purchase-mappers';

const ENTRY = {
  id: 's-1',
  kind: 'SESSION',
  name: null,
  open: false,
  startedAt: '2026-09-20T10:00:00.000Z',
  endedAt: '2026-09-20T11:00:00.000Z',
  settledLineCount: 4,
  anyBoughtLineCount: 3,
  spent: { cents: 1240, currency: 'EUR' },
  unpricedCount: 1,
};

const ROW = {
  id: 'st-1',
  itemId: 'item-1',
  outcome: 'BOUGHT',
  quantity: 3,
  pricePaid: { cents: 115, currency: 'EUR' },
  priceScopeId: 'scope-1',
  supermarketLocationId: null,
  settledAt: '2026-09-20T10:00:00.000Z',
  lineId: 'l-1',
  listId: 'list-1',
  listName: 'Home',
  zoneId: 'z-1',
  content: 'Milk',
};

describe('purchase mappers (velista 0095, test 1)', () => {
  // Backend 0159 renamed the counts. The old names ride beside the new ones
  // for one release, and this client reads only the new ones.
  it('reads the purchase count from anyBoughtLineCount and never the old name', () => {
    expect(
      toPurchaseEntry({ ...ENTRY, lineCount: 99, boughtLineCount: 99 })
        ?.purchaseCount
    ).toBe(3);
    expect(
      toPurchaseEntry({ ...ENTRY, anyBoughtLineCount: undefined })
        ?.purchaseCount
    ).toBe(0);
  });

  it('maps an entry, its spend and what the spend does not cover', () => {
    expect(toPurchaseEntry(ENTRY)).toEqual({
      id: 's-1',
      kind: 'SESSION',
      name: null,
      startedAt: new Date('2026-09-20T10:00:00.000Z'),
      purchaseCount: 3,
      spend: { cents: 1240, currency: 'EUR', unpricedCount: 1 },
      unpricedCount: 1,
    });
  });

  it('refuses an entry with no id or no readable date', () => {
    expect(toPurchaseEntry({ ...ENTRY, id: undefined })).toBeNull();
    expect(toPurchaseEntry({ ...ENTRY, id: '' })).toBeNull();
    expect(toPurchaseEntry({ ...ENTRY, startedAt: 'yesterday' })).toBeNull();
    expect(toPurchaseEntry('entry')).toBeNull();
  });

  it('reads an unknown kind as a session, which never carries a name', () => {
    const entry = toPurchaseEntry({ ...ENTRY, kind: 'LOOSE', name: 'x' });

    expect(entry?.kind).toBe('SESSION');
    expect(entry?.name).toBeNull();
    expect(
      toPurchaseEntry({ ...ENTRY, kind: 'BASKET', name: 'Sat' })?.name
    ).toBe('Sat');
  });

  it('maps an amount with no currency to no amount at all', () => {
    expect(
      toPurchaseEntry({ ...ENTRY, spent: { cents: 1240 } })?.spend
    ).toBeNull();
    expect(
      toPurchaseEntry({ ...ENTRY, spent: { cents: 1240, currency: '' } })?.spend
    ).toBeNull();
    expect(toPurchaseEntry({ ...ENTRY, spent: null })?.spend).toBeNull();
  });

  it('drops a malformed entry from a page and keeps the rest', () => {
    const page = toPurchaseEntryPage({
      items: [ENTRY, { kind: 'BASKET' }],
      nextCursor: 'c-2',
    });

    expect(page.items.map((entry) => entry.id)).toEqual(['s-1']);
    expect(page.nextCursor).toBe('c-2');
    expect(toPurchaseEntryPage(null)).toEqual({ items: [], nextCursor: null });
  });

  it('maps a row with its unit price, and a row the reader lost the list of', () => {
    expect(toPurchaseEntryRow(ROW)).toEqual({
      id: 'st-1',
      content: 'Milk',
      itemId: 'item-1',
      quantity: 3,
      unitPriceCents: 115,
      currency: 'EUR',
      listName: 'Home',
    });

    const gone = toPurchaseEntryRow({
      ...ROW,
      content: null,
      listName: null,
      pricePaid: null,
    });
    expect(gone?.content).toBeNull();
    expect(gone?.listName).toBeNull();
    expect(gone?.unitPriceCents).toBeNull();
    expect(gone?.currency).toBeNull();
  });

  it('refuses a row with no id, and reads a price with no currency as none', () => {
    expect(toPurchaseEntryRow({ ...ROW, id: null })).toBeNull();

    const row = toPurchaseEntryRow({ ...ROW, pricePaid: { cents: 115 } });
    expect(row?.unitPriceCents).toBeNull();
    expect(row?.currency).toBeNull();
  });
});
