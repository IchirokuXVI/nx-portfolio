import {
  PriceSourceKind,
  SourceEntryStatus,
} from '@portfolio/luna-shopper/contracts';
import type { FindOperator, Repository } from 'typeorm';
import type { SourceCatalogEntry, SourceEntryPrice } from '../entities';
import type { CatalogClient } from './catalog-client.service';
import {
  decideArticles,
  lowestPerKilo,
  SourceEntryPriceWriter,
  statementsOf,
  type Article,
} from './source-entry-write';

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
    // The kind of the run that observed it (plan 0190). Every run writes one.
    sourceKind: PriceSourceKind.OFFICIAL_API,
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
 * query does: the same chain and product, `ACTIVE`, and not the row being
 * written. Since plan 0191 it reads every such row, sold by weight or not,
 * because a second article is compared too. Since plan 0190 it reads rows of
 * every kind, because the kind that is compared is the kind of each price.
 *
 * It throws on a `where` that names the kind of the row, so a writer that
 * goes back to filtering rows by it fails here and not on real data.
 */
function build(table: SourceCatalogEntry[]) {
  const addPrices = jest.fn(async () => ({ inserted: 1, confirmed: 0 }));
  const find = jest.fn(
    async (query: {
      where: Partial<SourceCatalogEntry> & { id: FindOperator<string> };
    }) => {
      if ('sourceKind' in query.where) {
        throw new Error(
          'The other bound rows are read whatever the kind of the row is.'
        );
      }
      return table.filter(
        (row) =>
          row.id !== query.where.id.value &&
          row.supermarketId === query.where.supermarketId &&
          row.itemId === query.where.itemId &&
          row.status === query.where.status
      );
    }
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

  it('ignores a row of another product or another chain, and a price of another kind', async () => {
    const dear = piece('50943', [price('50943', 9.7)]);
    const { writer, addPrices } = build([
      dear,
      piece('a', [price('a', 1)], { itemId: 'item-2' }),
      piece('b', [price('b', 1)], { supermarketId: 'another-chain' }),
      // The kind that is compared is the kind of the price (plan 0190).
      piece('c', [
        price('c', 1, { sourceKind: PriceSourceKind.OFFICIAL_LEAFLET }),
      ]),
      piece('d', [price('d', 1)], { status: SourceEntryStatus.CANDIDATE }),
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

  it('writes the price of a pack that is the only row of its product', async () => {
    const pack = piece('51630', [price('51630', 2.95, { unitPrice: 9.83 })], {
      soldByWeight: false,
    });
    const { writer, addPrices } = build([pack]);

    await expect(writer.writeNamed(pack)).resolves.toEqual({
      written: 1,
      withheld: [],
    });

    expect(addPrices).toHaveBeenCalledWith(
      SCOPE,
      [expect.objectContaining({ price: 2.95, unitPrice: 9.83 })],
      RUN,
      PriceSourceKind.OFFICIAL_API,
      null
    );
  });

  it('asks for no other row when the row holds no open price', async () => {
    const { writer, addPrices, find } = build([piece('50943', [])]);

    await expect(writer.write(piece('50943', []))).resolves.toBe(0);

    expect(find).not.toHaveBeenCalled();
    expect(addPrices).not.toHaveBeenCalled();
  });
});

/** A pack: a row that is not sold by weight, bound to `item-1`. */
function pack(
  id: string,
  prices: SourceEntryPrice[],
  over: Partial<SourceCatalogEntry> = {}
): SourceCatalogEntry {
  return piece(id, prices, { soldByWeight: false, ...over });
}

describe('decideArticles, one rule for two articles (plan 0191)', () => {
  const article = (
    entryId: string,
    amount: number | string | null,
    over: Partial<Article> = {}
  ): Article => ({
    entryId,
    soldByWeight: false,
    price: amount,
    unitPrice: null,
    ...over,
  });

  it('answers nothing for no row, and the row for one', () => {
    const only = article('a', 2.45);
    expect(decideArticles([])).toBeNull();
    expect(decideArticles([only])).toEqual({ send: only, conflict: null });
  });

  it('sends the lowest price per kilo when every row is sold by weight', () => {
    const dear = article('a', 9.7, { soldByWeight: true, unitPrice: 9.7 });
    const cheap = article('b', 9.41, { soldByWeight: true, unitPrice: 9.41 });
    expect(decideArticles([dear, cheap])).toEqual({
      send: cheap,
      conflict: null,
    });
  });

  it('sends the amount two rows agree on, and it is the first row’s', () => {
    // A `numeric` comes back from Postgres as text. `"2.50"` and 2.5 are one
    // amount, and they are not the same string.
    const first = article('a', '2.50', { unitPrice: '8.3300' });
    const second = article('b', 2.5, { unitPrice: 8.33 });
    expect(decideArticles([first, second])).toEqual({
      send: first,
      conflict: null,
    });
  });

  it('sends nothing for two packs of two amounts, and names both', () => {
    const small = article('a', 2.45);
    const king = article('b', 2.95);
    expect(decideArticles([small, king])).toEqual({
      send: null,
      conflict: [small, king],
    });
  });

  it('calls two rows with one price and two unit prices a conflict', () => {
    // One pack price and two prices per kilo are two pack sizes.
    expect(
      decideArticles([
        article('a', 2.45, { unitPrice: 10.21 }),
        article('b', 2.45, { unitPrice: 9.42 }),
      ])?.send
    ).toBeNull();
  });

  it('never compares a pack with a piece sold by weight', () => {
    const piecePrice = article('a', 9.41, { soldByWeight: true });
    const packPrice = article('b', 2.95);
    expect(decideArticles([piecePrice, packPrice])).toEqual({
      send: null,
      conflict: [piecePrice, packPrice],
    });
  });
});

describe('SourceEntryPriceWriter, a second article of the chain (plan 0191)', () => {
  it('writes no price for the shared scope, and names the other row', async () => {
    // The El Pozo burger: two El Jamón articles on one product, in one scope.
    const small = pack('93003284', [price('93003284', 2.45)]);
    const king = pack('93003273', [price('93003273', 2.95)]);
    const { writer, addPrices } = build([small, king]);

    await expect(writer.writeNamed(king)).resolves.toEqual({
      written: 0,
      withheld: [
        {
          entryId: '93003273',
          priceScopeId: SCOPE,
          otherEntryIds: ['93003284'],
        },
      ],
    });
    expect(addPrices).not.toHaveBeenCalled();
  });

  it('still writes the scopes the other row does not price', async () => {
    const small = pack('93003284', [price('93003284', 2.45)]);
    const king = pack('93003273', [
      price('93003273', 2.95),
      price('93003273', 3.05, { priceScopeId: OTHER_SCOPE }),
    ]);
    const { writer, addPrices } = build([small, king]);

    const outcome = await writer.writeNamed(king);

    expect(outcome.written).toBe(1);
    expect(outcome.withheld.map((each) => each.priceScopeId)).toEqual([SCOPE]);
    expect(addPrices).toHaveBeenCalledTimes(1);
    expect(addPrices).toHaveBeenCalledWith(
      OTHER_SCOPE,
      [expect.objectContaining({ price: 3.05 })],
      RUN,
      PriceSourceKind.OFFICIAL_API,
      null
    );
  });

  it('writes its own statement when the other row states the same amount', async () => {
    // Two barcodes of one product at one price (plan 0185): not a question.
    const first = pack('a', [price('a', 0.96)]);
    const second = pack('b', [price('b', 0.96, { runId: OLDER_RUN })]);
    const { writer, addPrices } = build([first, second]);

    await expect(writer.writeNamed(second)).resolves.toEqual({
      written: 1,
      withheld: [],
    });
    expect(addPrices).toHaveBeenCalledWith(
      SCOPE,
      [expect.objectContaining({ price: 0.96 })],
      OLDER_RUN,
      PriceSourceKind.OFFICIAL_API,
      null
    );
  });

  it('is not stopped by another row whose window has closed, or of another kind', async () => {
    const king = pack('93003273', [price('93003273', 2.95)]);
    const { writer, addPrices } = build([
      king,
      pack('expired', [
        price('expired', 2.45, {
          validUntil: new Date('2020-01-01T00:00:00Z'),
        }),
      ]),
      // A price of another kind, which is the kind of the price since plan
      // 0190 and not the kind of its row.
      pack('leaflet', [
        price('leaflet', 1.99, {
          sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
        }),
      ]),
    ]);

    await expect(writer.writeNamed(king)).resolves.toEqual({
      written: 1,
      withheld: [],
    });
    expect(addPrices).toHaveBeenCalledTimes(1);
  });

  it('withholds a pack bound beside a piece sold by weight', async () => {
    const piecePrice = piece('50946', [price('50946', 9.41)]);
    const packPrice = pack('51630', [
      price('51630', 2.95, { unitPrice: 9.83 }),
    ]);
    const { writer, addPrices } = build([piecePrice, packPrice]);

    const outcome = await writer.writeNamed(packPrice);

    expect(outcome.withheld).toEqual([
      { entryId: '51630', priceScopeId: SCOPE, otherEntryIds: ['50946'] },
    ]);
    expect(addPrices).not.toHaveBeenCalled();
  });
});

describe('statementsOf (plan 0191)', () => {
  const NOW = new Date('2026-10-06T00:00:00.000Z');

  it('answers one verdict per scope and kind, over the open prices only', () => {
    const small = pack('a', [
      price('a', 2.45),
      price('a', 2.6, { priceScopeId: OTHER_SCOPE }),
    ]);
    const king = pack('b', [
      price('b', 2.95),
      price('b', 9.99, {
        priceScopeId: OTHER_SCOPE,
        validUntil: new Date('2020-01-01T00:00:00Z'),
      }),
    ]);

    const statements = statementsOf([small, king], NOW);

    expect(
      statements.map(({ priceScopeId, verdict }) => [
        priceScopeId,
        verdict.send?.entryId ?? null,
        verdict.conflict?.map((each) => each.entryId) ?? null,
      ])
    ).toEqual([
      [SCOPE, null, ['a', 'b']],
      [OTHER_SCOPE, 'a', null],
    ]);
  });

  it('compares pieces sold by weight within the newest run', () => {
    const dear = piece('a', [price('a', 9.7)]);
    const gone = piece('b', [
      price('b', 9.41, {
        runId: OLDER_RUN,
        observedAt: new Date('2026-09-01T06:00:00.000Z'),
      }),
    ]);

    const [statement] = statementsOf([gone, dear], NOW);

    expect(statement.verdict.send?.entryId).toBe('a');
  });

  it('keeps two source kinds of one scope apart, by the kind of each price', () => {
    const web = pack('a', [price('a', 2.45)]);
    const leaflet = pack('b', [
      price('b', 1.99, { sourceKind: PriceSourceKind.OFFICIAL_LEAFLET }),
    ]);

    const statements = statementsOf([web, leaflet], NOW);

    expect(statements.map((each) => each.sourceKind).sort()).toEqual([
      PriceSourceKind.OFFICIAL_API,
      PriceSourceKind.OFFICIAL_LEAFLET,
    ]);
    expect(statements.every((each) => each.verdict.send !== null)).toBe(true);
  });

  it('reads the kind from the price and not from the row (plan 0190)', () => {
    // One row that a website walk owns, with a price of each kind for one
    // scope. The kind of the row says who owns its text.
    const shared = pack(
      'a',
      [
        price('a', 2.45, {
          id: 'web',
          sourceKind: PriceSourceKind.OFFICIAL_WEB,
        }),
        price('a', 1.99, {
          id: 'leaflet',
          sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
        }),
      ],
      { sourceKind: PriceSourceKind.OFFICIAL_WEB }
    );

    const statements = statementsOf([shared], NOW);

    expect(
      statements
        .map((each) => [each.sourceKind, each.verdict.send?.stated.id])
        .sort()
    ).toEqual([
      [PriceSourceKind.OFFICIAL_LEAFLET, 'leaflet'],
      [PriceSourceKind.OFFICIAL_WEB, 'web'],
    ]);
  });

  it('states nothing for a price that has no kind', () => {
    const old = pack('a', [price('a', 2.45, { sourceKind: null })]);

    expect(statementsOf([old], NOW)).toEqual([]);
  });
});

describe('SourceEntryPriceWriter, the kind of each price (plan 0190)', () => {
  const LEAFLET_RUN = '66666666-6666-4666-8666-666666666666';

  /** A row that a website walk owns, as the eight Deza rows of slot 1 are. */
  function websiteRow(
    id: string,
    prices: SourceEntryPrice[],
    over: Partial<SourceCatalogEntry> = {}
  ): SourceCatalogEntry {
    return piece(id, prices, {
      sourceKind: PriceSourceKind.OFFICIAL_WEB,
      soldByWeight: false,
      ...over,
    });
  }

  function leafletPrice(
    entryId: string,
    amount: number,
    over: Partial<SourceEntryPrice> = {}
  ): SourceEntryPrice {
    return price(entryId, amount, {
      id: `leaflet-${entryId}`,
      sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
      runId: LEAFLET_RUN,
      unitPrice: null,
      unitPriceLabel: null,
      ...over,
    });
  }

  it('sends a leaflet price on a website row as a leaflet price', async () => {
    const row = websiteRow('covap', [leafletPrice('covap', 1.15)]);
    const { writer, addPrices } = build([row]);

    await expect(writer.writeNamed(row)).resolves.toEqual({
      written: 1,
      withheld: [],
    });

    expect(addPrices).toHaveBeenCalledTimes(1);
    expect(addPrices).toHaveBeenCalledWith(
      SCOPE,
      [expect.objectContaining({ itemId: 'item-1', price: 1.15 })],
      LEAFLET_RUN,
      PriceSourceKind.OFFICIAL_LEAFLET,
      null
    );
  });

  it('sends both prices of one scope, each under its own kind and run', async () => {
    const row = websiteRow('covap', [
      price('covap', 1.25, {
        id: 'web-covap',
        sourceKind: PriceSourceKind.OFFICIAL_WEB,
      }),
      leafletPrice('covap', 1.15),
    ]);
    const { writer, addPrices } = build([row]);

    await expect(writer.writeNamed(row)).resolves.toEqual({
      written: 2,
      withheld: [],
    });

    expect(addPrices).toHaveBeenCalledWith(
      SCOPE,
      [expect.objectContaining({ price: 1.25 })],
      RUN,
      PriceSourceKind.OFFICIAL_WEB,
      null
    );
    expect(addPrices).toHaveBeenCalledWith(
      SCOPE,
      [expect.objectContaining({ price: 1.15 })],
      LEAFLET_RUN,
      PriceSourceKind.OFFICIAL_LEAFLET,
      null
    );
  });

  it('compares with prices of the same kind only, whatever the kind of the other row', async () => {
    // Another row of the chain, which only a leaflet has described, prices
    // the product at another amount in the leaflet. That is a conflict for
    // the leaflet price. The website price meets nothing and is written.
    const row = websiteRow('covap', [
      price('covap', 1.25, {
        id: 'web-covap',
        sourceKind: PriceSourceKind.OFFICIAL_WEB,
      }),
      leafletPrice('covap', 1.15),
    ]);
    const other = websiteRow('tile', [leafletPrice('tile', 0.99)], {
      sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
    });
    const { writer, addPrices } = build([row, other]);

    await expect(writer.writeNamed(row)).resolves.toEqual({
      written: 1,
      withheld: [
        { entryId: 'covap', priceScopeId: SCOPE, otherEntryIds: ['tile'] },
      ],
    });

    expect(addPrices).toHaveBeenCalledTimes(1);
    expect(addPrices).toHaveBeenCalledWith(
      SCOPE,
      [expect.objectContaining({ price: 1.25 })],
      RUN,
      PriceSourceKind.OFFICIAL_WEB,
      null
    );
  });

  it('does not meet a price of another kind on a row of the same kind', async () => {
    // Two website rows of one product. One holds a website price and the
    // other a leaflet price of another amount, for one scope. Before the
    // plan both were compared under the kind of their rows, and neither was
    // sent.
    const row = websiteRow('a', [leafletPrice('a', 1.15)]);
    const other = websiteRow('b', [
      price('b', 1.25, { sourceKind: PriceSourceKind.OFFICIAL_WEB }),
    ]);
    const { writer, addPrices } = build([row, other]);

    await expect(writer.writeNamed(row)).resolves.toEqual({
      written: 1,
      withheld: [],
    });
    expect(addPrices).toHaveBeenCalledWith(
      SCOPE,
      [expect.objectContaining({ price: 1.15 })],
      LEAFLET_RUN,
      PriceSourceKind.OFFICIAL_LEAFLET,
      null
    );
  });

  it('sends no price that has no kind, and still sends the others', async () => {
    // A row from before the plan whose kind the migration could not read.
    // The kind of the row is not used for it: that would be a guess.
    const row = websiteRow('old', [
      price('old', 3.1, {
        id: 'unknown',
        sourceKind: null,
        runId: null,
        priceScopeId: OTHER_SCOPE,
      }),
      leafletPrice('old', 1.15),
    ]);
    const { writer, addPrices } = build([row]);

    // The price that was not sent is named, with the reason.
    await expect(writer.writeNamed(row)).resolves.toEqual({
      written: 1,
      withheld: [
        {
          entryId: 'old',
          priceScopeId: OTHER_SCOPE,
          otherEntryIds: [],
          kindUnknown: true,
        },
      ],
    });

    expect(addPrices).toHaveBeenCalledTimes(1);
    expect(addPrices).toHaveBeenCalledWith(
      SCOPE,
      expect.anything(),
      LEAFLET_RUN,
      PriceSourceKind.OFFICIAL_LEAFLET,
      null
    );
  });

  it('names a price of no kind also when it is the only price of the row', async () => {
    const row = websiteRow('old', [
      price('old', 3.1, { sourceKind: null, runId: null }),
    ]);
    const { writer, addPrices, find } = build([row]);

    await expect(writer.writeNamed(row)).resolves.toEqual({
      written: 0,
      withheld: [
        {
          entryId: 'old',
          priceScopeId: SCOPE,
          otherEntryIds: [],
          kindUnknown: true,
        },
      ],
    });
    expect(addPrices).not.toHaveBeenCalled();
    // Nothing to compare, so the other rows are not read.
    expect(find).not.toHaveBeenCalled();
  });

  it('does not name a price of no kind whose window has closed', async () => {
    const row = websiteRow('old', [
      price('old', 3.1, {
        sourceKind: null,
        validUntil: new Date('2020-01-01T00:00:00Z'),
      }),
    ]);
    const { writer } = build([row]);

    await expect(writer.writeNamed(row)).resolves.toEqual({
      written: 0,
      withheld: [],
    });
  });
});
