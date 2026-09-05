import {
  ItemCategory,
  ItemSourceMatch,
  ItemSourceRefStatus,
  UnitOfMeasure,
  type ItemView,
} from '@portfolio/luna-shopper/contracts';
import { ItemMatchIndex, normalizeName } from './matching';

function item(overrides: Partial<ItemView> = {}): ItemView {
  return {
    id: 'item-1',
    name: { en: 'Olive oil', es: 'Aceite de oliva' },
    brand: 'Hacendado',
    imageUrl: null,
    sku: null,
    ean: null,
    unitSize: 1,
    category: ItemCategory.PANTRY,
    defaultUnit: UnitOfMeasure.LITER,
    ...overrides,
  };
}

describe('the matching ladder (plan 0038, section 6.2)', () => {
  it('matches on EAN and calls it ACTIVE: the only cross chain identifier', () => {
    const index = new ItemMatchIndex([item({ ean: '8480000135636' })]);
    expect(
      index.match({
        externalId: '4241',
        name: 'Something else entirely',
        brand: null,
        ean: '8480000135636',
        unitSize: null,
      })
    ).toEqual({
      itemId: 'item-1',
      matchedBy: ItemSourceMatch.EAN,
      status: ItemSourceRefStatus.ACTIVE,
      confidence: 1,
    });
  });

  it('matches on name, brand and size but only ever as a CANDIDATE', () => {
    // A bad fuzzy match writes a wrong price onto a real product that users then
    // shop on, so this rung never writes a price until the owner confirms it.
    const index = new ItemMatchIndex([item()]);
    const match = index.match({
      externalId: '4241',
      name: 'Aceite de oliva',
      brand: 'Hacendado',
      ean: null,
      unitSize: 1,
    });
    expect(match).toMatchObject({
      itemId: 'item-1',
      matchedBy: ItemSourceMatch.NAME_BRAND_SIZE,
      status: ItemSourceRefStatus.CANDIDATE,
    });
    expect(match?.confidence).toBeLessThan(1);
  });

  it('prefers EAN over the fuzzy rung when both would match', () => {
    const index = new ItemMatchIndex([
      item({ id: 'by-name' }),
      item({ id: 'by-ean', ean: '8480000135636', name: { en: 'X', es: 'X' } }),
    ]);
    expect(
      index.match({
        externalId: '4241',
        name: 'Aceite de oliva',
        brand: 'Hacendado',
        ean: '8480000135636',
        unitSize: 1,
      })
    ).toMatchObject({ itemId: 'by-ean', matchedBy: ItemSourceMatch.EAN });
  });

  it('refuses to guess when two items normalize to the same key', () => {
    // Two products under one key is precisely the case where guessing does harm.
    const index = new ItemMatchIndex([item({ id: 'a' }), item({ id: 'b' })]);
    expect(
      index.match({
        externalId: '4241',
        name: 'Aceite de oliva',
        brand: 'Hacendado',
        ean: null,
        unitSize: 1,
      })
    ).toBeNull();
  });

  it('does not match on the name alone when the size differs', () => {
    const index = new ItemMatchIndex([item({ unitSize: 1 })]);
    expect(
      index.match({
        externalId: '4241',
        name: 'Aceite de oliva',
        brand: 'Hacendado',
        ean: null,
        unitSize: 5,
      })
    ).toBeNull();
  });

  it('indexes an item with no Spanish name under its English one (plan 0079)', () => {
    // The index used to call `.toLowerCase()` on `name.es`, which is a TypeError
    // for a name in one language. An English only item is a candidate at best,
    // but it is indexed, and it is found by the English words.
    const index = new ItemMatchIndex([
      item({ name: { en: 'Olive oil' }, brand: 'Hacendado', unitSize: 1 }),
    ]);

    expect(
      index.match({
        externalId: '4241',
        name: 'Olive Oil',
        brand: 'Hacendado',
        ean: null,
        unitSize: 1,
      })
    ).toEqual({
      itemId: 'item-1',
      matchedBy: ItemSourceMatch.NAME_BRAND_SIZE,
      status: ItemSourceRefStatus.CANDIDATE,
      confidence: 0.6,
    });
  });

  it('finds nothing rather than something wrong when nothing matches', () => {
    const index = new ItemMatchIndex([item()]);
    expect(
      index.match({
        externalId: '99999',
        name: 'Papel de cocina',
        brand: 'Bosque Verde',
        ean: null,
        unitSize: 2,
      })
    ).toBeNull();
  });
});

describe('normalizeName', () => {
  it('folds case, accents and punctuation', () => {
    expect(normalizeName('Aceite de oliva 0,4º Hacendado')).toBe(
      normalizeName('ACEITE DE OLIVA 0 4 HACENDADO')
    );
  });

  it('collapses runs of separators rather than leaving empty tokens', () => {
    expect(normalizeName('  Café  --  soluble ')).toBe('cafe soluble');
  });
});
