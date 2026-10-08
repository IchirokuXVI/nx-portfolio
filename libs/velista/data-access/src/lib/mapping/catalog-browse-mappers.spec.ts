import { toProductPriceHistory } from './catalog-browse-mappers';

/** `GET /v1/catalog/items/:id/price-history` (backend `0196`, section 2). */
describe('toProductPriceHistory', () => {
  const FROM = '2026-07-01T00:00:00.000Z';
  const TO = '2026-09-29T00:00:00.000Z';
  const MERCADONA = {
    priceScopeId: 'scope-m',
    supermarketId: 'chain-m',
    points: [
      { at: FROM, price: 0.95, unitPrice: 0.95 },
      { at: '2026-08-10T00:00:00.000Z', price: 0.89, unitPrice: 0.89 },
    ],
  };

  it('reads the range and each series, with every time as a date', () => {
    expect(
      toProductPriceHistory({ from: FROM, to: TO, series: [MERCADONA] })
    ).toEqual({
      from: new Date(FROM),
      to: new Date(TO),
      series: [
        {
          priceScopeId: 'scope-m',
          supermarketId: 'chain-m',
          points: [
            { at: new Date(FROM), price: 0.95, unitPrice: 0.95 },
            {
              at: new Date('2026-08-10T00:00:00.000Z'),
              price: 0.89,
              unitPrice: 0.89,
            },
          ],
        },
      ],
    });
  });

  it('answers null without a range, because no line can be placed', () => {
    expect(toProductPriceHistory({ to: TO, series: [MERCADONA] })).toBeNull();
    expect(
      toProductPriceHistory({ from: FROM, series: [MERCADONA] })
    ).toBeNull();
    expect(
      toProductPriceHistory({ from: 'last month', to: TO, series: [] })
    ).toBeNull();
    expect(
      toProductPriceHistory({ from: FROM, to: 1790000000000, series: [] })
    ).toBeNull();
  });

  it('answers null for a body that is not the history', () => {
    for (const raw of [undefined, null, 0, 'oops', [], [MERCADONA]]) {
      expect(toProductPriceHistory(raw)).toBeNull();
    }
  });

  it('answers a range with no series when there is none to read', () => {
    expect(toProductPriceHistory({ from: FROM, to: TO })).toEqual({
      from: new Date(FROM),
      to: new Date(TO),
      series: [],
    });
    expect(
      toProductPriceHistory({ from: FROM, to: TO, series: 'none' })?.series
    ).toEqual([]);
  });

  it('drops a point it cannot date, alone', () => {
    const history = toProductPriceHistory({
      from: FROM,
      to: TO,
      series: [
        {
          ...MERCADONA,
          points: [
            { at: FROM, price: 0.95, unitPrice: 0.95 },
            { price: 0.92, unitPrice: 0.92 },
            { at: 'soon', price: 0.91, unitPrice: 0.91 },
            null,
            { at: '2026-08-10T00:00:00.000Z', price: 0.89, unitPrice: 0.89 },
          ],
        },
      ],
    });

    expect(history?.series[0]?.points.map((point) => point.price)).toEqual([
      0.95, 0.89,
    ]);
  });

  it('drops a series with no scope or no chain, alone', () => {
    const history = toProductPriceHistory({
      from: FROM,
      to: TO,
      series: [
        { ...MERCADONA, priceScopeId: null },
        { ...MERCADONA, supermarketId: 7 },
        'scope-m',
        { ...MERCADONA, priceScopeId: 'scope-d', supermarketId: 'chain-d' },
      ],
    });

    expect(history?.series.map((series) => series.priceScopeId)).toEqual([
      'scope-d',
    ]);
  });

  it('keeps a point with no price, which is a day the chain showed none', () => {
    const history = toProductPriceHistory({
      from: FROM,
      to: TO,
      series: [{ ...MERCADONA, points: [{ at: FROM, price: null }] }],
    });

    expect(history?.series[0]?.points).toEqual([
      { at: new Date(FROM), price: null, unitPrice: null },
    ]);
  });

  it('reads a price only from a number, never from text that looks like one', () => {
    // `nullableNum` takes a finite number and nothing else, and the contract
    // says a number. A point that sends "0.89" keeps its day and loses its
    // price, which the chart draws as a day with none.
    const history = toProductPriceHistory({
      from: FROM,
      to: TO,
      series: [
        {
          ...MERCADONA,
          points: [{ at: FROM, price: '0.89', unitPrice: Number.NaN }],
        },
      ],
    });

    expect(history?.series[0]?.points).toEqual([
      { at: new Date(FROM), price: null, unitPrice: null },
    ]);
  });
});
