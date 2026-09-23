import {
  HarvestRunWrites,
  HarvestWarningCode,
  ItemSourceMatch,
  PriceSourceKind,
  SourceEntryStatus,
  type HarvestRunWarning,
} from '@portfolio/luna-shopper/contracts';
import type { Repository } from 'typeorm';
import type { SourceCatalogEntry, SourceEntryPrice } from '../entities';
import type { CatalogClient } from './catalog-client.service';
import { entryKey } from './matching';
import type { RunContext } from './run-context';
import {
  SourceIngest,
  type PartialSourceObservation,
  type SourceObservation,
  type SourceObservationPrice,
} from './source-ingest';

/**
 * The one ladder, rung by rung (plan 0086, sections 4 and 5).
 *
 * Every rung in isolation, the rule that only an `ACTIVE` row is owed a price,
 * the two scopes of D3, and the counters, which map onto the batch result the
 * way `refresh.runner.spec.ts` pinned before this plan deleted that runner.
 */

const CHAIN = '11111111-1111-4111-8111-111111111111';
const SCOPE = '22222222-2222-4222-8222-222222222222';
const RUN = '33333333-3333-4333-8333-333333333333';
const OTHER_RUN = '44444444-4444-4444-8444-444444444444';

interface CatalogItem {
  id: string;
  name: { es: string | null; en: string | null };
  brand: string | null;
  ean: string | null;
  unitSize: number | null;
}

interface PriceRow {
  entryId: string;
  priceScopeId: string;
  price: number | null;
  currency: string;
  unitPrice: number | null;
  unitPriceLabel: string | null;
  validFrom: Date | null;
  validUntil: Date | null;
  details: Record<string, unknown> | null;
  observedAt: Date;
  runId: string;
  copiedFromScopeId: string | null;
}

function build(options: {
  rows?: Partial<SourceCatalogEntry>[];
  items?: CatalogItem[];
  batch?: { inserted: number; confirmed: number };
  runId?: string;
}) {
  const stored = (options.rows ?? []).map(
    (row, index) =>
      ({
        id: row.id ?? `held-${index + 1}`,
        supermarketId: CHAIN,
        sourceKind: PriceSourceKind.OFFICIAL_API,
        timesSeen: 1,
        status: SourceEntryStatus.UNRESOLVED,
        itemId: null,
        candidateEntryId: null,
        matchedBy: null,
        confidence: 0,
        decidedAt: null,
        sizeFormat: null,
        brand: null,
        ean: null,
        unitSize: null,
        categoryPath: [],
        url: null,
        extra: null,
        ...row,
      }) as SourceCatalogEntry
  );
  const saved: SourceCatalogEntry[] = [];
  let created = 0;

  const entries = {
    // Filtered as the real query is: a session loads one chain's rows only.
    find: jest.fn(async (query: { where: { supermarketId: string } }) =>
      stored.filter((row) => row.supermarketId === query.where.supermarketId)
    ),
    create: jest.fn((row: SourceCatalogEntry) => {
      created += 1;
      return { id: `new-${created}`, ...row };
    }),
    save: jest.fn(async (row: SourceCatalogEntry) => {
      saved.push(row);
      return row;
    }),
  } as unknown as Repository<SourceCatalogEntry>;

  const priceRows: PriceRow[] = [];
  const prices = {
    upsert: jest.fn(async (rows: PriceRow[]) => {
      for (const row of rows) {
        const held = priceRows.findIndex(
          (each) =>
            each.entryId === row.entryId &&
            each.priceScopeId === row.priceScopeId
        );
        if (held === -1) {
          priceRows.push(row);
        } else {
          priceRows[held] = row;
        }
      }
      return undefined;
    }),
  } as unknown as Repository<SourceEntryPrice>;

  const catalog = {
    searchItems: jest.fn(async () => ({
      items: options.items ?? [],
      nextCursor: null,
    })),
    addPrices: jest.fn(
      async () => options.batch ?? { inserted: 0, confirmed: 0 }
    ),
  };

  const reported: Record<string, number>[] = [];
  const warnings: HarvestRunWarning[] = [];
  const context = {
    runId: options.runId ?? RUN,
    report: jest.fn(async (counters: Record<string, number>) => {
      reported.push(counters);
    }),
    warn: jest.fn((warning: HarvestRunWarning) => {
      warnings.push(warning);
    }),
  } as unknown as RunContext;

  const ingest = new SourceIngest(
    entries,
    prices,
    catalog as unknown as CatalogClient
  );
  return {
    ingest,
    context,
    entries,
    saved,
    stored,
    priceRows,
    catalog,
    reported,
    warnings,
  };
}

/**
 * One observation, with `price` as shorthand for a single unscoped price.
 *
 * A product carries several prices now, one per scope the source named (plan
 * 0103, section 3.1). Most cases here are about the ladder rather than about
 * scopes, so they state the one price a source with no regions states, and the
 * cases that are about scopes pass `prices` instead.
 */
function observation(
  over: Partial<SourceObservation> & {
    name: string;
    price?: Omit<SourceObservationPrice, 'scopeKey'> | null;
  }
): SourceObservation {
  const { price, ...rest } = over;
  return {
    externalId: over.externalId ?? entryKey(over.name, over.sizeFormat ?? null),
    brand: null,
    ean: null,
    unitSize: null,
    sizeFormat: null,
    categoryPath: [],
    url: null,
    observedAt: new Date('2026-09-05T10:00:00.000Z'),
    extra: null,
    prices: price ? [{ scopeKey: null, ...price }] : [],
    ...rest,
  };
}

const PRICE = {
  price: 1.19,
  currency: 'EUR',
  unitPrice: 1.19,
  unitPriceLabel: '€/L',
  validFrom: null,
  validUntil: null,
};

describe('SourceIngest, the one ladder (plan 0086, section 4)', () => {
  it('rung 1 touches an existing row and never re-derives its status', async () => {
    const { ingest, context, saved, priceRows, catalog } = build({
      rows: [
        {
          externalId: '4241',
          name: 'Leche entera',
          status: SourceEntryStatus.ACTIVE,
          itemId: 'item-1',
          matchedBy: ItemSourceMatch.MANUAL,
          confidence: 1,
          timesSeen: 3,
        },
      ],
      // An item whose name matches, which would give a fuzzy proposal if the
      // ladder ever asked. It must not: the row already exists.
      items: [
        {
          id: 'item-9',
          name: { es: 'Leche semidesnatada', en: null },
          brand: null,
          ean: null,
          unitSize: null,
        },
      ],
      batch: { inserted: 1, confirmed: 0 },
    });

    const { outcomes, counters } = await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      observations: [
        observation({
          externalId: '4241',
          name: 'Leche semidesnatada',
          price: PRICE,
        }),
      ],
    });

    expect(outcomes[0].rung).toBe(1);
    expect(outcomes[0].created).toBe(false);
    expect(outcomes[0].itemId).toBe('item-1');
    // The source group is rewritten and the decision group is not.
    expect(saved[0]).toMatchObject({
      name: 'Leche semidesnatada',
      status: SourceEntryStatus.ACTIVE,
      itemId: 'item-1',
      matchedBy: ItemSourceMatch.MANUAL,
      timesSeen: 4,
      lastRunId: RUN,
    });
    expect(counters).toMatchObject({ created: 0, updated: 1, unchanged: 0 });
    expect(priceRows).toHaveLength(1);
    expect(catalog.addPrices).toHaveBeenCalledTimes(1);
  });

  it('rung 1 touches a REJECTED row, writes no price, and asks nobody', async () => {
    const { ingest, context, saved, priceRows, catalog } = build({
      rows: [
        {
          externalId: 'k1',
          name: 'Cerveza',
          status: SourceEntryStatus.REJECTED,
          itemId: null,
          decidedAt: new Date('2026-08-01T00:00:00.000Z'),
        },
      ],
    });

    const { outcomes } = await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
      observations: [
        observation({ externalId: 'k1', name: 'Cerveza', price: PRICE }),
      ],
    });

    expect(outcomes[0]).toMatchObject({ rung: 1, itemId: null });
    expect(saved[0].status).toBe(SourceEntryStatus.REJECTED);
    // The scope's observation is still recorded, because the chain did print a
    // price. What is not written is an `item_prices` row: there is no item.
    expect(priceRows).toHaveLength(1);
    expect(catalog.addPrices).not.toHaveBeenCalled();
  });

  it('rung 2 makes an EAN match ACTIVE and writes its price', async () => {
    const { ingest, context, saved, catalog } = build({
      items: [
        {
          id: 'item-ean',
          name: { es: 'Nothing alike', en: null },
          brand: null,
          ean: '8480000123456',
          unitSize: null,
        },
      ],
      batch: { inserted: 1, confirmed: 0 },
    });

    const { outcomes, counters } = await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      observations: [
        observation({
          externalId: '4241',
          name: 'Leche entera',
          ean: '8480000123456',
          price: PRICE,
        }),
      ],
    });

    expect(outcomes[0]).toMatchObject({
      rung: 2,
      created: true,
      itemId: 'item-ean',
    });
    expect(saved[0]).toMatchObject({
      status: SourceEntryStatus.ACTIVE,
      matchedBy: ItemSourceMatch.EAN,
      confidence: 1,
      itemId: 'item-ean',
    });
    expect(saved[0].decidedAt).toBeInstanceOf(Date);
    expect(counters).toMatchObject({ created: 1, pricesWritten: 1 });
    expect(catalog.addPrices).toHaveBeenCalledWith(
      SCOPE,
      [
        {
          itemId: 'item-ean',
          price: 1.19,
          currency: 'EUR',
          unitPrice: 1.19,
          unitPriceLabel: '€/L',
          validFrom: null,
          validUntil: null,
          observedAt: '2026-09-05T10:00:00.000Z',
          // A walk states no leaflet tile, so the translation of its empty bag
          // is no details row at all.
          details: null,
        },
      ],
      RUN,
      PriceSourceKind.OFFICIAL_API,
      null
    );
  });

  it('rung 3 proposes a catalog item as a CANDIDATE and writes no price', async () => {
    const { ingest, context, saved, catalog } = build({
      items: [
        {
          id: 'item-fuzzy',
          name: { es: 'Leche entera', en: null },
          brand: 'Hacendado',
          ean: null,
          unitSize: 1,
        },
      ],
    });

    const { outcomes } = await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
      observations: [
        observation({
          name: 'Leche entera',
          brand: 'Hacendado',
          unitSize: 1,
          price: PRICE,
        }),
      ],
    });

    expect(outcomes[0]).toMatchObject({
      rung: 3,
      created: true,
      // Not ACTIVE, so nothing is owed a price.
      itemId: null,
    });
    expect(saved[0]).toMatchObject({
      status: SourceEntryStatus.CANDIDATE,
      matchedBy: ItemSourceMatch.NAME_BRAND_SIZE,
      confidence: 0.6,
      itemId: 'item-fuzzy',
      candidateEntryId: null,
    });
    expect(catalog.addPrices).not.toHaveBeenCalled();
  });

  it("rung 4 proposes an ACTIVE sibling's item across source kinds", async () => {
    // The walk's row, accepted by a person. The leaflet prints the same name
    // and size under a key of its own.
    const { ingest, context, saved, catalog } = build({
      rows: [
        {
          id: 'walk-row',
          externalId: '4241',
          sourceKind: PriceSourceKind.OFFICIAL_API,
          name: 'Leche entera',
          sizeFormat: '1 L',
          status: SourceEntryStatus.ACTIVE,
          itemId: 'item-accepted',
        },
      ],
    });

    const { outcomes } = await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
      observations: [
        observation({ name: 'LECHE ENTERA', sizeFormat: '1 l', price: PRICE }),
      ],
    });

    expect(outcomes[0]).toMatchObject({ rung: 4, created: true, itemId: null });
    expect(saved[0]).toMatchObject({
      status: SourceEntryStatus.CANDIDATE,
      matchedBy: ItemSourceMatch.NAME_SIZE,
      confidence: 0.6,
      itemId: 'item-accepted',
      candidateEntryId: null,
    });
    // A proposal, not a decision: still no price.
    expect(catalog.addPrices).not.toHaveBeenCalled();
  });

  it('rung 4 proposes a sibling row itself when the sibling has no item', async () => {
    const { ingest, context, saved } = build({
      rows: [
        {
          id: 'walk-row',
          externalId: '4241',
          sourceKind: PriceSourceKind.OFFICIAL_API,
          name: 'Leche entera',
          sizeFormat: '1 L',
          ean: '8480000123456',
          status: SourceEntryStatus.UNRESOLVED,
          itemId: null,
        },
      ],
    });

    const { outcomes } = await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
      observations: [observation({ name: 'Leche entera', sizeFormat: '1 L' })],
    });

    expect(outcomes[0].rung).toBe(4);
    // The admin creates the item from the row that carries the EAN, and both
    // resolve.
    expect(saved[0]).toMatchObject({
      status: SourceEntryStatus.CANDIDATE,
      itemId: null,
      candidateEntryId: 'walk-row',
    });
  });

  it('rung 4 ignores a REJECTED sibling', async () => {
    const { ingest, context, saved } = build({
      rows: [
        {
          id: 'rejected-row',
          externalId: '4241',
          name: 'Leche entera',
          sizeFormat: '1 L',
          status: SourceEntryStatus.REJECTED,
          itemId: null,
        },
      ],
    });

    const { outcomes } = await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
      observations: [observation({ name: 'Leche entera', sizeFormat: '1 L' })],
    });

    expect(outcomes[0].rung).toBe(5);
    expect(saved[0]).toMatchObject({
      status: SourceEntryStatus.UNRESOLVED,
      candidateEntryId: null,
    });
  });

  it('rung 5 queues a row that matched nothing', async () => {
    const { ingest, context, saved, catalog } = build({});

    const { outcomes, counters } = await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
      observations: [observation({ name: 'Algo nuevo', price: PRICE })],
    });

    expect(outcomes[0]).toMatchObject({ rung: 5, created: true, itemId: null });
    expect(saved[0]).toMatchObject({
      status: SourceEntryStatus.UNRESOLVED,
      matchedBy: null,
      confidence: 0,
      itemId: null,
    });
    // The price is kept on the source row and none of it reaches catalog, and
    // the two counters say so separately. Counting only the second is what made
    // the LIDL walk of 2026-09-09 report no price at all while its own rows
    // carried 8,154 of them.
    expect(counters).toMatchObject({
      created: 1,
      pricesRecorded: 1,
      pricesWritten: 0,
    });
    expect(catalog.addPrices).not.toHaveBeenCalled();
  });

  /**
   * The key follows the brand on every path a row is written by (plan 0115,
   * section 6).
   *
   * `brand` itself is untouched, here and everywhere in that plan: what the
   * chain printed is the run's to state, and a decision never rewrites it (D8).
   */
  it('keys the brand a source printed, on a created row and on a touched one', async () => {
    const { ingest, context, saved } = build({
      rows: [
        {
          id: 'held-1',
          externalId: entryKey('Cerveza', null),
          name: 'Cerveza',
          brand: 'Mahou',
          brandKey: 'mahou',
        },
      ],
    });

    await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      observations: [
        observation({ name: 'Cerveza', brand: 'MAHOU' }),
        observation({ name: 'Chorizo', brand: 'Campofrío' }),
        // A brand of punctuation has no key, so the row carries none. LIDL's
        // `-` and `---` arrive exactly like this.
        observation({ name: 'Oferta', brand: '---' }),
      ],
    });

    const byName = new Map(saved.map((row) => [row.name, row]));
    // The spelling is rewritten because a run rewrites the source group, and
    // the key follows it. The row is the same row.
    expect(byName.get('Cerveza')).toMatchObject({
      brand: 'MAHOU',
      brandKey: 'mahou',
    });
    expect(byName.get('Chorizo')).toMatchObject({
      brand: 'Campofrío',
      brandKey: 'campofrio',
    });
    expect(byName.get('Oferta')).toMatchObject({
      brand: '---',
      brandKey: null,
    });
  });

  it('collects a price for the ACTIVE rows only', async () => {
    const { ingest, context, catalog } = build({
      rows: [
        {
          externalId: 'active',
          name: 'Uno',
          status: SourceEntryStatus.ACTIVE,
          itemId: 'item-1',
        },
        {
          externalId: 'queued',
          name: 'Dos',
          status: SourceEntryStatus.CANDIDATE,
          itemId: 'item-2',
        },
      ],
      batch: { inserted: 1, confirmed: 0 },
    });

    await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      observations: [
        observation({ externalId: 'active', name: 'Uno', price: PRICE }),
        observation({ externalId: 'queued', name: 'Dos', price: PRICE }),
      ],
    });

    // The CANDIDATE row proposes `item-2`, and the proposal buys it nothing.
    const sent = catalog.addPrices.mock.calls[0][1] as { itemId: string }[];
    expect(sent.map((entry) => entry.itemId)).toEqual(['item-1']);
  });

  it('leaves two source_entry_prices rows for two runs of two scopes', async () => {
    const first = build({
      rows: [
        {
          id: 'row-1',
          externalId: 'k1',
          name: 'Leche',
          status: SourceEntryStatus.ACTIVE,
          itemId: 'item-1',
        },
      ],
    });
    await first.ingest.ingest(first.context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: 'scope-north',
      sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
      observations: [
        observation({ externalId: 'k1', name: 'Leche', price: PRICE }),
      ],
    });

    const second = build({
      rows: [
        {
          id: 'row-1',
          externalId: 'k1',
          name: 'Leche',
          status: SourceEntryStatus.ACTIVE,
          itemId: 'item-1',
        },
      ],
      runId: OTHER_RUN,
    });
    await second.ingest.ingest(second.context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: 'scope-south',
      sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
      observations: [
        observation({
          externalId: 'k1',
          name: 'Leche',
          price: { ...PRICE, price: 0.99 },
        }),
      ],
    });

    // Two regions of one chain, one decision, two prices (D3). Each carries the
    // run that observed it, which is what an accept stamps and a revert reads.
    expect(first.priceRows).toEqual([
      expect.objectContaining({
        entryId: 'row-1',
        priceScopeId: 'scope-north',
        price: 1.19,
        runId: RUN,
      }),
    ]);
    expect(second.priceRows).toEqual([
      expect.objectContaining({
        entryId: 'row-1',
        priceScopeId: 'scope-south',
        price: 0.99,
        runId: OTHER_RUN,
      }),
    ]);
  });

  it('replaces one scope its own row rather than adding a second', async () => {
    const { ingest, context, priceRows } = build({
      rows: [
        {
          id: 'row-1',
          externalId: 'k1',
          name: 'Leche',
          status: SourceEntryStatus.ACTIVE,
          itemId: 'item-1',
        },
      ],
    });

    await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      observations: [
        observation({ externalId: 'k1', name: 'Leche', price: PRICE }),
      ],
    });
    await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      observations: [
        observation({
          externalId: 'k1',
          name: 'Leche',
          price: { ...PRICE, price: 0.95 },
        }),
      ],
    });

    expect(priceRows).toHaveLength(1);
    expect(priceRows[0].price).toBe(0.95);
  });

  it('writes the unit price alone when the source stated no till price', async () => {
    const { ingest, context, catalog, priceRows } = build({
      rows: [
        {
          id: 'row-1',
          externalId: 'k1',
          name: 'Jamon',
          status: SourceEntryStatus.ACTIVE,
          itemId: 'item-1',
        },
      ],
      batch: { inserted: 1, confirmed: 0 },
    });

    await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
      observations: [
        observation({
          externalId: 'k1',
          name: 'Jamon',
          price: {
            price: null,
            currency: 'EUR',
            unitPrice: 12.9,
            unitPriceLabel: 'el kilo',
            validFrom: null,
            validUntil: null,
          },
        }),
      ],
    });

    expect(priceRows[0]).toMatchObject({ price: null, unitPrice: 12.9 });
    expect(catalog.addPrices.mock.calls[0][1][0]).toMatchObject({
      price: null,
      unitPrice: 12.9,
      unitPriceLabel: 'el kilo',
    });
  });

  it('carries the extra bag onto the row and onto the price row, untouched', async () => {
    const extra = {
      page: 3,
      loyalty: { required: false },
      anything: ['at all'],
    };
    const { ingest, context, saved, priceRows } = build({
      rows: [
        {
          id: 'row-1',
          externalId: 'k1',
          name: 'Leche',
          status: SourceEntryStatus.ACTIVE,
          itemId: 'item-1',
        },
      ],
    });

    await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
      observations: [
        observation({
          externalId: 'k1',
          name: 'Leche',
          extra,
          price: PRICE,
        }),
      ],
    });

    expect(saved[0].extra).toEqual(extra);
    expect(priceRows[0].details).toEqual(extra);
  });

  it('counts new prices as updated, and unchanged as products only', async () => {
    const { ingest, context, reported } = build({
      rows: [
        {
          externalId: 'a',
          name: 'Uno',
          status: SourceEntryStatus.ACTIVE,
          itemId: 'item-1',
        },
      ],
      batch: { inserted: 2, confirmed: 1 },
    });

    const result = await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      observations: [
        observation({ externalId: 'a', name: 'Uno', price: PRICE }),
      ],
    });

    // A new row is "the source said something new". A confirmed price moves
    // no progress counter: `unchanged` is the one product the ladder left
    // alone, and the confirmed price is `pricesConfirmed` (plan 0158).
    expect(reported).toContainEqual({ updated: 2 });
    const unchanged = reported.reduce(
      (sum, counters) => sum + (counters.unchanged ?? 0),
      0
    );
    expect(unchanged).toBe(1);
    expect(result.counters).toMatchObject({
      pricesWritten: 2,
      pricesConfirmed: 1,
      unchanged: 1,
    });
  });

  it('treats a key seen twice in one batch as one row', async () => {
    const { ingest, context, saved } = build({});

    const { outcomes } = await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
      observations: [
        observation({ externalId: 'k1', name: 'Leche' }),
        observation({ externalId: 'k1', name: 'Leche' }),
      ],
    });

    expect(outcomes.map((outcome) => outcome.created)).toEqual([true, false]);
    expect(outcomes[1].rung).toBe(1);
    expect(saved.filter((row) => row.externalId === 'k1')).toHaveLength(2);
    expect(new Set(saved.map((row) => row.id)).size).toBe(1);
  });
});

/**
 * The one thing rung 1 does re-derive (plan 0103, section 6.2).
 *
 * A row created without an EAN could not reach rung 2, and Carrefour is a whole
 * chain in that state: its listing card carries no EAN and its product page
 * does. The backfill used to write the EAN and promote the row itself, holding a
 * repository to do it. The promotion is the ladder's now, which is the one place
 * that writes rows, and it is the rule plan 0086 already stated: only an EAN or
 * a person ever makes a row `ACTIVE`.
 */
describe('SourceIngest, rung 1 and an EAN that has just arrived', () => {
  const held = {
    externalId: 'p1',
    name: 'Agua CARREFOUR',
    ean: null,
    status: SourceEntryStatus.UNRESOLVED,
    itemId: null,
  };
  const item = {
    id: 'item-water',
    name: { es: 'Something else entirely', en: null },
    brand: null,
    ean: '8411327052016',
    unitSize: null,
  };

  it('promotes an undecided row when the new EAN names a catalog item', async () => {
    const { ingest, context, saved } = build({ rows: [held], items: [item] });

    const { outcomes } = await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: null,
      sourceKind: PriceSourceKind.OFFICIAL_WEB,
      observations: [
        observation({
          externalId: 'p1',
          name: 'Agua CARREFOUR',
          ean: '8411327052016',
        }),
      ],
    });

    expect(outcomes[0].rung).toBe(2);
    expect(saved[0]).toMatchObject({
      ean: '8411327052016',
      itemId: 'item-water',
      status: SourceEntryStatus.ACTIVE,
      matchedBy: ItemSourceMatch.EAN,
      confidence: 1,
    });
  });

  it('leaves a row a person decided exactly as it is', async () => {
    // A run does not reopen a decision a person made, whatever it now knows.
    const { ingest, context, saved } = build({
      rows: [
        {
          ...held,
          status: SourceEntryStatus.REJECTED,
          decidedAt: new Date('2026-09-01T00:00:00Z'),
        },
      ],
      items: [item],
    });

    await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: null,
      sourceKind: PriceSourceKind.OFFICIAL_WEB,
      observations: [
        observation({
          externalId: 'p1',
          name: 'Agua CARREFOUR',
          ean: '8411327052016',
        }),
      ],
    });

    // The EAN is a source column and is written; the decision is not touched.
    expect(saved[0].ean).toBe('8411327052016');
    expect(saved[0].status).toBe(SourceEntryStatus.REJECTED);
    expect(saved[0].itemId).toBeNull();
  });

  it('promotes nothing when the EAN names no item this catalog holds', async () => {
    const { ingest, context, saved } = build({ rows: [held], items: [] });

    const { outcomes } = await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: null,
      sourceKind: PriceSourceKind.OFFICIAL_WEB,
      observations: [
        observation({
          externalId: 'p1',
          name: 'Agua CARREFOUR',
          ean: '8411327052016',
        }),
      ],
    });

    expect(outcomes[0].rung).toBe(1);
    expect(saved[0].ean).toBe('8411327052016');
    expect(saved[0].status).toBe(SourceEntryStatus.UNRESOLVED);
  });
});

/**
 * A run that pushes as it fetches (plan 0103, section 2.3).
 *
 * The session exists for one reason and these cases are that reason: the chain's
 * rows, the sibling index and the catalog item index are loaded once and held
 * across every chunk.
 */
describe('SourceIngestSession, the indexes held across chunks', () => {
  it('loads the chain and the catalog once, however many chunks are pushed', async () => {
    const { ingest, context, entries, catalog } = build({});

    const session = await ingest.open(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_API,
    });
    await session.push([observation({ externalId: 'a', name: 'Uno' })]);
    await session.push([observation({ externalId: 'b', name: 'Dos' })]);
    await session.push([observation({ externalId: 'c', name: 'Tres' })]);
    const result = await session.close();

    // Three chunks, one read of each index. Calling `ingest` per chunk would
    // have made this three and three.
    expect(entries.find).toHaveBeenCalledTimes(1);
    expect(catalog.searchItems).toHaveBeenCalledTimes(1);
    expect(result.outcomes).toHaveLength(3);
    expect(result.counters.created).toBe(3);
  });

  it('sees in a later chunk the row an earlier chunk of the same run created', async () => {
    const { ingest, context } = build({});

    const session = await ingest.open(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_API,
    });
    await session.push([observation({ externalId: 'k1', name: 'Leche' })]);
    await session.push([observation({ externalId: 'k1', name: 'Leche' })]);
    const result = await session.close();

    // Rung 1 on the second, because the row is in the index the session holds.
    // A session that rebuilt the index per chunk would have created it twice.
    expect(result.outcomes.map((outcome) => outcome.created)).toEqual([
      true,
      false,
    ]);
    expect(result.outcomes[1].rung).toBe(1);
  });

  it('refuses a push after it is closed', async () => {
    const { ingest, context } = build({});
    const session = await ingest.open(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_API,
    });
    await session.close();

    await expect(
      session.push([observation({ name: 'Tarde' })])
    ).rejects.toThrow(/closed/);
  });
});

/**
 * Which scope each price is written to (plan 0103, section 3.2).
 *
 * A price names its own scope or falls to the run's default, and a price that
 * can do neither is a warning and no row. It is never written to the default as
 * a guess: that would put one region's price on another region's shops.
 */
describe('SourceIngest, the scope a price names', () => {
  it('writes each price to the scope its key resolves to', async () => {
    const { ingest, context, priceRows } = build({});

    await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: null,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      scopeIdFor: (key) => (key === 'r1' ? 'scope-north' : 'scope-south'),
      observations: [
        observation({
          externalId: 'k1',
          name: 'Nevera',
          prices: [
            { ...PRICE, scopeKey: 'r1', price: 74.99 },
            { ...PRICE, scopeKey: 'r58', price: 77.99 },
          ],
        }),
      ],
    });

    // One product, one row, two prices. This is the walk LIDL makes in one pass
    // instead of the 54 it used to make.
    expect(priceRows.map((row) => [row.priceScopeId, row.price])).toEqual([
      ['scope-north', 74.99],
      ['scope-south', 77.99],
    ]);
  });

  it('warns and writes nothing for a price naming a scope nothing declared', async () => {
    const { ingest, context, priceRows, warnings } = build({});

    await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      scopeIdFor: () => null,
      observations: [
        observation({
          externalId: 'k1',
          name: 'Nevera',
          prices: [{ ...PRICE, scopeKey: 'r99' }],
        }),
      ],
    });

    // Never the default as a fallback: a scope the run cannot place is a price
    // that would land on the wrong shops (plan 0103, D4).
    expect(priceRows).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      code: HarvestWarningCode.UNKNOWN_PRICE_SCOPE,
      name: 'Nevera',
    });
  });

  it('warns and writes nothing for an unscoped price when the run has no default', async () => {
    const { ingest, context, priceRows, warnings, saved } = build({});

    await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: null,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      observations: [
        observation({ externalId: 'k1', name: 'Leche', price: PRICE }),
      ],
    });

    // Not a failed run. The row is written, because the source did name the
    // product; only the price had nowhere to go.
    expect(saved).toHaveLength(1);
    expect(priceRows).toEqual([]);
    expect(warnings[0]).toMatchObject({
      code: HarvestWarningCode.NO_PRICE_SCOPE,
      name: 'Leche',
    });
  });
});

/**
 * One walk written to several scopes (plan 0118, section 5).
 *
 * The copy happens here, where a resolved scope id becomes a write, so these
 * cases hand the ingest a `copiesOf` and nothing else knows.
 */
describe('SourceIngest, a price copied to other scopes (plan 0118)', () => {
  const W2 = '55555555-5555-4555-8555-555555555555';
  const REGION = '66666666-6666-4666-8666-666666666666';

  function bound() {
    return build({
      rows: [
        {
          externalId: '4241',
          name: 'Leche entera',
          status: SourceEntryStatus.ACTIVE,
          itemId: 'item-1',
          matchedBy: ItemSourceMatch.EAN,
          confidence: 1,
        },
      ],
      batch: { inserted: 1, confirmed: 0 },
    });
  }

  it('writes the price at the walked scope and at each target, each copy naming where it was read', async () => {
    const { ingest, context, priceRows, catalog, reported } = bound();

    const { counters, copies } = await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      copiesOf: (scopeId) => (scopeId === SCOPE ? [W2, REGION] : []),
      observations: [
        observation({ externalId: '4241', name: 'Leche', price: PRICE }),
      ],
    });

    expect(
      priceRows.map((row) => [row.priceScopeId, row.copiedFromScopeId])
    ).toEqual([
      [SCOPE, null],
      [W2, SCOPE],
      [REGION, SCOPE],
    ]);
    // Every copied row carries the run, which is what a revert deletes by.
    expect(priceRows.every((row) => row.runId === RUN)).toBe(true);

    expect(catalog.addPrices).toHaveBeenCalledTimes(3);
    const calls = (catalog.addPrices as jest.Mock).mock.calls;
    expect(calls.map((call) => [call[0], call[4]])).toEqual([
      [SCOPE, null],
      [W2, SCOPE],
      [REGION, SCOPE],
    ]);
    for (const call of calls) {
      expect(call[1]).toEqual([
        expect.objectContaining({ itemId: 'item-1', price: 1.19 }),
      ]);
      expect(call[2]).toBe(RUN);
    }

    // The walked scope's numbers keep their meaning, and the copies are apart.
    expect(counters).toMatchObject({ pricesRecorded: 1, pricesWritten: 1 });
    expect(copies.pricedScopes).toEqual(new Set([SCOPE]));
    expect(copies.pricesCopied).toEqual(new Map([[SCOPE, 2]]));
    expect(reported.filter((each) => !('processed' in each))).toEqual([
      { updated: 1 },
    ]);
  });

  it('copies the source row of a product nobody matched, and sends catalog nothing', async () => {
    const { ingest, context, priceRows, catalog } = build({});

    const { copies } = await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      copiesOf: () => [W2],
      observations: [
        observation({ externalId: 'k1', name: 'Nevera', price: PRICE }),
      ],
    });

    expect(priceRows.map((row) => row.priceScopeId)).toEqual([SCOPE, W2]);
    expect(catalog.addPrices).not.toHaveBeenCalled();
    expect(copies.pricesCopied.size).toBe(0);
  });

  it('never copies onto a scope the same product was priced at directly', async () => {
    // A chain that names its own regions can state a price for a target this
    // week. That price is the chain's own statement, and one upsert naming the
    // same row twice would be refused.
    const { ingest, context, priceRows } = build({});

    await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: null,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      scopeIdFor: (key) => (key === 'r1' ? 'scope-north' : 'scope-south'),
      copiesOf: (scopeId) => (scopeId === 'scope-north' ? ['scope-south'] : []),
      observations: [
        observation({
          externalId: 'k1',
          name: 'Nevera',
          prices: [
            { ...PRICE, scopeKey: 'r1', price: 74.99 },
            { ...PRICE, scopeKey: 'r58', price: 77.99 },
          ],
        }),
      ],
    });

    expect(
      priceRows.map((row) => [
        row.priceScopeId,
        row.price,
        row.copiedFromScopeId,
      ])
    ).toEqual([
      ['scope-north', 74.99, null],
      ['scope-south', 77.99, null],
    ]);
  });

  it('adds up the copies of every chunk a session is pushed', async () => {
    const { ingest, context } = bound();
    const session = await ingest.open(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      copiesOf: () => [W2],
    });

    await session.push([
      observation({ externalId: '4241', name: 'Leche', price: PRICE }),
    ]);
    await session.push([
      observation({ externalId: '4241', name: 'Leche', price: PRICE }),
    ]);
    const { copies } = await session.close();

    expect(copies.pricesCopied).toEqual(new Map([[SCOPE, 2]]));
  });
});

/**
 * A product reported from the listing alone, because its detail was known
 * (plan 0119, section 6), and a run that writes only part of what it read
 * (section 7).
 */
describe('SourceIngest, a partial observation (plan 0119)', () => {
  const EAN = '8480000135636';
  const LAST_SEEN = new Date('2026-09-01T00:00:00.000Z');

  /** The row a full read of 4241 wrote last week. */
  const known = {
    externalId: '4241',
    name: 'Aceite de oliva virgen extra',
    brand: 'Hacendado',
    brandKey: 'hacendado',
    ean: EAN,
    unitSize: 1,
    sizeFormat: 'l',
    categoryPath: ['Aceite'],
    url: 'https://fixtures.test/product/4241',
    extra: { packaging: 'Garrafa' },
    status: SourceEntryStatus.ACTIVE,
    itemId: 'item-1',
    matchedBy: ItemSourceMatch.EAN,
    confidence: 1,
    timesSeen: 3,
    lastSeenAt: LAST_SEEN,
    lastRunId: OTHER_RUN,
  };

  function partial(
    over: Partial<PartialSourceObservation> = {}
  ): PartialSourceObservation {
    return {
      externalId: '4241',
      detailFetched: false,
      observedAt: new Date('2026-09-05T10:00:00.000Z'),
      prices: [{ scopeKey: null, ...PRICE }],
      ...over,
    };
  }

  it('keeps the stored identity, moves the seen fields and writes its prices', async () => {
    const { ingest, context, saved, priceRows, catalog } = build({
      rows: [known],
      batch: { inserted: 1, confirmed: 0 },
    });

    const { outcomes, counters } = await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      observations: [partial()],
    });

    // The last full read's name, brand and EAN, untouched: nothing here said
    // otherwise, and a null would have blanked them.
    expect(saved[0]).toMatchObject({
      name: 'Aceite de oliva virgen extra',
      brand: 'Hacendado',
      brandKey: 'hacendado',
      ean: EAN,
      unitSize: 1,
      sizeFormat: 'l',
      url: 'https://fixtures.test/product/4241',
      extra: { packaging: 'Garrafa' },
      status: SourceEntryStatus.ACTIVE,
      itemId: 'item-1',
      timesSeen: 4,
      lastRunId: RUN,
    });
    expect(saved[0].lastSeenAt.getTime()).toBeGreaterThan(LAST_SEEN.getTime());
    expect(outcomes[0]).toMatchObject({
      rung: 1,
      created: false,
      itemId: 'item-1',
    });

    // Unchanged, because the chain's description of the product did not move.
    expect(counters).toMatchObject({
      created: 0,
      updated: 0,
      unchanged: 1,
      pricesRecorded: 1,
      pricesWritten: 1,
    });
    // The price row carries the stored bag, which is what the last read said.
    expect(priceRows).toEqual([
      expect.objectContaining({
        entryId: 'held-1',
        priceScopeId: SCOPE,
        price: 1.19,
        details: { packaging: 'Garrafa' },
      }),
    ]);
    expect(catalog.addPrices).toHaveBeenCalledTimes(1);
  });

  it('skips a partial observation for a product with no row, with a warning', async () => {
    const { ingest, context, saved, priceRows, catalog, warnings } = build({
      rows: [],
    });

    const { outcomes, counters } = await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      observations: [partial({ externalId: '9001' })],
    });

    // No row with no name and no EAN, and no price with nowhere to hang it.
    expect(saved).toEqual([]);
    expect(outcomes).toEqual([]);
    expect(priceRows).toEqual([]);
    expect(catalog.addPrices).not.toHaveBeenCalled();
    expect(counters).toMatchObject({ created: 0, updated: 0, unchanged: 0 });
    expect(warnings).toEqual([
      expect.objectContaining({
        code: HarvestWarningCode.DETAIL_SKIPPED_UNKNOWN,
        offerId: '9001',
      }),
    ]);
  });

  it('keeps the outcomes and prices of the others in a chunk with a skipped one', async () => {
    const { ingest, context, priceRows } = build({
      rows: [known],
      batch: { inserted: 1, confirmed: 0 },
    });

    const { outcomes } = await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      observations: [partial({ externalId: '9001' }), partial()],
    });

    // The skipped one leaves no gap that shifts the next one's price onto it.
    expect(outcomes.map((outcome) => outcome.entry.externalId)).toEqual([
      '4241',
    ]);
    expect(priceRows.map((row) => row.entryId)).toEqual(['held-1']);
  });

  it('writes no price and no source_entry_prices row when the run writes availability only', async () => {
    const { ingest, context, saved, priceRows, catalog, warnings } = build({
      rows: [known],
    });

    const { counters, copies } = await ingest.ingest(context, {
      supermarketId: CHAIN,
      // No default scope either: a run that places no price has nothing to
      // warn about.
      defaultPriceScopeId: null,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      writes: HarvestRunWrites.AVAILABILITY,
      copiesOf: () => ['a-target'],
      observations: [
        partial(),
        observation({ externalId: '9001', name: 'Vinagre', price: PRICE }),
      ],
    });

    // The products are still ingested.
    expect(saved.map((row) => row.externalId)).toEqual(['4241', '9001']);
    expect(priceRows).toEqual([]);
    expect(catalog.addPrices).not.toHaveBeenCalled();
    expect(warnings).toEqual([]);
    expect(counters).toMatchObject({ pricesRecorded: 0, pricesWritten: 0 });
    // ...and neither are the copies.
    expect(copies.pricesCopied.size).toBe(0);
    expect(copies.pricedScopes.size).toBe(0);
  });

  it('writes prices and their copies when the run writes prices only', async () => {
    const { ingest, context, priceRows, catalog } = build({
      rows: [known],
      batch: { inserted: 1, confirmed: 0 },
    });

    await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      writes: HarvestRunWrites.PRICES,
      copiesOf: (scopeId) => (scopeId === SCOPE ? ['a-target'] : []),
      observations: [partial()],
    });

    expect(priceRows.map((row) => row.priceScopeId)).toEqual([
      SCOPE,
      'a-target',
    ]);
    expect(catalog.addPrices).toHaveBeenCalledTimes(2);
  });
});

/**
 * An EAN that several rows of one chain share binds none of them (plan 0155).
 *
 * Mercadona gives one EAN to five cuts of one fish. Each cut bound to the one
 * product that held the EAN, each walk wrote all five prices onto it, and a
 * shopper saw whichever was written last.
 */
describe('SourceIngest, an EAN that several rows of one chain share', () => {
  const OTHER_CHAIN = '55555555-5555-4555-8555-555555555555';
  const DORADA = '2300000000017';
  const dorada = {
    id: 'item-dorada',
    name: { es: 'Dorada', en: null },
    brand: null,
    ean: DORADA,
    unitSize: null,
  };
  const cuts = ['entera', 'limpia', 'filetes', 'lomos', 'rodajas'].map(
    (cut, index) =>
      observation({
        externalId: `dorada-${index + 1}`,
        name: `Dorada ${cut}`,
        ean: DORADA,
        price: { ...PRICE, price: 4.5 + index / 10 },
      })
  );

  it('queues five cuts sharing an EAN as candidates and sends no price for them', async () => {
    const { ingest, context, saved, catalog } = build({
      items: [dorada],
      batch: { inserted: 1, confirmed: 0 },
    });

    const { outcomes, counters } = await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      observations: cuts,
    });

    expect(outcomes).toHaveLength(5);
    for (const outcome of outcomes) {
      expect(outcome).toMatchObject({ rung: 2, created: true, itemId: null });
    }
    expect(saved).toHaveLength(5);
    for (const row of saved) {
      // The item stays on the row as the proposal a person decides on.
      expect(row).toMatchObject({
        status: SourceEntryStatus.CANDIDATE,
        matchedBy: ItemSourceMatch.SHARED_EAN,
        itemId: 'item-dorada',
        confidence: 0.6,
        decidedAt: null,
      });
    }
    expect(catalog.addPrices).not.toHaveBeenCalled();
    // The chain's own rows still record what it stated.
    expect(counters).toMatchObject({ pricesRecorded: 5, pricesWritten: 0 });
  });

  it('still binds the same EAN in each chain when each chain carries it once', async () => {
    // A row of another chain with the same EAN is not a sibling: the count is
    // per chain, and joining two chains is what an EAN is for.
    const { ingest, context, saved, catalog } = build({
      rows: [
        {
          id: 'other-chain-row',
          supermarketId: OTHER_CHAIN,
          externalId: 'x-1',
          name: 'Dorada',
          ean: DORADA,
          status: SourceEntryStatus.ACTIVE,
          matchedBy: ItemSourceMatch.EAN,
          itemId: 'item-dorada',
        },
      ],
      items: [dorada],
      batch: { inserted: 1, confirmed: 0 },
    });

    for (const supermarketId of [CHAIN, OTHER_CHAIN]) {
      await ingest.ingest(context, {
        supermarketId,
        defaultPriceScopeId: SCOPE,
        sourceKind: PriceSourceKind.OFFICIAL_API,
        observations: [
          observation({
            externalId: supermarketId === CHAIN ? 'a-1' : 'x-1',
            name: 'Dorada',
            ean: DORADA,
            price: PRICE,
          }),
        ],
      });
    }

    expect(
      saved.map((row) => [row.externalId, row.status, row.matchedBy])
    ).toEqual([
      ['a-1', SourceEntryStatus.ACTIVE, ItemSourceMatch.EAN],
      ['x-1', SourceEntryStatus.ACTIVE, ItemSourceMatch.EAN],
    ]);
    expect(catalog.addPrices).toHaveBeenCalledTimes(2);
  });

  it('unbinds a row an earlier chunk bound once a sibling with its EAN arrives', async () => {
    const { ingest, context, saved, catalog } = build({
      items: [dorada],
      batch: { inserted: 1, confirmed: 0 },
    });

    const session = await ingest.open(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_API,
    });
    // Alone in its chunk, the first cut cannot know about the second yet.
    const first = await session.push([cuts[0]]);
    expect(first[0].itemId).toBe('item-dorada');
    expect(catalog.addPrices).toHaveBeenCalledTimes(1);

    const second = await session.push([cuts[1]]);
    await session.close();

    expect(second[0].itemId).toBeNull();
    const byExternalId = new Map(saved.map((row) => [row.externalId, row]));
    for (const externalId of ['dorada-1', 'dorada-2']) {
      expect(byExternalId.get(externalId)).toMatchObject({
        status: SourceEntryStatus.CANDIDATE,
        matchedBy: ItemSourceMatch.SHARED_EAN,
        decidedAt: null,
      });
    }
    // Nothing more was sent. The first chunk's price stays in catalog, because
    // the ingest never deletes one.
    expect(catalog.addPrices).toHaveBeenCalledTimes(1);
  });

  it('unbinds a loaded EAN row that a new sibling shares, and not one a person accepted', async () => {
    const decidedAt = new Date('2026-09-01T00:00:00Z');
    const { ingest, context, catalog } = build({
      rows: [
        {
          id: 'bound-by-ean',
          externalId: 'dorada-1',
          name: 'Dorada entera',
          ean: DORADA,
          status: SourceEntryStatus.ACTIVE,
          matchedBy: ItemSourceMatch.EAN,
          itemId: 'item-dorada',
          confidence: 1,
          decidedAt,
        },
        {
          id: 'accepted',
          externalId: 'dorada-3',
          name: 'Dorada filetes',
          ean: DORADA,
          status: SourceEntryStatus.ACTIVE,
          matchedBy: ItemSourceMatch.MANUAL,
          itemId: 'item-dorada-filetes',
          confidence: 1,
          decidedAt,
        },
      ],
      items: [dorada],
      batch: { inserted: 1, confirmed: 0 },
    });

    const { outcomes } = await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      observations: [cuts[0], cuts[1], cuts[2]],
    });

    const [entera, limpia, filetes] = outcomes;
    expect(entera.itemId).toBeNull();
    expect(entera.entry).toMatchObject({
      status: SourceEntryStatus.CANDIDATE,
      matchedBy: ItemSourceMatch.SHARED_EAN,
      itemId: 'item-dorada',
      decidedAt: null,
    });
    expect(limpia.entry.matchedBy).toBe(ItemSourceMatch.SHARED_EAN);
    // A person's decision is not a run's to reopen, and its price is owed.
    expect(filetes.itemId).toBe('item-dorada-filetes');
    expect(filetes.entry).toMatchObject({
      status: SourceEntryStatus.ACTIVE,
      matchedBy: ItemSourceMatch.MANUAL,
      decidedAt,
    });
    expect(catalog.addPrices).toHaveBeenCalledTimes(1);
    expect(catalog.addPrices).toHaveBeenCalledWith(
      SCOPE,
      [expect.objectContaining({ itemId: 'item-dorada-filetes' })],
      RUN,
      PriceSourceKind.OFFICIAL_API,
      null
    );
  });

  it('proposes rather than binds when a row learns an EAN another row carries', async () => {
    const { ingest, context, saved } = build({
      rows: [
        {
          externalId: 'dorada-1',
          name: 'Dorada entera',
          ean: DORADA,
          status: SourceEntryStatus.CANDIDATE,
          matchedBy: ItemSourceMatch.SHARED_EAN,
          itemId: 'item-dorada',
        },
        { externalId: 'dorada-2', name: 'Dorada limpia', ean: null },
      ],
      items: [dorada],
    });

    const { outcomes } = await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: null,
      sourceKind: PriceSourceKind.OFFICIAL_WEB,
      observations: [cuts[1]],
    });

    expect(outcomes[0]).toMatchObject({ rung: 2, itemId: null });
    expect(saved[0]).toMatchObject({
      externalId: 'dorada-2',
      status: SourceEntryStatus.CANDIDATE,
      matchedBy: ItemSourceMatch.SHARED_EAN,
      itemId: 'item-dorada',
    });
  });
});

/**
 * At most one price per item and scope in a batch (plan 0155).
 *
 * Catalog keeps one current price per item, scope and kind, and compares each
 * entry with the one before it, so two entries of one item inserted a row each
 * time they disagreed and the one written last was what a shopper saw.
 */
describe('SourceIngest, two entries of one item in one batch', () => {
  const accepted = {
    status: SourceEntryStatus.ACTIVE,
    matchedBy: ItemSourceMatch.MANUAL,
    itemId: 'item-1',
    decidedAt: new Date('2026-09-01T00:00:00Z'),
  };

  it('sends no price for the item and counts one conflict', async () => {
    const { ingest, context, catalog } = build({
      rows: [
        { id: 'entry-a', externalId: 'a', name: 'Uno', ...accepted },
        { id: 'entry-b', externalId: 'b', name: 'Dos', ...accepted },
        {
          id: 'entry-c',
          externalId: 'c',
          name: 'Tres',
          ...accepted,
          itemId: 'item-2',
        },
      ],
      batch: { inserted: 1, confirmed: 0 },
    });

    const { counters } = await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      observations: [
        observation({ externalId: 'a', name: 'Uno', price: PRICE }),
        observation({
          externalId: 'b',
          name: 'Dos',
          price: { ...PRICE, price: 2.5 },
        }),
        observation({ externalId: 'c', name: 'Tres', price: PRICE }),
      ],
    });

    // Only the item one entry priced reaches catalog.
    expect(catalog.addPrices).toHaveBeenCalledTimes(1);
    expect(catalog.addPrices).toHaveBeenCalledWith(
      SCOPE,
      [expect.objectContaining({ itemId: 'item-2' })],
      RUN,
      PriceSourceKind.OFFICIAL_API,
      null
    );
    expect(counters).toMatchObject({
      pricesRecorded: 3,
      pricesWritten: 1,
      pricesConflicted: 1,
    });
  });

  it('sends one price when the same entry is observed twice in one batch', async () => {
    const { ingest, context, catalog } = build({
      rows: [{ id: 'entry-a', externalId: 'a', name: 'Uno', ...accepted }],
      batch: { inserted: 1, confirmed: 0 },
    });

    const { counters } = await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      observations: [
        observation({ externalId: 'a', name: 'Uno', price: PRICE }),
        observation({
          externalId: 'a',
          name: 'Uno',
          price: { ...PRICE, price: 2.5 },
        }),
      ],
    });

    // One row is one row: its later observation is the one it holds.
    expect(catalog.addPrices).toHaveBeenCalledWith(
      SCOPE,
      [expect.objectContaining({ itemId: 'item-1', price: 2.5 })],
      RUN,
      PriceSourceKind.OFFICIAL_API,
      null
    );
    expect(counters.pricesConflicted).toBe(0);
  });
});

describe('SourceIngest, rung 4 compares the size (plan 0155)', () => {
  it('does not propose a 1 l product for a 0.33 l entry of the same name', async () => {
    // Mercadona states only the unit in `sizeFormat`, so name and format alone
    // put a can and a bottle under one key. Postgres reads `numeric` as text.
    const { ingest, context, saved } = build({
      rows: [
        {
          id: 'bottle',
          externalId: 'm-1',
          name: 'Refresco cola',
          sizeFormat: 'l',
          unitSize: '1.0000' as unknown as number,
          status: SourceEntryStatus.ACTIVE,
          matchedBy: ItemSourceMatch.MANUAL,
          itemId: 'item-bottle',
        },
      ],
    });

    const { outcomes } = await ingest.ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      observations: [
        observation({
          externalId: 'm-2',
          name: 'Refresco cola',
          sizeFormat: 'l',
          unitSize: 0.33,
        }),
        observation({
          externalId: 'm-3',
          name: 'Refresco cola',
          sizeFormat: 'l',
          unitSize: 1,
        }),
      ],
    });

    expect(outcomes.map((outcome) => outcome.rung)).toEqual([5, 4]);
    expect(saved[0]).toMatchObject({
      externalId: 'm-2',
      status: SourceEntryStatus.UNRESOLVED,
      itemId: null,
    });
    expect(saved[1]).toMatchObject({
      externalId: 'm-3',
      status: SourceEntryStatus.CANDIDATE,
      itemId: 'item-bottle',
    });
  });
});
