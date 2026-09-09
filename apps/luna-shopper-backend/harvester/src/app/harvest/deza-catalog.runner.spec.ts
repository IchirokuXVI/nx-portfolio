import type { ConfigService } from '@nestjs/config';
import type { SupermarketSource } from '../entities';
import { DezaCatalogRunner, entryKey } from './deza-catalog.runner';
import { startFakeListing, type FakeListing } from './deza-listing.fake';
import type { RunContext } from './run-context';
import { RecordingRunReport } from './run-report';

const CHAIN = '11111111-1111-4111-8111-111111111111';
const RUN = '33333333-3333-4333-8333-333333333333';

const SECTIONS = [
  {
    code: 'W010000000',
    name: 'FRIO',
    children: [{ code: 'W011', name: 'Carniceria' }],
  },
  {
    code: 'W050000000',
    name: 'PAN',
    children: [{ code: 'W051', name: 'Bolleria' }],
  },
];

/** 400 rows in one section: over the 300 the source answers, so it is capped. */
function cappedSection() {
  return Array.from({ length: 400 }, (_, index) => ({
    description: `Producto MARCA${index % 7} variante${index} ${index} g`,
    section: 'W011',
    shops: index % 3 === 0 ? ['T1', 'C1'] : ['T1'],
  }));
}

interface Built {
  runner: DezaCatalogRunner;
  context: RunContext;
  /** What the run said about the world. */
  report: RecordingRunReport;
  /** What the run said about itself, which `setReport` wrote. */
  runReport: Record<string, unknown>;
}

/**
 * A crawl and the report it produced.
 *
 * **There is no repository, no `CatalogClient` and no `SourceLocationService`
 * here.** The runner fetches and reports, so a recording `RunReport` is the
 * whole of what it needs (plan 0103, section 9). What the orchestrator does
 * with a report, including resolving shop codes and writing availability, is
 * `run-report.sink.spec.ts`.
 */
function build(_listing: FakeListing): Built {
  const runReport: Record<string, unknown> = {};
  const context = {
    runId: RUN,
    signal: new AbortController().signal,
    acquire: async () => undefined,
    setStage: jest.fn(async () => undefined),
    setTotalPlanned: jest.fn(async () => undefined),
    report: jest.fn(async () => undefined),
    heartbeat: jest.fn(async () => undefined),
    flush: jest.fn(async () => undefined),
    setReport: jest.fn(async (value: Record<string, unknown>) => {
      Object.assign(runReport, value);
    }),
  } as unknown as RunContext;

  const runner = new DezaCatalogRunner({
    getOrThrow: () => ({ userAgent: 'test' }),
  } as unknown as ConfigService);

  return { runner, context, report: new RecordingRunReport(), runReport };
}

const source = (
  config: Record<string, unknown>,
  workers = 1
): SupermarketSource =>
  ({
    adapterKey: 'deza-web',
    workers,
    config,
  }) as unknown as SupermarketSource;

describe('DezaCatalogRunner (plan 0085)', () => {
  let listing: FakeListing;

  afterEach(async () => {
    await listing?.close();
  });

  it('crawls an uncapped section once and does not split it', async () => {
    listing = await startFakeListing(SECTIONS, [
      {
        description: 'Pan de molde ALTEZA 400 g',
        section: 'W051',
        shops: ['T1'],
      },
      {
        description: 'Croissants ALTEZA 360 g',
        section: 'W051',
        shops: ['T1'],
      },
    ]);
    const { runner, context, report } = build(listing);

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url })
    );

    // Two sections, one query each, and neither narrowed by a term.
    expect(listing.queries).toEqual(['W011|', 'W051|']);
    expect(report.products).toHaveLength(2);
  });

  it('splits a capped section by the most frequent unused term', async () => {
    listing = await startFakeListing(SECTIONS, cappedSection());
    const { runner, context, report } = build(listing);

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url, sectionQueryBudget: 4 })
    );

    const carniceria = listing.queries.filter((query) =>
      query.startsWith('W011|')
    );
    expect(carniceria[0]).toBe('W011|');
    // Every query after the first carries a term drawn from the descriptions the
    // section had already shown, which is the split section 3 describes.
    expect(carniceria.slice(1).every((query) => query !== 'W011|')).toBe(true);
    expect(carniceria).toHaveLength(4);
  });

  it('stops at the budget and names the section with its open queries', async () => {
    listing = await startFakeListing(SECTIONS, cappedSection());
    const { runner, context, report, runReport } = build(listing);

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url, sectionQueryBudget: 3 })
    );

    expect(
      listing.queries.filter((query) => query.startsWith('W011|'))
    ).toHaveLength(3);
    // Nothing pretends the catalog is whole: the section is named, with **every**
    // query that was still at the ceiling when the budget ran out. `producto`
    // appears in all 400 descriptions, so narrowing by it narrows nothing and it
    // is open too.
    expect(runReport['incompleteSections']).toEqual([
      {
        code: 'W011',
        name: 'Carniceria',
        openQueries: ['(the whole section)', 'producto'],
      },
    ]);
  });

  it('writes one entry for a description the listing repeats', async () => {
    // One product filed under two sections comes back in both.
    const repeated = {
      description: 'Perlas de perfume LENOR classic 195 g',
      shops: ['T1'],
    };
    listing = await startFakeListing(SECTIONS, [
      { ...repeated, section: 'W011' },
      { ...repeated, section: 'W051' },
    ]);
    const { runner, context, report } = build(listing);

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url })
    );

    expect(report.products).toHaveLength(1);
    expect(report.products[0].externalId).toBe(
      entryKey('Perlas de perfume LENOR classic', '195 g')
    );
    expect(report.products[0]).toMatchObject({
      name: 'Perlas de perfume LENOR classic',
      sizeFormat: '195 g',
      brand: 'LENOR',
    });
  });

  it('writes no price of any kind', async () => {
    listing = await startFakeListing(SECTIONS, [
      {
        description: 'Pan de molde ALTEZA 400 g',
        section: 'W051',
        shops: ['T1'],
      },
    ]);
    const { runner, context, report } = build(listing);

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url })
    );

    // **It reports no price, ever.** The site prints none, and the blank price
    // elements in its markup are the storefront's own hidden pricing, which a
    // parser reading them would write as zeros. A runner that cannot write is
    // also a runner whose "no price" is one absence rather than two.
    expect(report.products[0].prices).toEqual([]);
    // No EAN either, so the EAN rung of the ladder never fires and every
    // automatic match here is a candidate.
    expect(report.products[0].ean).toBeNull();
  });

  it('claims every shop it met against every product, positive and negative', async () => {
    // **Absence is the claim.** The popup names the shops that carry a product,
    // so a shop it did not name does not stock it, and a run reporting only the
    // positives could say nothing negative at all.
    //
    // Which catalog location each code is, and whether one is mapped yet, is
    // the orchestrator's to resolve (plan 0103, section 6.3). This runner names
    // the source's own code and what the source called it, and nothing else.
    listing = await startFakeListing(SECTIONS, [
      {
        description: 'Producto MARCA0 variante0',
        section: 'W011',
        shops: ['T1'],
      },
      {
        description: 'Otro MARCA1 variante1',
        section: 'W011',
        shops: ['C1'],
      },
    ]);
    const { runner, context, report } = build(listing);

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url })
    );

    const first = report.products[0].externalId;
    const claims = report.availabilities.filter(
      (claim) => claim.externalId === first
    );
    // Two shops were met, so the product carries a claim for each: the one that
    // named it and the one that did not.
    expect(
      claims.map((claim) => [claim.shopCode, claim.available]).sort()
    ).toEqual([
      ['C1', false],
      ['T1', true],
    ]);
    expect(claims.every((claim) => claim.shopName !== null)).toBe(true);
  });

  it('keeps the heartbeat moving while it enumerates', async () => {
    listing = await startFakeListing(SECTIONS, cappedSection());
    const { runner, context, report } = build(listing);

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url, sectionQueryBudget: 3 })
    );

    // A healthy enumeration writes no counter until the stage ends, so the
    // heartbeat is the only thing telling the stale reaper the run is alive.
    // One call per recorded row and one per finished query; the context
    // throttles the actual writes.
    expect(
      (context.heartbeat as jest.Mock).mock.calls.length
    ).toBeGreaterThanOrEqual(300);
  });

  it('puts every request of every worker through the one shared gate', async () => {
    // The rate is one token bucket for the whole run (plan 0038, section 6.3):
    // four workers each pausing is four times the rate the owner set. Each
    // in flight query gets its own client, for the session cookie, so the gate
    // is the only thing they can share and every one of them has to await it.
    listing = await startFakeListing(
      SECTIONS,
      cappedSection().concat(
        Array.from({ length: 40 }, (_, index) => ({
          description: `Bolleria ALTEZA numero${index} ${index} g`,
          section: 'W051',
          shops: ['T1'],
        }))
      )
    );
    const { runner, context, report } = build(listing);
    let acquired = 0;
    (context as { acquire: () => Promise<void> }).acquire = async () => {
      acquired += 1;
    };

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url, sectionQueryBudget: 3 }, 4)
    );

    // Both sections crawled at four workers, over many pages each.
    expect(listing.requests()).toBeGreaterThan(10);
    expect(acquired).toBe(listing.requests());
  });
});
