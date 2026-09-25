import { PriceSourceKind } from '@portfolio/luna-shopper/contracts';
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
    sizeFormat: 'pack de 6 unidades de 1 l.',
    categoryPath: [],
    url: null,
    extra: null,
    ...over,
  };
}

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
