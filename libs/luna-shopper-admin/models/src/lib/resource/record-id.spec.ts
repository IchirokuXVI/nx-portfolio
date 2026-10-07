import {
  recordIdFor,
  recordIdIn,
  rowWithin,
  searchedRecordId,
} from './record-id';
import { REFERENCE_NONE } from './reference-none';
import { nounKeyOf } from './resource-descriptor';

/**
 * The rule that says a typed term is a record's ID (admin plan 0051).
 *
 * One function, so the list and the typeahead cannot disagree about which
 * terms are searches and which are reads.
 */
const ID = '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f';

describe('recordIdIn', () => {
  it('reads a uuid as an ID', () => {
    expect(recordIdIn(ID)).toBe(ID);
  });

  it('drops the space a paste brings with it', () => {
    expect(recordIdIn(`  ${ID}\n`)).toBe(ID);
  });

  it('lowers the case, since a row prints its ID in lower case', () => {
    expect(recordIdIn(ID.toUpperCase())).toBe(ID);
  });

  it.each([
    ['a word', 'tomato'],
    ['nothing', ''],
    ['a postal code', '08001'],
    ['a barcode', '8480000123456'],
    ['a uuid cut short', ID.slice(0, 30)],
    ['a uuid with text around it', `id ${ID}`],
    ['a uuid without its dashes', ID.replaceAll('-', '')],
  ])('leaves %s as text', (_what, term) => {
    expect(recordIdIn(term)).toBeNull();
  });
});

describe('recordIdFor', () => {
  it('is the ID for a resource the gateway reads by ID', () => {
    expect(recordIdFor({}, ID)).toBe(ID);
  });

  it('is text for a resource with no read by ID', () => {
    expect(recordIdFor({ readById: false }, ID)).toBeNull();
  });
});

describe('searchedRecordId', () => {
  const people = {
    filters: [
      { kind: 'search', param: 'username', label: 'u' },
      { kind: 'search', param: 'email', label: 'e' },
      { kind: 'reference', param: 'zoneId', label: 'z', resource: 'zones' },
    ],
  } as const;

  it('finds an ID in any search box of the list', () => {
    expect(searchedRecordId(people, { email: ID })).toBe(ID);
    expect(searchedRecordId(people, { username: ` ${ID} ` })).toBe(ID);
  });

  it('ignores an ID held by a filter that is not a search box', () => {
    // A reference filter holds the ID of another table: the zone a person is
    // in. That narrows the list and is not a search of it.
    expect(searchedRecordId(people, { zoneId: ID })).toBeNull();
  });

  it('is null while the boxes hold words, or nothing', () => {
    expect(searchedRecordId(people, { username: 'ada' })).toBeNull();
    expect(searchedRecordId(people, {})).toBeNull();
    expect(searchedRecordId({}, { query: ID })).toBeNull();
  });
});

describe('rowWithin', () => {
  const shop = { id: 's1', supermarketId: 'chain-a', kind: 'SHOP' };

  it('keeps a row that carries the values the screen fixed', () => {
    expect(rowWithin(shop, { supermarketId: 'chain-a' })).toBe(true);
  });

  it('refuses a row of another parent', () => {
    expect(rowWithin(shop, { supermarketId: 'chain-b' })).toBe(false);
  });

  it('reads a list of values as any of them', () => {
    expect(rowWithin(shop, { kind: ['SHOP', 'REGION'] })).toBe(true);
    expect(rowWithin(shop, { kind: ['NATIONAL'] })).toBe(false);
  });

  it('passes a filter that is no column of the row', () => {
    expect(rowWithin(shop, { leafOnly: 'true', supermarketId: '' })).toBe(true);
  });

  /**
   * A column that is absent cannot be checked. A column that holds nothing
   * can: a category with no parent is not under the root a screen fixed.
   */
  it('refuses a row whose column is null where a value was fixed', () => {
    const root = { id: 'c1', parentId: null };

    expect(rowWithin(root, { parentId: 'c0' })).toBe(false);
    expect(rowWithin(root, { parentId: ['c0', 'c9'] })).toBe(false);
    expect(rowWithin({ id: 'c2' }, { parentId: 'c0' })).toBe(true);
  });

  it('keeps a null column for the "none" literal, and for no value', () => {
    const root = { id: 'c1', parentId: null };

    expect(rowWithin(root, { parentId: REFERENCE_NONE })).toBe(true);
    expect(rowWithin(root, { parentId: '' })).toBe(true);
    expect(rowWithin({ id: 'c2', parentId: 'c1' }, { parentId: 'none' })).toBe(
      false
    );
  });
});

describe('nounKeyOf', () => {
  it('is the sentence form where a resource names one', () => {
    expect(
      nounKeyOf({ labels: { one: 'Brand', many: 'm', noun: 'brand' } })
    ).toBe('brand');
    expect(nounKeyOf({ labels: { one: 'shop', many: 'm' } })).toBe('shop');
  });
});
