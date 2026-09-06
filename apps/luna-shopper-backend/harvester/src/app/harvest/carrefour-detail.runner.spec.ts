import type { ConfigService } from '@nestjs/config';
import { CarrefourClient } from '@portfolio/luna-shopper/carrefour';
import {
  ItemSourceMatch,
  SourceEntryStatus,
} from '@portfolio/luna-shopper/contracts';
import type { Repository } from 'typeorm';
import type { SourceCatalogEntry, SupermarketSource } from '../entities';
import { CarrefourDetailRunner } from './carrefour-detail.runner';
import type { CatalogClient } from './catalog-client.service';
import type { RunContext } from './run-context';

/**
 * The EAN backfill, over a fake page loader and no browser (plan 0090, section
 * 12.1).
 *
 * What it pins is the pair of rules that make the pass safe to run and safe to
 * stop: it writes the EAN on any row it read, and it writes a **decision** only
 * on a row nobody has decided.
 */

const CHAIN = '11111111-1111-4111-8111-111111111111';
const RUN = '33333333-3333-4333-8333-333333333333';
const ITEM = '44444444-4444-4444-8444-444444444444';

/** One product page, as the storefront renders it. */
const productPage = (id: string, ean: string | null) => ({
  pdp: { product: { product_id: id, ean: ean ?? '' } },
});

function entry(over: Partial<SourceCatalogEntry> = {}): SourceCatalogEntry {
  return {
    id: `row-${over.externalId ?? '1'}`,
    supermarketId: CHAIN,
    externalId: over.externalId ?? 'p1',
    name: 'Agua CARREFOUR',
    brand: 'CARREFOUR',
    ean: null,
    unitSize: null,
    sizeFormat: '1,5 l.',
    url: `/supermercado/${over.externalId ?? 'p1'}/p`,
    status: SourceEntryStatus.UNRESOLVED,
    itemId: null,
    candidateEntryId: null,
    matchedBy: null,
    confidence: 0,
    decidedAt: null,
    ...over,
  } as SourceCatalogEntry;
}

class TestRunner extends CarrefourDetailRunner {
  constructor(
    entries: Repository<SourceCatalogEntry>,
    catalog: CatalogClient,
    protected readonly pages: Record<string, unknown>
  ) {
    super(entries, catalog, {
      getOrThrow: () => ({ userAgent: 'LunaShopperBot/1.0' }),
    } as unknown as ConfigService);
  }

  protected override createClient(): CarrefourClient {
    return new CarrefourClient({
      userAgent: 'LunaShopperBot/1.0',
      sleepImpl: async () => undefined,
      openSession: async () => ({
        goto: async (url: string) => {
          const state = this.pages[url.replace('https://www.carrefour.es', '')];
          return state
            ? { status: 200, state: state as Record<string, unknown> }
            : { status: 404, state: null };
        },
        close: async () => undefined,
      }),
    });
  }
}

/**
 * The same runner, over a session that refuses every page it does not hold.
 *
 * {@link TestRunner} answers 404 for an unknown path, which is a product page
 * that moved. This one answers 403, which is the storefront refusing.
 */
class RefusingRunner extends TestRunner {
  protected override createClient(): CarrefourClient {
    return new CarrefourClient({
      userAgent: 'LunaShopperBot/1.0',
      sleepImpl: async () => undefined,
      openSession: async () => ({
        goto: async (url: string) => {
          const state = this.pages[url.replace('https://www.carrefour.es', '')];
          return state
            ? { status: 200, state: state as Record<string, unknown> }
            : { status: 403, state: null };
        },
        close: async () => undefined,
      }),
    });
  }
}

function context(): RunContext {
  return {
    runId: RUN,
    signal: new AbortController().signal,
    acquire: async () => undefined,
    setStage: jest.fn(async () => undefined),
    setTotalPlanned: jest.fn(async () => undefined),
    setReport: jest.fn(async () => undefined),
    report: jest.fn(async () => undefined),
    flush: jest.fn(async () => undefined),
  } as unknown as RunContext;
}

const source = (config: Record<string, unknown> = {}): SupermarketSource =>
  ({ adapterKey: 'carrefour-web', config }) as SupermarketSource;

function repository(rows: SourceCatalogEntry[]): {
  repo: Repository<SourceCatalogEntry>;
  saved: SourceCatalogEntry[];
} {
  const saved: SourceCatalogEntry[] = [];
  const repo = {
    find: jest.fn(async () => rows),
    save: jest.fn(async (row: SourceCatalogEntry) => {
      saved.push(row);
      return row;
    }),
  } as unknown as Repository<SourceCatalogEntry>;
  return { repo, saved };
}

/** Catalog holding one item, known by the EAN the page prints. */
const catalogWith = (ean: string | null): CatalogClient =>
  ({
    searchItems: jest.fn(async () => ({
      items: ean
        ? [
            {
              id: ITEM,
              name: { es: 'Something else entirely' },
              brand: null,
              ean,
              unitSize: null,
            },
          ]
        : [],
      nextCursor: null,
    })),
  }) as unknown as CatalogClient;

describe('CarrefourDetailRunner', () => {
  it('writes the EAN the product page printed', async () => {
    const { repo, saved } = repository([entry()]);
    await new TestRunner(repo, catalogWith(null), {
      '/supermercado/p1/p': productPage('p1', '8411327052016'),
    }).run(context(), { supermarketId: CHAIN }, source());

    expect(saved).toHaveLength(1);
    expect(saved[0].ean).toBe('8411327052016');
  });

  it('resolves an undecided row when the EAN names a catalog item', async () => {
    // This is what the whole pass is for: with an EAN a product resolves with
    // confidence 1 and no person in the loop.
    const { repo, saved } = repository([entry()]);
    await new TestRunner(repo, catalogWith('8411327052016'), {
      '/supermercado/p1/p': productPage('p1', '8411327052016'),
    }).run(context(), { supermarketId: CHAIN }, source());

    expect(saved[0]).toMatchObject({
      itemId: ITEM,
      status: SourceEntryStatus.ACTIVE,
      matchedBy: ItemSourceMatch.EAN,
      confidence: 1,
    });
  });

  it('leaves a row a person decided exactly as it is', async () => {
    // A run does not reopen a decision a person made, whatever it now knows.
    const decided = entry({
      status: SourceEntryStatus.REJECTED,
      decidedAt: new Date('2026-09-01T00:00:00Z'),
    });
    const { repo, saved } = repository([decided]);
    await new TestRunner(repo, catalogWith('8411327052016'), {
      '/supermercado/p1/p': productPage('p1', '8411327052016'),
    }).run(context(), { supermarketId: CHAIN }, source());

    // The EAN is a source column and is written; the decision is not touched.
    expect(saved[0].ean).toBe('8411327052016');
    expect(saved[0].status).toBe(SourceEntryStatus.REJECTED);
    expect(saved[0].itemId).toBeNull();
  });

  it('treats a page that printed no EAN as a value and not an error', async () => {
    const { repo, saved } = repository([entry()]);
    const runContext = context();
    await new TestRunner(repo, catalogWith(null), {
      '/supermercado/p1/p': productPage('p1', null),
    }).run(runContext, { supermarketId: CHAIN }, source());

    expect(saved).toHaveLength(0);
    expect(runContext.setReport).toHaveBeenCalledWith(
      expect.objectContaining({ eansWritten: 0, noEanOnTheirPage: 1 })
    );
  });

  it('does nothing at all when every row already has one', async () => {
    // A product that has an EAN is never fetched again, which is the whole of
    // this pass's resume logic.
    const { repo, saved } = repository([]);
    const runContext = context();
    await new TestRunner(repo, catalogWith(null), {}).run(
      runContext,
      { supermarketId: CHAIN },
      source()
    );

    expect(saved).toHaveLength(0);
    expect(runContext.setReport).toHaveBeenCalledWith(
      expect.objectContaining({ pending: 0 })
    );
  });

  it('steps over a page the storefront refused and keeps going', async () => {
    // The live storefront refused the very first page of a backfill, and the
    // whole pass died. A skipped row keeps no EAN, which is the state it was
    // already in, so the next backfill takes it again for free.
    const rows = [entry({ externalId: 'p1' }), entry({ externalId: 'p2' })];
    const { repo, saved } = repository(rows);
    const runContext = context();
    // Only the second product has a page; the first is refused.
    await new RefusingRunner(repo, catalogWith(null), {
      '/supermercado/p2/p': productPage('p2', '8411327052016'),
    }).run(runContext, { supermarketId: CHAIN }, source());

    expect(saved.map((row) => row.externalId)).toEqual(['p2']);
    expect(runContext.setReport).toHaveBeenCalledWith(
      expect.objectContaining({ eansWritten: 1, refusedPages: 1 })
    );
  });

  it('stops when the refusals stop being isolated', async () => {
    // Three in a row is the block, and every page after it would be worse for
    // having been asked.
    const rows = ['p1', 'p2', 'p3', 'p4'].map((id) =>
      entry({ externalId: id })
    );
    const { repo } = repository(rows);
    await expect(
      new RefusingRunner(repo, catalogWith(null), {}).run(
        context(),
        { supermarketId: CHAIN },
        source()
      )
    ).rejects.toThrow(/refused/);
  });

  it('never touches the columns that say a run observed the product', async () => {
    // The backfill read one field off a page; it did not see the product in the
    // assortment, and a revert of this run must find nothing of its own.
    const row = entry({ timesSeen: 3, lastRunId: 'an-earlier-run' });
    const { repo, saved } = repository([row]);
    await new TestRunner(repo, catalogWith(null), {
      '/supermercado/p1/p': productPage('p1', '8411327052016'),
    }).run(context(), { supermarketId: CHAIN }, source());

    expect(saved[0].timesSeen).toBe(3);
    expect(saved[0].lastRunId).toBe('an-earlier-run');
  });
});
