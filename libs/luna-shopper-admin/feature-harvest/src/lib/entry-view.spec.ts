import { toSourceEntryRow } from './entry-view';

/**
 * What a row of the review queue says a unit price is per (backend plan 0189).
 */
describe('the unit price of a queued row', () => {
  const priceOf = (price: Record<string, unknown>) =>
    toSourceEntryRow(
      {
        id: 'entry-1',
        prices: [{ priceScopeId: 'ps-1', currency: 'EUR', ...price }],
      },
      'en'
    )?.prices[0];

  it('prints the basis the harvester read, and not the label of the source', () => {
    // The price of a litre, which the chain sent under `100 ml`.
    const line = priceOf({
      price: 3.4,
      unitPrice: 17,
      unitPriceLabel: '100 ml',
      unitBasis: 'LITER',
    });

    expect(line?.unitPrice).toBe('€17.00 / L');
    expect(line?.unitPrice).not.toContain('100 ml');
  });

  it('prints the label as the source wrote it when no basis was read', () => {
    expect(
      priceOf({ unitPrice: 4.13, unitPriceLabel: '100gr', unitBasis: null })
        ?.unitPrice
    ).toBe('€4.13 / 100gr');
    // An answer from a server built before the field carries none at all.
    expect(priceOf({ unitPrice: 0.89, unitPriceLabel: 'l' })?.unitPrice).toBe(
      '€0.89 / l'
    );
  });

  it('prints the figure alone when there is neither', () => {
    expect(
      priceOf({ unitPrice: 2, unitPriceLabel: null, unitBasis: null })
        ?.unitPrice
    ).toBe('€2.00');
  });
});
