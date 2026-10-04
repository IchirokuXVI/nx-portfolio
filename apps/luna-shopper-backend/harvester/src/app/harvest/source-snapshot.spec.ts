import {
  PriceSourceKind,
  UnitOfMeasure,
} from '@portfolio/luna-shopper/contracts';
import type { SourceCatalogEntry } from '../entities';
import {
  applySourceGroup,
  sourceGroupChanged,
  type SourceEntryFields,
} from './source-snapshot';

/**
 * The pack count in the source group (plan 0162, section 2).
 *
 * It is the source's, so a run that states one rewrites it exactly as it
 * rewrites `sizeFormat`. The one difference is a source that reads no counts at
 * all, the leaflet import: it leaves the field absent, and absent must not blank
 * the count a walk of the same chain read.
 */

function row(packCount: number | null): SourceCatalogEntry {
  return {
    externalId: 'p1',
    sourceKind: PriceSourceKind.OFFICIAL_WEB,
    name: 'Leche entera',
    brand: null,
    brandKey: null,
    ean: null,
    unitSize: 6,
    sizeUnit: UnitOfMeasure.LITER,
    sizeFormat: 'pack de 6 unidades de 1 l.',
    packCount,
    categoryPath: [],
    url: null,
    extra: null,
  } as SourceCatalogEntry;
}

function fields(over: Partial<SourceEntryFields> = {}): SourceEntryFields {
  return {
    externalId: 'p1',
    sourceKind: PriceSourceKind.OFFICIAL_WEB,
    name: 'Leche entera',
    brand: null,
    brandKey: null,
    ean: null,
    unitSize: 6,
    sizeUnit: UnitOfMeasure.LITER,
    sizeFormat: 'pack de 6 unidades de 1 l.',
    categoryPath: [],
    url: null,
    extra: null,
    ...over,
  };
}

describe('the size unit in the source group (plan 0177)', () => {
  it('writes the unit a run stated, and a new unit is a change', () => {
    // A row written before the plan: the number is there and nothing says
    // what it counts.
    const stored = { ...row(null), sizeUnit: null } as SourceCatalogEntry;
    expect(sourceGroupChanged(stored, fields())).toBe(true);
    applySourceGroup(stored, fields());
    expect(stored.sizeUnit).toBe(UnitOfMeasure.LITER);
    expect(sourceGroupChanged(stored, fields())).toBe(false);
  });

  it('writes the size and its unit together, and never touches the key', () => {
    const stored = row(null);
    const before = {
      externalId: stored.externalId,
      sizeFormat: stored.sizeFormat,
    };
    applySourceGroup(
      stored,
      fields({ unitSize: 6000, sizeUnit: UnitOfMeasure.MILLILITER })
    );
    expect(Number(stored.unitSize)).toBe(6000);
    expect(stored.sizeUnit).toBe(UnitOfMeasure.MILLILITER);
    expect({
      externalId: stored.externalId,
      sizeFormat: stored.sizeFormat,
    }).toEqual(before);
  });

  it('clears the unit when a run states no size', () => {
    const stored = row(null);
    applySourceGroup(stored, fields({ unitSize: null, sizeUnit: null }));
    expect(stored.unitSize).toBeNull();
    expect(stored.sizeUnit).toBeNull();
  });
});

describe('the pack count in the source group (plan 0162)', () => {
  it('writes the count a run read, and a new count is a change', () => {
    const stored = row(null);
    expect(sourceGroupChanged(stored, fields({ packCount: 6 }))).toBe(true);
    applySourceGroup(stored, fields({ packCount: 6 }));
    expect(stored.packCount).toBe(6);
    expect(sourceGroupChanged(stored, fields({ packCount: 6 }))).toBe(false);
  });

  it('writes a null a run states, because null is a statement', () => {
    const stored = row(6);
    expect(sourceGroupChanged(stored, fields({ packCount: null }))).toBe(true);
    applySourceGroup(stored, fields({ packCount: null }));
    expect(stored.packCount).toBeNull();
  });

  it('leaves the stored count alone when the source reads no counts', () => {
    const stored = row(6);
    expect(sourceGroupChanged(stored, fields())).toBe(false);
    applySourceGroup(stored, fields());
    expect(stored.packCount).toBe(6);
  });
});
