import {
  PriceSourceKind,
  SourceEntryStatus,
} from '@portfolio/luna-shopper/contracts';
import type { FindOperator, Repository } from 'typeorm';
import type { SourceCatalogEntry, SourceEntryPrice } from '../entities';
import type { CatalogClient } from './catalog-client.service';
import { lowestPerKilo, SourceEntryPriceWriter } from './source-entry-write';

/**
 * One price per product, scope and source (plan 0181), on the two paths a
 * person takes: accepting a row and creating a product from one. The run's own
 * path is pinned in `source-ingest.spec.ts`.
 */

const CHAIN = '11111111-1111-4111-8111-111111111111';
const SCOPE = '22222222-2222-4222-8222-222222222222';
const OTHER_SCOPE = '55555555-5555-4555-8555-555555555555';
const RUN = '33333333-3333-4333-8333-333333333333';
const OLDER_RUN = '44444444-4444-4444-8444-444444444444';
const OBSERVED = new Date('2026-10-03T06:00:00.000Z');

function price(
  entryId: string,
  perKilo: number | null,
  over: Partial<SourceEntryPrice> = {}
): SourceEntryPrice {
  return {
    id: `price-${entryId}-${over.priceScopeId ?? SCOPE}`,
    entryId,
    priceScopeId: SCOPE,
    price: perKilo,
    currency: 'EUR',
    unitPrice: perKilo,
    unitPriceLabel: 'kg',
    validFrom: null,
    validUntil: null,
    details: null,
    observedAt: OBSERVED,
    runId: RUN,
    copiedFromScopeId: null,
    ...over,
  } as SourceEntryPrice;
}

/** One piece of a cheese sold by weight, accepted onto `item-1`. */
function piece(
  id: string,
  prices: SourceEntryPrice[],
  over: Partial<SourceCatalogEntry> = {}
): SourceCatalogEntry {
  return {
    id,
    supermarketId: CHAIN,
    sourceKind: PriceSourceKind.OFFICIAL_API,
    externalId: id,
    name: 'Queso semicurado mezcla',
    itemId: 'item-1',
    status: SourceEntryStatus.ACTIVE,
    soldByWeight: true,
    unitSize: null,
    sizeUnit: null,
    sizeFormat: 'kg',
    prices,
    ...over,
  } as SourceCatalogEntry;
}

/**
 * The writer over a table of rows, with a `find` that filters as the real
 * query does: the same chain, source kind and product, `ACTIVE`, sold by
 * weight, and not the row being written.
 */
function build(table: SourceCatalogEntry[]) {
  const addPrices = jest.fn(async () => ({ inserted: 1, confirmed: 0 }));
  const find = jest.fn(
    async (query: {
      where: Partial<SourceCatalogEntry> & { id: FindOperator<string> };
    }) =>
      table.filter(
        (row) =>
          row.id !== query.where.id.value &&
          row.supermarketId === query.where.supermarketId &&
          row.sourceKind === query.where.sourceKind &&
          row.itemId === query.where.itemId &&
          row.status === query.where.status &&
          row.soldByWeight === query.where.soldByWeight
      )
  );
  const writer = new SourceEntryPriceWriter(
    { addPrices } as unknown as CatalogClient,
    { find } as unknown as Repository<SourceCatalogEntry>
  );
  return { writer, addPrices, find };
}

describe('lowestPerKilo (plan 0181)', () => {
  const figure = (value: number | null) => value;

  it('answers the lowest figure', () => {
    expect(lowestPerKilo([9.7, 9.41, 12.5], figure)).toBe(9.41);
  });

  it('answers the first of two equal figures', () => {
    const first = { perKilo: 9.41 };
    const second = { perKilo: 9.41 };
    expect(lowestPerKilo([first, second], (each) => each.perKilo)).toBe(first);
  });

  it('prefers any figure over none', () => {
    expect(lowestPerKilo([null, 9.7], figure)).toBe(9.7);
    expect(lowestPerKilo([9.7, null], figure)).toBe(9.7);
  });

  it('answers the first candidate when none has a figure, and null for none', () => {
    const first = { perKilo: null };
    expect(
      lowestPerKilo([first, { perKilo: null }], (each) => each.perKilo)
    ).toBe(first);
    expect(lowestPerKilo([], figure)).toBeNull();
  });
});

describe('SourceEntryPriceWriter, rows sold by weight (plan 0181)', () => {
  it('writes the lower per kilo figure of two pieces bound to one product', async () => {
    const dear = piece('50943', [price('50943', 9.7)]);
    const cheap = piece('50946', [price('50946', 9.41)]);
    const { writer, addPrices } = build([dear, cheap]);

    // The dearer piece is the one being accepted, and the price written for
    // the scope is still the cheaper piece's.
    await writer.write(dear);

    expect(addPrices).toHaveBeenCalledTimes(1);
    expect(addPrices).toHaveBeenCalledWith(
      SCOPE,
      [
        expect.objectContaining({
          itemId: 'item-1',
          price: 9.41,
          unitPrice: 9.41,
        }),
      ],
      RUN,
      PriceSourceKind.OFFICIAL_API,
      null
    );
  });

  it('writes its own figure when it is the lower one', async () => {
    const dear = piece('50943', [price('50943', 9.7)]);
    const cheap = piece('50946', [price('50946', 9.41)]);
    const { writer, addPrices } = build([dear, cheap]);

    await writer.write(cheap);

    expect(addPrices).toHaveBeenCalledWith(
      SCOPE,
      [expect.objectContaining({ price: 9.41 })],
      RUN,
      PriceSourceKind.OFFICIAL_API,
      null
    );
  });

  it('compares scope by scope', async () => {
    const dear = piece('50943', [
      price('50943', 9.7),
      price('50943', 9.2, { priceScopeId: OTHER_SCOPE }),
    ]);
    const cheap = piece('50946', [
      price('50946', 9.41),
      price('50946', 9.6, { priceScopeId: OTHER_SCOPE }),
    ]);
    const { writer, addPrices } = build([dear, cheap]);

    await writer.write(dear);

    const calls = addPrices.mock.calls as unknown as [
      string,
      { price: number }[],
    ][];
    expect(calls.map(([scope, [entry]]) => [scope, entry.price])).toEqual([
      [SCOPE, 9.41],
      [OTHER_SCOPE, 9.2],
    ]);
  });

  it('does not let a figure from an older run win', async () => {
    // The chain stopped listing the cheaper piece. Its row keeps the last
    // price it stated, and that is not what the chain says today.
    const dear = piece('50943', [price('50943', 9.7)]);
    const gone = piece('50946', [price('50946', 9.41, { runId: OLDER_RUN })]);
    const { writer, addPrices } = build([dear, gone]);

    await writer.write(dear);

    expect(addPrices).toHaveBeenCalledWith(
      SCOPE,
      [expect.objectContaining({ price: 9.7 })],
      RUN,
      PriceSourceKind.OFFICIAL_API,
      null
    );
  });

  it('ignores a piece whose window has closed', async () => {
    const dear = piece('50943', [price('50943', 9.7)]);
    const expired = piece('50946', [
      price('50946', 9.41, { validUntil: new Date('2020-01-01T00:00:00Z') }),
    ]);
    const { writer, addPrices } = build([dear, expired]);

    await writer.write(dear);

    expect(addPrices).toHaveBeenCalledWith(
      SCOPE,
      [expect.objectContaining({ price: 9.7 })],
      RUN,
      PriceSourceKind.OFFICIAL_API,
      null
    );
  });

  it('ignores a row of another product, another chain or another source kind', async () => {
    const dear = piece('50943', [price('50943', 9.7)]);
    const { writer, addPrices } = build([
      dear,
      piece('a', [price('a', 1)], { itemId: 'item-2' }),
      piece('b', [price('b', 1)], { supermarketId: 'another-chain' }),
      piece('c', [price('c', 1)], {
        sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
      }),
      piece('d', [price('d', 1)], { status: SourceEntryStatus.CANDIDATE }),
      // A fixed pack bound to the same product: its price is a pack's.
      piece('e', [price('e', 1)], { soldByWeight: false }),
    ]);

    await writer.write(dear);

    expect(addPrices).toHaveBeenCalledWith(
      SCOPE,
      [expect.objectContaining({ price: 9.7 })],
      RUN,
      PriceSourceKind.OFFICIAL_API,
      null
    );
  });

  it('asks for no other row when the row is not sold by weight', async () => {
    const pack = piece('51630', [price('51630', 2.95, { unitPrice: 9.83 })], {
      soldByWeight: false,
    });
    const { writer, addPrices, find } = build([
      pack,
      piece('50946', [price('50946', 1)]),
    ]);

    await writer.write(pack);

    expect(find).not.toHaveBeenCalled();
    expect(addPrices).toHaveBeenCalledWith(
      SCOPE,
      [expect.objectContaining({ price: 2.95, unitPrice: 9.83 })],
      RUN,
      PriceSourceKind.OFFICIAL_API,
      null
    );
  });
});
