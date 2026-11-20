import { UnitOfMeasure } from '@portfolio/luna-shopper/contracts';
import type { SourceCatalogEntry, SourceEntryPrice } from '../entities';
import { toSizeDoubtView, toSourceCatalogEntryView } from './harvest.mappers';

/** The size doubt a row's view carries (plan 0249, section 3). */
describe('toSizeDoubtView', () => {
  const doubted = (labels: (string | null)[]): SourceCatalogEntry =>
    ({
      unitSize: 1.6,
      sizeUnit: UnitOfMeasure.KILOGRAM,
      sizeDoubtImplied: 159.9247,
      sizeDoubtRatio: 0.099953,
      sizeDoubtRunId: 'run-monday',
      prices: labels.map(
        (unitPriceLabel) => ({ unitPriceLabel }) as SourceEntryPrice
      ),
    }) as SourceCatalogEntry;

  it('names the first label of the size dimension, past a known label of another', () => {
    expect(toSizeDoubtView(doubted(['ud', 'kg']))).toEqual({
      implied: 159.9247,
      unit: UnitOfMeasure.GRAM,
      ratio: 0.099953,
      label: 'kg',
      runId: 'run-monday',
    });
    expect(toSizeDoubtView(doubted(['ud', 'L']))?.label).toBeNull();
  });
});

/** Every path the chain files a row under (plan 0268). */
describe('toSourceCatalogEntryView, the category paths', () => {
  const row = (over: Partial<SourceCatalogEntry>): SourceCatalogEntry =>
    ({
      id: 'entry-1',
      externalId: '38406',
      name: 'Coca-Cola',
      confidence: 1,
      timesSeen: 1,
      firstSeenAt: new Date('2026-11-18T10:00:00.000Z'),
      lastSeenAt: new Date('2026-11-18T10:00:00.000Z'),
      decidedAt: null,
      categoryPath: ['Agua y refrescos', 'Cola'],
      ...over,
    }) as SourceCatalogEntry;

  it('carries every path the row holds, beside its one path', () => {
    const paths = [
      ['Agua y refrescos', 'Cola'],
      ['Navidad', 'Ibéricos y quesos'],
    ];
    const view = toSourceCatalogEntryView(row({ categoryPaths: paths }));
    expect(view.categoryPaths).toEqual(paths);
    expect(view.categoryPath).toEqual(['Agua y refrescos', 'Cola']);
  });

  it('reads no paths for a row that holds no value', () => {
    expect(
      toSourceCatalogEntryView(
        row({ categoryPaths: undefined as unknown as string[][] })
      ).categoryPaths
    ).toEqual([]);
  });
});
