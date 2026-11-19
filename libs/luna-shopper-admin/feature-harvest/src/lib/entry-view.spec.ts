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

/**
 * What stated each price of a queued row (backend plan 0190).
 *
 * A website and a leaflet of one chain can share a row, so a row holds a
 * price of each kind for one scope. The kind is on the price, and it is not
 * always the kind of the row.
 */
describe('the kind of each price of a queued row', () => {
  const pricesOf = (prices: Record<string, unknown>[]) =>
    toSourceEntryRow(
      { id: 'entry-1', sourceKind: 'OFFICIAL_WEB', prices },
      'en'
    )?.prices ?? [];

  it('reads the kind of the price, and not the kind of the row', () => {
    const lines = pricesOf([
      { priceScopeId: 'ps-1', currency: 'EUR', sourceKind: 'OFFICIAL_WEB' },
      {
        priceScopeId: 'ps-1',
        currency: 'EUR',
        sourceKind: 'OFFICIAL_LEAFLET',
      },
    ]);

    expect(lines.map((line) => [line.scopeId, line.sourceKind])).toEqual([
      ['ps-1', 'OFFICIAL_WEB'],
      ['ps-1', 'OFFICIAL_LEAFLET'],
    ]);
  });

  it('answers null for a price with no kind, and never the kind of the row', () => {
    // A price from before the plan whose kind nobody could read, an answer
    // from a server built before the field, and a kind this app does not
    // know.
    const lines = pricesOf([
      { priceScopeId: 'ps-1', currency: 'EUR', sourceKind: null },
      { priceScopeId: 'ps-2', currency: 'EUR' },
      { priceScopeId: 'ps-3', currency: 'EUR', sourceKind: 'USER_RECEIPT' },
    ]);

    expect(lines.map((line) => line.sourceKind)).toEqual([null, null, null]);
  });
});

/**
 * Every path the chain files a queued row under (backend plan 0268), read
 * from `unknown`: a shape this app does not expect reads as no paths.
 */
describe('the category paths of a queued row', () => {
  const pathsOf = (categoryPaths: unknown) =>
    toSourceEntryRow({ id: 'entry-1', categoryPaths }, 'en')?.categoryPaths;

  it('reads each path as one line, root first, in the order the chain gave', () => {
    expect(
      pathsOf([
        ['Agua y refrescos', 'Cola'],
        ['Navidad', 'Ibéricos y quesos'],
      ])
    ).toEqual(['Agua y refrescos / Cola', 'Navidad / Ibéricos y quesos']);
  });

  it('keeps the one path beside them, as it was', () => {
    const row = toSourceEntryRow(
      {
        id: 'entry-1',
        categoryPath: ['Agua y refrescos', 'Cola'],
        categoryPaths: [['Agua y refrescos', 'Cola']],
      },
      'en'
    );
    expect(row?.categoryPath).toBe('Agua y refrescos / Cola');
    expect(row?.categoryPaths).toEqual(['Agua y refrescos / Cola']);
  });

  it('reads a malformed value as no paths', () => {
    // A server built before the field sends none at all.
    expect(pathsOf(undefined)).toEqual([]);
    expect(pathsOf(null)).toEqual([]);
    expect(pathsOf('Cola')).toEqual([]);
    expect(pathsOf({ 0: ['Cola'] })).toEqual([]);
    // An item that is not a path is left out, and so is a path of no names.
    expect(pathsOf([['Cola', 3], 'Cola', [], [7]])).toEqual(['Cola']);
  });
});

/**
 * A row whose own price and comparison price disprove its size (backend plan
 * 0249), read from `unknown` (admin plan 0072). Both sizes come out in the
 * row's own unit, as the harvester's refusal writes them.
 */
describe('the size doubt of a queued row', () => {
  const doubtOf = (row: Record<string, unknown>) =>
    toSourceEntryRow({ id: 'entry-1', ...row }, 'en')?.sizeDoubt;

  it('maps a doubt, with the implied size in the row unit', () => {
    // Mercadona's Ajax: a litre and a fifth stated, a price per millilitre.
    expect(
      doubtOf({
        unitSize: 1.2,
        sizeUnit: 'LITER',
        packCount: null,
        sizeDoubt: {
          implied: 1.2,
          unit: 'MILLILITER',
          ratio: 0.001,
          label: 'ml',
          runId: 'run-1',
        },
      })
    ).toEqual({
      stated: 1.2,
      implied: 0.0012,
      unit: 'LITER',
      ratio: 0.001,
      label: 'ml',
      runId: 'run-1',
      packGuess: null,
    });
  });

  it('keeps a base unit row in its own unit', () => {
    expect(
      doubtOf({
        unitSize: 125,
        sizeUnit: 'GRAM',
        sizeDoubt: {
          implied: 500,
          unit: 'GRAM',
          ratio: 4,
          label: 'kg',
          runId: 'run-1',
        },
      })
    ).toMatchObject({ stated: 125, implied: 500, unit: 'GRAM', packGuess: 4 });
  });

  it('reads a missing or malformed doubt as none', () => {
    const doubt = {
      implied: 500,
      unit: 'GRAM',
      ratio: 4,
      label: null,
      runId: 'run-1',
    };
    const row = { unitSize: 125, sizeUnit: 'GRAM' };

    // A server built before the field, and a row nobody doubts.
    expect(doubtOf(row)).toBeNull();
    expect(doubtOf({ ...row, sizeDoubt: null })).toBeNull();
    expect(doubtOf({ ...row, sizeDoubt: 'yes' })).toBeNull();
    // A figure missing or not a number, and no run.
    expect(
      doubtOf({ ...row, sizeDoubt: { ...doubt, implied: '500' } })
    ).toBeNull();
    expect(
      doubtOf({ ...row, sizeDoubt: { ...doubt, ratio: null } })
    ).toBeNull();
    expect(doubtOf({ ...row, sizeDoubt: { ...doubt, runId: '' } })).toBeNull();
    // No stated size to doubt.
    expect(doubtOf({ sizeUnit: 'GRAM', sizeDoubt: doubt })).toBeNull();
    // A base unit that is not the row's dimension is not one size.
    expect(
      doubtOf({ unitSize: 1, sizeUnit: 'LITER', sizeDoubt: doubt })
    ).toBeNull();
  });

  it('falls back to the base unit for a row that states no unit', () => {
    expect(
      doubtOf({
        unitSize: 30,
        sizeUnit: null,
        sizeDoubt: {
          implied: 1,
          unit: 'UNIT',
          ratio: 0.0333,
          label: 'ud',
          runId: 'run-1',
        },
      })
    ).toMatchObject({ stated: 30, implied: 1, unit: 'UNIT' });
  });

  it('guesses a pack for a ratio of 6.01 with no pack count, and not for 6.2', () => {
    const at = (ratio: number, packCount: number | null = null) =>
      doubtOf({
        unitSize: 330,
        sizeUnit: 'MILLILITER',
        packCount,
        sizeDoubt: {
          implied: 330 * ratio,
          unit: 'MILLILITER',
          ratio,
          label: 'l',
          runId: 'run-1',
        },
      })?.packGuess;

    expect(at(6.01)).toBe(6);
    expect(at(6.2)).toBeNull();
    // A row that states its pack gets no guess, as the harvester rules.
    expect(at(6.01, 6)).toBeNull();
    // Outside 2 to 48 is no pack at all.
    expect(at(1.01)).toBeNull();
    expect(at(49)).toBeNull();
  });
});
