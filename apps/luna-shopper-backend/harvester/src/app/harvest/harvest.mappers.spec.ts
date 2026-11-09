import { UnitOfMeasure } from '@portfolio/luna-shopper/contracts';
import type { SourceCatalogEntry, SourceEntryPrice } from '../entities';
import { toSizeDoubtView } from './harvest.mappers';

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
