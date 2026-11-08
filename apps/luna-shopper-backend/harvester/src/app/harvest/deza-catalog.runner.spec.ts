import type { ConfigService } from '@nestjs/config';
import { HarvestWarningCode } from '@portfolio/luna-shopper/contracts';
import {
  SourceBlockedError,
  SourceGuard,
} from '@portfolio/luna-shopper/source-guard';
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
    warn: jest.fn(),
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
    // Nothing pretends the catalog is whole: the section is named, with what
    // it spent, why it stopped, and every capped query no narrowing was taken
    // from (plan 0251). `producto` appears in all 400 descriptions, so
    // narrowing by it narrows nothing and it is open. The section's own query
    // was narrowed twice, so it is not: it is where the section was still
    // digging when the budget ran out, with the two terms it spent.
    expect(runReport['incompleteSections']).toEqual([
      {
        code: 'W011',
        name: 'Carniceria',
        queries: 3,
        stoppedBy: 'BUDGET',
        openQueries: ['producto'],
        narrowing: '(the whole section)',
        termsTried: 2,
      },
    ]);
    // And the run row says so, before the run ends.
    expect(context.warn).toHaveBeenCalledTimes(1);
    expect(context.warn).toHaveBeenCalledWith({
      code: HarvestWarningCode.LISTING_UNREAD,
      name: 'Carniceria',
      offerId: null,
      page: null,
      message:
        'Section W011 Carniceria stopped by BUDGET after 3 queries while ' +
        'narrowing (the whole section), 2 terms tried, still capped: ' +
        'producto.',
    });
    // Before the last flush, which is what writes it onto the row.
    expect(
      (context.warn as jest.Mock).mock.invocationCallOrder[0]
    ).toBeLessThan(
      Math.max(...(context.flush as jest.Mock).mock.invocationCallOrder)
    );
  });

  it('names a capped section with no term left to narrow it by (plan 0251)', async () => {
    // Every description is one word, too short to narrow by, so the section's
    // own query is capped and nothing can split it.
    listing = await startFakeListing(
      SECTIONS,
      Array.from({ length: 400 }, (_, index) => ({
        description: `Sal ${index} g`,
        section: 'W011',
        shops: ['T1'],
      }))
    );
    const { runner, context, report, runReport } = build(listing);

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url })
    );

    // Never narrowed, so the whole section is the open query.
    expect(runReport['incompleteSections']).toEqual([
      {
        code: 'W011',
        name: 'Carniceria',
        queries: 1,
        stoppedBy: 'NO_TERM',
        openQueries: ['(the whole section)'],
        narrowing: null,
        termsTried: 0,
      },
    ]);
    expect(context.warn).toHaveBeenCalledWith({
      code: HarvestWarningCode.LISTING_UNREAD,
      name: 'Carniceria',
      offerId: null,
      page: null,
      message:
        'Section W011 Carniceria stopped by NO_TERM after 1 query, still ' +
        'capped: (the whole section).',
    });
  });

  it('names where a section was still digging when it ran out of terms (plan 0251)', async () => {
    // The section's own query is capped and narrows by `producto`, which
    // every row carries, so that query is capped too. `producto` is the only
    // word long enough to narrow by, so after it no term is left for either.
    listing = await startFakeListing(
      SECTIONS,
      Array.from({ length: 400 }, (_, index) => ({
        description: `Producto ${index} g`,
        section: 'W011',
        shops: ['T1'],
      }))
    );
    const { runner, context, report, runReport } = build(listing);

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url })
    );

    expect(runReport['incompleteSections']).toEqual([
      {
        code: 'W011',
        name: 'Carniceria',
        queries: 2,
        stoppedBy: 'NO_TERM',
        openQueries: ['producto'],
        narrowing: '(the whole section)',
        termsTried: 1,
      },
    ]);
    expect(context.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Section W011 Carniceria stopped by NO_TERM after 2 queries while ' +
          'narrowing (the whole section), 1 term tried, still capped: ' +
          'producto.',
      })
    );
  });

  it('names a section that threw, with no count and no stop (plan 0251)', async () => {
    listing = await startFakeListing(SECTIONS, [
      {
        description: 'Pan de molde ALTEZA 400 g',
        section: 'W011',
        shops: ['T1'],
      },
    ]);
    const { runner, context, report, runReport } = build(listing);
    // The first heartbeat, on Carniceria's first row, fails the section.
    (context.heartbeat as jest.Mock).mockRejectedValueOnce(new Error('boom'));

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url })
    );

    expect(runReport['incompleteSections']).toEqual([
      {
        code: 'W011',
        name: 'Carniceria',
        queries: null,
        stoppedBy: null,
        openQueries: ['Error: boom'],
        narrowing: null,
        termsTried: null,
      },
    ]);
    expect(context.warn).toHaveBeenCalledTimes(1);
    expect(context.warn).toHaveBeenCalledWith({
      code: HarvestWarningCode.LISTING_UNREAD,
      name: 'Carniceria',
      offerId: null,
      page: null,
      message: 'Section W011 Carniceria failed: Error: boom',
    });
  });

  it('writes nothing for a section whose split ended barren (plan 0251)', async () => {
    // With room to narrow, the brand terms cover all 400 rows and three
    // passes in a row then add nothing: the stop rule of plan 0085 working,
    // which is a finished section and not an unfinished one.
    listing = await startFakeListing(SECTIONS, cappedSection());
    const { runner, context, report, runReport } = build(listing);

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url })
    );

    expect(report.products).toHaveLength(400);
    expect(runReport['incompleteSections']).toEqual([]);
    expect(context.warn).not.toHaveBeenCalled();
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
      // The listing prints badges and no product photo (plan 0198).
      imageUrl: null,
    });
  });

  it('writes the size its own parser reads, with the unit it is in (plan 0177)', async () => {
    // The runner used to write `unitSize: null` for every row, whatever the
    // description printed.
    listing = await startFakeListing(SECTIONS, [
      {
        description: 'Cava rosé CODORNIU cuvée original 75 cl',
        section: 'W011',
        shops: ['T1'],
      },
      {
        description: 'Refresco de naranja ALTEZA 1.5 L',
        section: 'W011',
        shops: ['T1'],
      },
      {
        description: 'Arroz redondo ALTEZA 1 Kg',
        section: 'W011',
        shops: ['T1'],
      },
      {
        description: 'Café con leche DOLCE GUSTO 16 ud',
        section: 'W011',
        shops: ['T1'],
      },
      {
        description: 'Detergente en polvo COLON 44+6 lavados',
        section: 'W011',
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

    const sizes = Object.fromEntries(
      report.products.map((product) => [
        product.sizeFormat,
        [product.unitSize, product.sizeUnit],
      ])
    );
    expect(sizes).toEqual({
      // Centilitres are written as millilitres, and the text stays as printed.
      '75 cl': [750, 'MILLILITER'],
      '1.5 L': [1.5, 'LITER'],
      '1 Kg': [1, 'KILOGRAM'],
      '16 ud': [16, 'UNIT'],
      // A sum states no size: the chain did not say what the arithmetic is.
      '44+6 lavados': [null, null],
    });
    // The key is the name and the printed size, exactly as it was.
    expect(report.products.map((product) => product.externalId)).toContain(
      entryKey('Cava rosé CODORNIU cuvée original', '75 cl')
    );
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

  it('states availability only for the products it saw when the guard stops it (plan 0215)', async () => {
    listing = await startFakeListing(SECTIONS, cappedSection());
    const { runner, context, report } = build(listing);
    // The run's guard, wired as the executor wires it, stopped by a refusal
    // after a few pages: the source answers no status this fake can refuse
    // with, so the refusal is told to the guard the way a client tells it.
    const controller = new AbortController();
    const guard = new SourceGuard(
      { consecutive: 1, window: null, coolDowns: 0, coolDownMs: 0, probes: 0 },
      { onStop: (stop) => controller.abort(new SourceBlockedError(stop)) }
    );
    let admitted = 0;
    Object.assign(context, {
      signal: controller.signal,
      guard,
      acquire: async () => {
        await guard.admit(controller.signal);
        admitted += 1;
        if (admitted === 4) {
          try {
            guard.refused(403, `${listing.url}/productos/`);
          } catch {
            // The stop is the guard's, and every client of the run meets it.
          }
        }
      },
    });

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url, sectionQueryBudget: 3 })
    );

    expect(controller.signal.aborted).toBe(true);
    expect(report.products.length).toBeGreaterThan(0);
    expect(report.products.length).toBeLessThan(400);
    // Every claim, positive or negative, is about a product the crawl saw:
    // its popup named the shops that carry it.
    const seen = new Set(report.products.map((product) => product.externalId));
    expect(report.availabilities.length).toBeGreaterThan(0);
    expect(
      report.availabilities.every((claim) => seen.has(claim.externalId))
    ).toBe(true);
    // No request went out after the stop, the one it cut off included.
    expect(listing.requests()).toBe(3);
  });
});
