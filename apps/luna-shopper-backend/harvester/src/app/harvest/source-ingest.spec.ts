import {
  ItemSourceMatch,
  PriceSourceKind,
  SourceEntryStatus,
} from '@portfolio/luna-shopper/contracts';
import type { Repository } from 'typeorm';
import type { SourceCatalogEntry, SourceEntryPrice } from '../entities';
import type { CatalogClient } from './catalog-client.service';
import { entryKey } from './matching';
import type { RunContext } from './run-context';
import { SourceIngest, type SourceObservation } from './source-ingest';

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
    find: jest.fn(async () => stored),
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
  const context = {
    runId: options.runId ?? RUN,
    report: jest.fn(async (counters: Record<string, number>) => {
      reported.push(counters);
    }),
  } as unknown as RunContext;

  const ingest = new SourceIngest(
    entries,
    prices,
    catalog as unknown as CatalogClient
  );
  return { ingest, context, entries, saved, stored, priceRows, catalog, reported };
}

function observation(
  over: Partial<SourceObservation> & { name: string }
): SourceObservation {
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
    price: null,
    ...over,
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
      priceScopeId: SCOPE,
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
      priceScopeId: SCOPE,
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
      priceScopeId: SCOPE,
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

    expect(outcomes[0]).toMatchObject({ rung: 2, created: true, itemId: 'item-ean' });
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
      PriceSourceKind.OFFICIAL_API
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
      priceScopeId: SCOPE,
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
      priceScopeId: SCOPE,
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
      priceScopeId: SCOPE,
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
      priceScopeId: SCOPE,
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
      priceScopeId: SCOPE,
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
    expect(counters).toMatchObject({ created: 1, pricesWritten: 0 });
    expect(catalog.addPrices).not.toHaveBeenCalled();
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
      priceScopeId: SCOPE,
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
      priceScopeId: 'scope-north',
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
      priceScopeId: 'scope-south',
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
      priceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      observations: [
        observation({ externalId: 'k1', name: 'Leche', price: PRICE }),
      ],
    });
    await ingest.ingest(context, {
      supermarketId: CHAIN,
      priceScopeId: SCOPE,
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
      priceScopeId: SCOPE,
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
    const extra = { page: 3, loyalty: { required: false }, anything: ['at all'] };
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
      priceScopeId: SCOPE,
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

  it('counts the batch result as updated and unchanged, as a refresh did', async () => {
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
      priceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      observations: [
        observation({ externalId: 'a', name: 'Uno', price: PRICE }),
      ],
    });

    // A new row is "the source said something new"; a confirmed row is not.
    expect(reported).toContainEqual({ updated: 2, unchanged: 1 });
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
      priceScopeId: SCOPE,
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
