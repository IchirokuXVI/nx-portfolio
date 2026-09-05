import {
  ItemCategory,
  ItemSourceMatch,
  SourceEntryStatus,
  UnitOfMeasure,
  type ItemView,
} from '@portfolio/luna-shopper/contracts';
import { createHash } from 'node:crypto';
import type { SourceCatalogEntry } from '../entities';
import {
  entryKey,
  entryNameKey,
  ItemMatchIndex,
  normalizeName,
  SiblingEntryIndex,
} from './matching';

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

describe('the catalog item index, rungs 2 and 3 (plan 0086, section 4)', () => {
  it('matches on EAN and calls it ACTIVE: the only cross chain identifier', () => {
    const index = new ItemMatchIndex([item({ ean: '8480000135636' })]);
    expect(
      index.match({
        name: 'Something else entirely',
        brand: null,
        ean: '8480000135636',
        unitSize: null,
      })
    ).toEqual({
      itemId: 'item-1',
      matchedBy: ItemSourceMatch.EAN,
      status: SourceEntryStatus.ACTIVE,
      confidence: 1,
    });
  });

  it('matches on name, brand and size but only ever as a CANDIDATE', () => {
    // A bad fuzzy match writes a wrong price onto a real product that users then
    // shop on, so this rung never writes a price until the owner confirms it.
    const index = new ItemMatchIndex([item()]);
    const match = index.match({
      name: 'Aceite de oliva',
      brand: 'Hacendado',
      ean: null,
      unitSize: 1,
    });
    expect(match).toMatchObject({
      itemId: 'item-1',
      matchedBy: ItemSourceMatch.NAME_BRAND_SIZE,
      status: SourceEntryStatus.CANDIDATE,
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
        name: 'Olive Oil',
        brand: 'Hacendado',
        ean: null,
        unitSize: 1,
      })
    ).toEqual({
      itemId: 'item-1',
      matchedBy: ItemSourceMatch.NAME_BRAND_SIZE,
      status: SourceEntryStatus.CANDIDATE,
      confidence: 0.6,
    });
  });

  it('finds nothing rather than something wrong when nothing matches', () => {
    const index = new ItemMatchIndex([item()]);
    expect(
      index.match({
        name: 'Papel de cocina',
        brand: 'Bosque Verde',
        ean: null,
        unitSize: 2,
      })
    ).toBeNull();
  });
});

/**
 * Rung 4: the chain's own rows (plan 0086, section 4).
 *
 * The rung the one table exists for. A leaflet's printed name and a walk's
 * product id are two observations of one product, and this is what proposes the
 * second to the first without either of them stopping being its own row.
 */
describe('the sibling row index, rung 4', () => {
  const row = (over: Partial<SourceCatalogEntry>): SourceCatalogEntry =>
    ({
      id: 'row-1',
      name: 'Leche entera',
      sizeFormat: '1 L',
      status: SourceEntryStatus.UNRESOLVED,
      itemId: null,
      ...over,
    }) as SourceCatalogEntry;

  it("proposes an ACTIVE sibling's item, whatever source kind wrote it", () => {
    const index = new SiblingEntryIndex([
      row({ status: SourceEntryStatus.ACTIVE, itemId: 'item-1' }),
    ]);

    // Normalized on both sides, so the chain's own casing does not decide it.
    expect(index.match('LECHE ENTERA', '1 l')).toEqual({
      itemId: 'item-1',
      entryId: null,
    });
  });

  it('proposes the sibling itself when the sibling has no item yet', () => {
    // The admin creates the item from whichever row carries the EAN, and both
    // resolve to it afterwards.
    const index = new SiblingEntryIndex([row({ id: 'walk-row' })]);

    expect(index.match('Leche entera', '1 L')).toEqual({
      itemId: null,
      entryId: 'walk-row',
    });
  });

  it('proposes nothing for a REJECTED sibling', () => {
    // The owner said that string is not a product he tracks, and a run does not
    // get to reopen the decision through a neighbour.
    const index = new SiblingEntryIndex([
      row({ status: SourceEntryStatus.REJECTED }),
    ]);

    expect(index.match('Leche entera', '1 L')).toBeNull();
  });

  it('proposes nothing when two siblings disagree about the item', () => {
    const index = new SiblingEntryIndex([
      row({ id: 'a', status: SourceEntryStatus.ACTIVE, itemId: 'item-1' }),
      row({ id: 'b', status: SourceEntryStatus.ACTIVE, itemId: 'item-2' }),
    ]);

    expect(index.match('Leche entera', '1 L')).toBeNull();
  });

  it('counts a row this run created as a sibling from the moment it exists', () => {
    const index = new SiblingEntryIndex([]);
    expect(index.match('Leche entera', '1 L')).toBeNull();

    index.add(row({ status: SourceEntryStatus.ACTIVE, itemId: 'item-1' }));
    expect(index.match('Leche entera', '1 L')).toEqual({
      itemId: 'item-1',
      entryId: null,
    });
  });

  it('is keyed on exactly what a nameless product hashes to', () => {
    // The two halves of D2: a source with no id is keyed on this string, hashed,
    // and rung 4 looks a sibling up by the string itself. A DEZA listing and a
    // DEZA leaflet printing the same name and size therefore meet on one row
    // through rung 1 rather than through this rung at all.
    expect(entryKey('Leche entera', '1 L')).toBe(
      createHash('sha1').update(entryNameKey('Leche entera', '1 L')).digest('hex')
    );
    expect(entryNameKey('LECHE  entera', '1 l')).toBe(
      entryNameKey('Leche entera', '1 L')
    );
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
