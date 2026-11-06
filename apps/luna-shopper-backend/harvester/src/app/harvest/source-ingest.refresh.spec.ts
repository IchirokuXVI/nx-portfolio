import {
  PriceSourceKind,
  SourceEntryStatus,
} from '@portfolio/luna-shopper/contracts';
import type { Repository } from 'typeorm';
import type { SourceCatalogEntry, SourceEntryPrice } from '../entities';
import type { CatalogClient } from './catalog-client.service';
import type { RunContext } from './run-context';
import {
  SourceIngest,
  type PartialSourceObservation,
  type SourceObservationPrice,
} from './source-ingest';

/**
 * The narrow write a shopper's refresh goes through (plan 0216, section 2 and
 * the write tests of section 13).
 *
 * One observation is pushed through the walk path, a session's `writeChunk`
 * with a run context, and through `writeRefreshedPrices`, each into its own
 * fakes. The two must write the same `source_entry_prices` values and send the
 * same `catalog.addPrices` batch, except that the refresh carries no run: a
 * null `runId` on the row and a null `sourceRunId` at catalog.
 */

const CHAIN = '02160216-1111-4111-8111-111111111111';
const ITEM = '02160216-2222-4222-8222-222222222222';
const MADRID = '02160216-3333-4333-8333-333333333331';
const SEVILLA = '02160216-3333-4333-8333-333333333332';
const COPY = '02160216-3333-4333-8333-333333333333';
const RUN = '02160216-4444-4444-8444-444444444444';
const OBSERVED = new Date('2026-11-06T09:00:00.000Z');

type PriceRow = Record<string, unknown>;

function build(over: Partial<SourceCatalogEntry> = {}) {
  const row = {
    id: 'entry-1',
    supermarketId: CHAIN,
    externalId: '10381',
    name: 'Queso curado',
    sourceKind: PriceSourceKind.OFFICIAL_API,
    status: SourceEntryStatus.ACTIVE,
    itemId: ITEM,
    timesSeen: 3,
    soldByWeight: false,
    candidateEntryId: null,
    matchedBy: null,
    confidence: 1,
    decidedAt: null,
    sizeFormat: null,
    brand: null,
    ean: '8480000103817',
    unitSize: 1,
    categoryPath: [],
    url: null,
    imageUrl: null,
    extra: { shelf: 'cheese' },
    ...over,
  } as unknown as SourceCatalogEntry;

  const priceRows: PriceRow[] = [];
  const prices = {
    upsert: jest.fn(async (rows: PriceRow[]) => {
      priceRows.push(...rows);
      return undefined;
    }),
  } as unknown as Repository<SourceEntryPrice>;
  const entries = {
    find: jest.fn(async () => [{ ...row }]),
    save: jest.fn(async (saved: SourceCatalogEntry) => saved),
    create: jest.fn(),
  } as unknown as Repository<SourceCatalogEntry>;
  const catalog = {
    searchItems: jest.fn(async () => ({ items: [], nextCursor: null })),
    addPrices: jest.fn(async () => ({ inserted: 1, confirmed: 0 })),
    linkItemImages: jest.fn(async () => ({ results: [] })),
    unlinkItemImages: jest.fn(async () => ({ results: [] })),
  };
  const ingest = new SourceIngest(
    entries,
    prices,
    catalog as unknown as CatalogClient
  );
  return { ingest, row, priceRows, catalog, entries };
}

const context = {
  runId: RUN,
  report: jest.fn(async () => undefined),
  advance: jest.fn(async () => undefined),
  warn: jest.fn(),
} as unknown as RunContext;

const price = (
  scopeKey: string,
  over: Partial<SourceObservationPrice> = {}
): SourceObservationPrice => ({
  scopeKey,
  price: 3.25,
  currency: 'EUR',
  unitPrice: 9.41,
  unitPriceLabel: 'kg',
  validFrom: null,
  validUntil: null,
  ...over,
});

const observation = (
  prices: SourceObservationPrice[],
  over: Partial<PartialSourceObservation> = {}
): PartialSourceObservation => ({
  externalId: '10381',
  detailFetched: false,
  observedAt: OBSERVED,
  prices,
  ...over,
});

const scopeIdFor = (key: string) =>
  ({ madrid: MADRID, sevilla: SEVILLA })[key] ?? null;

async function walk(
  obs: PartialSourceObservation,
  over: Partial<SourceCatalogEntry> = {},
  copiesOf: (scope: string) => readonly string[] = () => []
) {
  const built = build(over);
  const session = await built.ingest.open(context, {
    supermarketId: CHAIN,
    defaultPriceScopeId: null,
    sourceKind: PriceSourceKind.OFFICIAL_API,
    scopeIdFor,
    copiesOf,
  });
  await session.push([obs]);
  await session.close();
  return built;
}

async function refresh(
  obs: PartialSourceObservation,
  over: Partial<SourceCatalogEntry> = {},
  copiesOf: (scope: string) => readonly string[] = () => []
) {
  const built = build(over);
  const result = await built.ingest.writeRefreshedPrices({
    entry: built.row,
    sourceKind: PriceSourceKind.OFFICIAL_API,
    observation: obs,
    scopeIdFor,
    copiesOf,
  });
  return { ...built, result };
}

/** A call's arguments with the run id taken out, which is the one difference. */
function withoutRun(calls: unknown[][]): unknown[][] {
  return calls.map(([scope, entries, , kind, copied]) => [
    scope,
    entries,
    kind,
    copied,
  ]);
}

describe('SourceIngest.writeRefreshedPrices (plan 0216)', () => {
  it('writes the rows and the batch the walk writes, with no run', async () => {
    const obs = observation([price('madrid')]);
    const walked = await walk(obs);
    const refreshed = await refresh(obs);

    expect(refreshed.priceRows).toEqual(
      walked.priceRows.map((row) => ({ ...row, runId: null }))
    );
    expect(walked.priceRows[0]).toMatchObject({
      entryId: 'entry-1',
      priceScopeId: MADRID,
      price: 3.25,
      details: { shelf: 'cheese' },
      runId: RUN,
    });
    expect(withoutRun(refreshed.catalog.addPrices.mock.calls)).toEqual(
      withoutRun(walked.catalog.addPrices.mock.calls)
    );
    expect(walked.catalog.addPrices.mock.calls[0][2]).toBe(RUN);
    expect(refreshed.catalog.addPrices.mock.calls[0][2]).toBeNull();
    expect(refreshed.result).toEqual({
      recorded: 1,
      inserted: 1,
      confirmed: 0,
      soldAnotherWay: false,
    });
  });

  it('writes no source row: the stored fields stay what the walk wrote', async () => {
    const refreshed = await refresh(observation([price('madrid')]));
    expect(refreshed.entries.save).not.toHaveBeenCalled();
    expect(refreshed.entries.find).not.toHaveBeenCalled();
    expect(refreshed.catalog.searchItems).not.toHaveBeenCalled();
  });

  it('writes a row sold by weight as the walk does', async () => {
    const obs = observation([price('madrid', { price: 9.41 })], {
      soldByWeight: true,
    });
    const over = { soldByWeight: true };
    const walked = await walk(obs, over);
    const refreshed = await refresh(obs, over);
    expect(withoutRun(refreshed.catalog.addPrices.mock.calls)).toEqual(
      withoutRun(walked.catalog.addPrices.mock.calls)
    );
    expect(refreshed.priceRows).toHaveLength(1);
  });

  it('writes nothing for a read sold another way than its row', async () => {
    const refreshed = await refresh(
      observation([price('madrid')], { soldByWeight: true }),
      { soldByWeight: false }
    );
    expect(refreshed.result.soldAnotherWay).toBe(true);
    expect(refreshed.priceRows).toEqual([]);
    expect(refreshed.catalog.addPrices).not.toHaveBeenCalled();
  });

  it('rewrites a copy as the walk does, and adds no copy target', async () => {
    const copiesOf = (scope: string) => (scope === MADRID ? [COPY] : []);
    const obs = observation([price('madrid')]);
    const walked = await walk(obs, {}, copiesOf);
    const refreshed = await refresh(obs, {}, copiesOf);

    expect(refreshed.priceRows).toEqual(
      walked.priceRows.map((row) => ({ ...row, runId: null }))
    );
    expect(refreshed.priceRows.map((row) => row['priceScopeId'])).toEqual([
      MADRID,
      COPY,
    ]);
    expect(refreshed.priceRows[1]['copiedFromScopeId']).toBe(MADRID);
    expect(withoutRun(refreshed.catalog.addPrices.mock.calls)).toEqual(
      withoutRun(walked.catalog.addPrices.mock.calls)
    );
    // A copy is not counted, as a walk does not count one.
    expect(refreshed.result.recorded).toBe(1);
    expect(refreshed.result.inserted).toBe(1);
  });

  it('drops a region that has no scope, with no write', async () => {
    const refreshed = await refresh(
      observation([price('madrid'), price('a-region-nobody-declared')])
    );
    expect(refreshed.priceRows.map((row) => row['priceScopeId'])).toEqual([
      MADRID,
    ]);
    expect(refreshed.catalog.addPrices).toHaveBeenCalledTimes(1);
  });

  it('writes every region one page named', async () => {
    const refreshed = await refresh(
      observation([price('madrid'), price('sevilla', { price: 3.1 })])
    );
    expect(refreshed.priceRows.map((row) => row['priceScopeId'])).toEqual([
      MADRID,
      SEVILLA,
    ]);
    expect(
      refreshed.catalog.addPrices.mock.calls.map((call) => call[0])
    ).toEqual([MADRID, SEVILLA]);
  });

  it('records the price on a row nobody bound, and sends catalog none', async () => {
    const refreshed = await refresh(observation([price('madrid')]), {
      status: SourceEntryStatus.CANDIDATE,
    });
    expect(refreshed.priceRows).toHaveLength(1);
    expect(refreshed.catalog.addPrices).not.toHaveBeenCalled();
  });
});
