import type { ConfigService } from '@nestjs/config';
import { HarvestWarningCode } from '@portfolio/luna-shopper/contracts';
import {
  SourceBlockedError,
  SourceGuard,
} from '@portfolio/luna-shopper/source-guard';
import type { SupermarketSource } from '../entities';
import {
  DezaCatalogRunner,
  entryKey,
  heaviestUntried,
  type CappedQuery,
} from './deza-catalog.runner';
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

/** `count` rows of one description, numbered from `from` so each is its own product. */
function rows(description: string, from: number, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    description: `${description} ${from + index} g`,
    section: 'W011',
    shops: ['T1'],
  }));
}

/**
 * A section whose own query sees `leche` and `queso`, and whose `[leche]` is
 * capped with rows that carry `entera` (130) and `fresca` (20). 350 rows
 * carry `leche entera`, so `[entera]` is capped too and carries no word but
 * `leche`.
 *
 * The section's heaviest untried word after `[leche]` is `queso`, and it
 * outweighs every word of `[leche]`'s rows, so `[queso]` is issued third.
 */
function lecheSection() {
  return [
    ...rows('Leche', 0, 150),
    ...rows('Queso', 150, 150),
    ...rows('Leche fresca', 300, 20),
    ...rows('Leche entera', 320, 350),
  ];
}

/**
 * A word of six letters that no other word of the set contains: `termaa`,
 * `termab`, ... The fake matches a term as a substring.
 */
function word(index: number): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  return `term${letters[Math.floor(index / 26)]}${letters[index % 26]}`;
}

/**
 * A capped Carniceria built from groups of words: each word of a group has
 * `visible` rows among the 300 the section's own query shows and `hidden`
 * rows behind the ceiling. Words of one row each, hiding nothing, fill the
 * rest of the 300. Every row carries one word, so a term reaches exactly the
 * rows of its word.
 */
function wordSection(
  groups: Array<{ words: number; visible: number; hidden: number }>
) {
  const shown: ReturnType<typeof rows> = [];
  const hidden: ReturnType<typeof rows> = [];
  let next = 0;
  let id = 0;
  for (const group of groups) {
    for (let index = 0; index < group.words; index += 1) {
      const term = word(next++);
      shown.push(...rows(term, id, group.visible));
      id += group.visible;
      hidden.push(...rows(term, id, group.hidden));
      id += group.hidden;
    }
  }
  while (shown.length < 300) {
    shown.push(...rows(word(next++), id++, 1));
  }
  return [...shown, ...hidden];
}

/**
 * A section that grows fast for three narrowings, by 250 products each, and
 * then by one product a query: `slow` words of three visible rows and one
 * hidden, then `flat` words of two visible rows that hide nothing.
 */
function slowingSection(slow: number, flat: number) {
  return wordSection([
    { words: 3, visible: 10, hidden: 250 },
    { words: slow, visible: 3, hidden: 1 },
    { words: flat, visible: 2, hidden: 0 },
  ]);
}

/** The queries the fake was asked for Carniceria, in order. */
const carniceria = (listing: FakeListing): string[] =>
  listing.queries.filter((query) => query.startsWith('W011|'));

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

describe('heaviestUntried (plan 0258)', () => {
  const query = (vocabulary: Record<string, string[]>): CappedQuery => ({
    terms: [],
    vocabulary: new Map(
      Object.entries(vocabulary).map(([term, keys]) => [term, new Set(keys)])
    ),
    tried: new Set(),
    closed: false,
  });

  it('weighs a word by the products it reaches that were returned least', () => {
    const capped = query({
      // Three products, each returned four times: frequent, and spent.
      tres: ['p3', 'p4', 'p5'],
      // Two products returned once: 1/2 + 1/2.
      dos: ['p1', 'p2'],
      // One returned once, one twice: 1/2 + 1/3.
      otra: ['p6', 'p7'],
    });
    const coverage = new Map([
      ['p1', 1],
      ['p2', 1],
      ['p3', 4],
      ['p4', 4],
      ['p5', 4],
      ['p6', 1],
      ['p7', 2],
    ]);

    expect(heaviestUntried(capped, new Set(), coverage)).toBe('dos');

    // A query returned both of `dos`'s products: 1/3 + 1/3 now weighs less
    // than `otra`.
    coverage.set('p1', 2);
    coverage.set('p2', 2);
    expect(heaviestUntried(capped, new Set(), coverage)).toBe('otra');
  });

  it('offers no word whose every product was returned three times or more', () => {
    const capped = query({ tres: ['p1', 'p2', 'p3'] });
    const coverage = new Map([
      ['p1', 3],
      ['p2', 5],
      ['p3', 3],
    ]);

    expect(heaviestUntried(capped, new Set(), coverage)).toBeNull();
    coverage.set('p2', 2);
    expect(heaviestUntried(capped, new Set(), coverage)).toBe('tres');
  });

  it('breaks a tie by the word with more products, then the word seen first', () => {
    const coverage = new Map([
      ['p1', 1],
      ['p2', 1],
      ['p3', 2],
      ['p4', 2],
      ['p5', 2],
      ['p6', 1],
      ['p7', 1],
    ]);
    // `dos` and `tres` both weigh 1; `tres` reaches more products.
    expect(
      heaviestUntried(
        query({ dos: ['p1', 'p2'], tres: ['p3', 'p4', 'p5'] }),
        new Set(),
        coverage
      )
    ).toBe('tres');
    // `uno` and `otro` are equal in both: the first seen wins.
    expect(
      heaviestUntried(
        query({ uno: ['p1', 'p2'], otro: ['p6', 'p7'] }),
        new Set(),
        coverage
      )
    ).toBe('uno');
  });

  it('skips a word already tried, its own term, and a query already issued', () => {
    const capped: CappedQuery = {
      ...query({
        leche: ['p1'],
        fresca: ['p2'],
        entera: ['p3'],
        light: ['p4'],
      }),
      terms: ['leche'],
      tried: new Set(['fresca']),
    };
    const coverage = new Map([
      ['p1', 1],
      ['p2', 1],
      ['p3', 1],
      ['p4', 1],
    ]);

    expect(heaviestUntried(capped, new Set(['entera leche']), coverage)).toBe(
      'light'
    );
  });
});

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

  it('splits a capped section by the heaviest unused term (plan 0258)', async () => {
    listing = await startFakeListing(SECTIONS, cappedSection());
    const { runner, context, report } = build(listing);

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url })
    );

    const queries = carniceria(listing);
    // Every query after the first carries a term drawn from the descriptions the
    // section had already shown, which is the split section 3 describes.
    // `producto` is carried by all 300 rows the section's own query showed, so
    // it weighs most. `[producto]` is capped, but it returned the same 300
    // rows, so `marca0` weighs the same under it and under the section's own
    // query, and the tie falls to the query with fewer terms (plan 0258,
    // section 2). Under plan 0257 the newest capped query was split first and
    // this was `[producto marca0]`.
    expect(queries.slice(0, 3)).toEqual([
      'W011|',
      'W011|producto',
      'W011|marca0',
    ]);
    expect(queries.slice(1).every((query) => query !== 'W011|')).toBe(true);
  });

  it('stops at the hard cap and names the section, whatever it still adds (plan 0258)', async () => {
    // 150 words, each with two rows shown and two hidden: every narrowing adds
    // two products, so the section never stops growing and only the cap of
    // 100 queries ends it, far past the floor of 25.
    listing = await startFakeListing(
      SECTIONS,
      wordSection([{ words: 150, visible: 2, hidden: 2 }])
    );
    const { runner, context, report, runReport } = build(listing);

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url })
    );

    // Every word weighs the same, so they are taken in the order they were
    // seen, and none twice.
    expect(carniceria(listing)).toEqual([
      'W011|',
      ...Array.from({ length: 99 }, (_, index) => `W011|${word(index)}`),
    ]);
    // Nothing pretends the catalog is whole: the section is named, with what
    // it spent, why it stopped, and where it was still digging (plan 0251).
    expect(runReport['incompleteSections']).toEqual([
      {
        code: 'W011',
        name: 'Carniceria',
        queries: 100,
        stoppedBy: 'BUDGET',
        openQueries: [],
        narrowing: '(the whole section)',
        termsTried: 99,
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
        'Section W011 Carniceria stopped by BUDGET after 100 queries while ' +
        'narrowing (the whole section), 99 terms tried.',
    });
    expect(runReport['sections']).toEqual([
      {
        code: 'W011',
        name: 'Carniceria',
        products: 498,
        firstSeen: 498,
        queries: 100,
        stoppedBy: 'BUDGET',
        // The hidden rows of the 99 words tried, and the shown rows of the 51
        // words never tried: each returned by one query only.
        coverageOnce: 300,
        growthAtStop: 10,
        openQueries: [],
      },
      {
        code: 'W051',
        name: 'Bolleria',
        products: 0,
        firstSeen: 0,
        queries: 1,
        stoppedBy: 'COMPLETE',
        coverageOnce: 0,
        growthAtStop: 0,
        openQueries: [],
      },
    ]);
    // Before the last flush, which is what writes it onto the row.
    expect(
      (context.warn as jest.Mock).mock.invocationCallOrder[0]
    ).toBeLessThan(
      Math.max(...(context.flush as jest.Mock).mock.invocationCallOrder)
    );
  });

  it('ends NO_TERM, not BUDGET, when the query that reaches the cap leaves no term (plan 0258)', async () => {
    // 99 words over the 300 rows the section shows, each hiding one row: the
    // section's own query and its 99 narrowings are exactly the cap, and the
    // last of them leaves no word to offer.
    listing = await startFakeListing(
      SECTIONS,
      wordSection([
        { words: 1, visible: 6, hidden: 1 },
        { words: 98, visible: 3, hidden: 1 },
      ])
    );
    const { runner, context, report, runReport } = build(listing);

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url })
    );

    expect(carniceria(listing)).toHaveLength(100);
    expect(runReport['incompleteSections']).toEqual([
      expect.objectContaining({
        code: 'W011',
        queries: 100,
        stoppedBy: 'NO_TERM',
        termsTried: 99,
      }),
    ]);
  });

  it('goes on past the floor while it grows, and ends GROWTH with no warning when it stops (plan 0258)', async () => {
    listing = await startFakeListing(SECTIONS, slowingSection(10, 0));
    const { runner, context, report, runReport } = build(listing);

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url, sectionQueryBudget: 5 })
    );

    // The floor is five. The sixth to ninth queries are spent because the five
    // before each still added more than one percent of what the section had
    // seen. Before the tenth, the last five had added five products, under
    // one percent of 1,055.
    expect(carniceria(listing)).toEqual([
      'W011|',
      ...Array.from({ length: 8 }, (_, index) => `W011|${word(index)}`),
    ]);
    expect(runReport['sections']).toEqual([
      {
        code: 'W011',
        name: 'Carniceria',
        products: 1055,
        firstSeen: 1055,
        queries: 9,
        stoppedBy: 'GROWTH',
        // The 240 filler rows, the shown rows of the five slow words never
        // tried, and every hidden row found: each returned once.
        coverageOnce: 1010,
        growthAtStop: 5,
        openQueries: [],
      },
      expect.objectContaining({ code: 'W051', stoppedBy: 'COMPLETE' }),
    ]);
    // A section that stopped growing is not a section the run failed to
    // finish (plan 0258, section 4).
    expect(runReport['incompleteSections']).toEqual([]);
    expect(context.warn).not.toHaveBeenCalled();
  });

  it('names the capped queries a GROWTH section left open in sections, and nowhere else (plan 0258)', async () => {
    // `word(0)` has 310 rows, so `[word(0)]` is capped, and its rows carry no
    // word but its own: it is never narrowed. Two fast words then add 250
    // each, and five slow words one each, until the last five added five
    // products, under one percent of 1,095.
    listing = await startFakeListing(
      SECTIONS,
      wordSection([
        { words: 1, visible: 10, hidden: 300 },
        { words: 2, visible: 10, hidden: 250 },
        { words: 10, visible: 3, hidden: 1 },
      ])
    );
    const { runner, context, report, runReport } = build(listing);

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url, sectionQueryBudget: 5 })
    );

    expect(runReport['sections']).toEqual([
      expect.objectContaining({
        code: 'W011',
        queries: 9,
        stoppedBy: 'GROWTH',
        openQueries: [word(0)],
      }),
      expect.objectContaining({ code: 'W051', openQueries: [] }),
    ]);
    // Still not a section the run failed to finish.
    expect(runReport['incompleteSections']).toEqual([]);
    expect(context.warn).not.toHaveBeenCalled();
  });

  it('ends a section BARREN before the growth rule is consulted (plan 0258)', async () => {
    // Two slow words, then flat words that add nothing. With the floor at
    // nine, the ninth query is the third barren pass, and the last five then
    // added two products: the growth rule would say GROWTH, but the barren
    // rule ends the section first.
    listing = await startFakeListing(SECTIONS, slowingSection(2, 3));
    const { runner, context, report, runReport } = build(listing);

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url, sectionQueryBudget: 9 })
    );

    expect(carniceria(listing)).toHaveLength(9);
    expect(runReport['sections']).toEqual([
      expect.objectContaining({
        code: 'W011',
        queries: 9,
        stoppedBy: 'BARREN',
        growthAtStop: 2,
      }),
      expect.objectContaining({ code: 'W051' }),
    ]);
    expect(context.warn).not.toHaveBeenCalled();
  });

  it('goes on past three barren passes under the floor, and ends BARREN at the floor when the last three still added nothing (plan 0258)', async () => {
    // Queries two to four are three words whose rows the section's own query
    // already showed. The fifth reaches 200 hidden rows. The sixth to eighth
    // add nothing again, and the eighth is the floor.
    listing = await startFakeListing(
      SECTIONS,
      wordSection([
        { words: 3, visible: 20, hidden: 0 },
        { words: 1, visible: 10, hidden: 200 },
        { words: 3, visible: 5, hidden: 0 },
      ])
    );
    const { runner, context, report, runReport } = build(listing);

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url, sectionQueryBudget: 8 })
    );

    // Before the fix round the fourth query ended the section, and the 200
    // rows behind `word(3)` were never read.
    expect(carniceria(listing)).toEqual([
      'W011|',
      ...Array.from({ length: 7 }, (_, index) => `W011|${word(index)}`),
    ]);
    expect(runReport['sections']).toEqual([
      expect.objectContaining({
        code: 'W011',
        firstSeen: 500,
        queries: 8,
        stoppedBy: 'BARREN',
      }),
      expect.objectContaining({ code: 'W051' }),
    ]);
    expect(runReport['incompleteSections']).toEqual([]);
  });

  it('goes on under the growth rule when the floor query added something, after three barren passes under it (plan 0258)', async () => {
    // Queries two to four add nothing and the fifth adds 200, as above. From
    // the sixth on each query adds one product, so the barren count never
    // reaches three at or past the floor of six.
    listing = await startFakeListing(
      SECTIONS,
      wordSection([
        { words: 3, visible: 20, hidden: 0 },
        { words: 1, visible: 10, hidden: 200 },
        { words: 8, visible: 4, hidden: 1 },
      ])
    );
    const { runner, context, report, runReport } = build(listing);

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url, sectionQueryBudget: 6 })
    );

    // Before the eleventh, the last five added five products, under one
    // percent of 505.
    expect(carniceria(listing)).toHaveLength(10);
    expect(runReport['sections']).toEqual([
      expect.objectContaining({
        code: 'W011',
        firstSeen: 505,
        queries: 10,
        stoppedBy: 'GROWTH',
        growthAtStop: 5,
      }),
      expect.objectContaining({ code: 'W051' }),
    ]);
  });

  it('never cuts a section below its floor, however little it adds (plan 0258)', async () => {
    // After the three fast words every query adds one product, far under one
    // percent, but the floor of 25 is always spent.
    listing = await startFakeListing(SECTIONS, slowingSection(30, 0));
    const { runner, context, report, runReport } = build(listing);

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url })
    );

    expect(runReport['sections']).toEqual([
      expect.objectContaining({
        code: 'W011',
        queries: 25,
        stoppedBy: 'GROWTH',
      }),
      expect.objectContaining({ code: 'W051' }),
    ]);
  });

  it('narrows by the word that reaches products the section has seen least, not the most frequent (plan 0258)', async () => {
    // `[leche]` returns all 200 leche rows the section's own query showed.
    // After it, `entera` is still the most frequent word the section saw,
    // 240 sightings, but every product it reaches was returned twice. `queso`
    // reaches 100 products returned once, and the 50 behind the ceiling.
    listing = await startFakeListing(SECTIONS, [
      ...rows('Leche entera', 0, 120),
      ...rows('Leche desnatada', 120, 80),
      ...rows('Queso curado', 200, 100),
      ...rows('Queso tierno', 300, 50),
    ]);
    const { runner, context, report } = build(listing);

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url })
    );

    expect(carniceria(listing).slice(0, 3)).toEqual([
      'W011|',
      'W011|leche',
      'W011|queso',
    ]);
    expect(report.products).toHaveLength(350);
  });

  it('counts a product once per query that returned it, also when the result set repeats the row (plan 0258)', async () => {
    const pan = {
      description: 'Pan de molde ALTEZA 400 g',
      section: 'W051',
      shops: ['T1'],
    };
    listing = await startFakeListing(SECTIONS, [
      pan,
      pan,
      {
        description: 'Croissants ALTEZA 360 g',
        section: 'W051',
        shops: ['T1'],
      },
    ]);
    const { runner, context, report, runReport } = build(listing);

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url })
    );

    // Two products, each returned by the one query: a count per row would
    // have covered the bread twice.
    expect(runReport['sections']).toEqual([
      expect.objectContaining({ code: 'W011' }),
      expect.objectContaining({
        code: 'W051',
        products: 2,
        coverageOnce: 2,
      }),
    ]);
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

    expect(runReport['sections']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'W011', stoppedBy: 'NO_TERM' }),
      ])
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
    // Named in `sections` too, with nothing it could not know (plan 0257).
    expect(runReport['sections']).toEqual([
      {
        code: 'W011',
        name: 'Carniceria',
        products: 1,
        firstSeen: 1,
        queries: null,
        stoppedBy: null,
        coverageOnce: null,
        growthAtStop: null,
        openQueries: [],
      },
      {
        code: 'W051',
        name: 'Bolleria',
        products: 0,
        firstSeen: 0,
        queries: 1,
        stoppedBy: 'COMPLETE',
        coverageOnce: 0,
        growthAtStop: 0,
        openQueries: [],
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
    // A finished section is still named in `sections`, with what it took and
    // why it ended (plan 0257). Every row is read by the ninth query, but the
    // barren rule may end a section only once it has spent its floor, so the
    // passes that add nothing go on to the 25th and end it there (plan 0258,
    // fix round). The seven brands are issued as single terms over the
    // section's own query (plan 0258, section 2), so each of the 100 rows
    // behind the ceiling was returned by its brand query alone, and the
    // sixteen barren passes spend one variant word of those rows each: 84
    // are still returned once. Under plan 0257 the brands narrowed
    // `[producto]` and every product was returned more than once.
    expect(runReport['sections']).toEqual([
      {
        code: 'W011',
        name: 'Carniceria',
        products: 400,
        firstSeen: 400,
        queries: 25,
        stoppedBy: 'BARREN',
        coverageOnce: 84,
        growthAtStop: 0,
        openQueries: [],
      },
      {
        code: 'W051',
        name: 'Bolleria',
        products: 0,
        firstSeen: 0,
        queries: 1,
        stoppedBy: 'COMPLETE',
        coverageOnce: 0,
        growthAtStop: 0,
        openQueries: [],
      },
    ]);
  });

  it('narrows the section by its own heaviest word before a capped term by a lighter one (plan 0258)', async () => {
    listing = await startFakeListing(SECTIONS, lecheSection());
    const { runner, context, report, runReport } = build(listing);

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url })
    );

    // `[leche]` returned 300 rows and is capped. Its heaviest word is
    // `entera`, 130 products returned once (65); the section's own is
    // `queso`, 150 products returned once (75), so `[queso]` is issued third.
    // Plan 0257 split the newest capped query first and issued `[leche
    // entera]` here; plan 0258 section 2 withdrew that order because in
    // Color it dug inside one capped child while single terms over the whole
    // section opened up to 300 new rows each. `entera` weighs the same under
    // the section and under `[leche]` next, and the tie falls to the query
    // with fewer terms.
    expect(carniceria(listing).slice(0, 4)).toEqual([
      'W011|',
      'W011|leche',
      'W011|queso',
      'W011|entera',
    ]);
    // Its barren passes come before the floor, so they do not end it: it ends
    // when no capped query has a term left, with 50 rows of `entera` still
    // behind the ceiling (plan 0258, fix round).
    expect(runReport['sections']).toEqual([
      expect.objectContaining({
        code: 'W011',
        firstSeen: 620,
        stoppedBy: 'NO_TERM',
      }),
      expect.objectContaining({ code: 'W051' }),
    ]);
  });

  it('closes a capped query with no word of its own left and narrows another (plan 0257)', async () => {
    listing = await startFakeListing(SECTIONS, lecheSection());
    const { runner, context, report, runReport } = build(listing);

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url })
    );

    // Every open capped query is weighed, the section's own included (plan
    // 0258, section 2; plan 0257 took the newest first). `[queso]` and
    // `[entera]` come from the section, as the case above says. `[entera]` is
    // capped, and its `leche` reaches the 170 products only it returned, so
    // `[entera leche]` is fourth. That one is capped too, but its rows carry
    // no word it does not already have, so it is closed; so is `[entera]`,
    // whose only other word it spent. `[leche entera]` is never issued: it
    // is `[entera leche]` in another order. `fresca` weighs the same under the
    // section and under `[leche]`, and the section, with fewer terms, gives
    // it first; `[leche]` gives it last. The barren passes are under the
    // floor, so they do not end the section (plan 0258, fix round), and it
    // ends when no capped query has a term left.
    expect(carniceria(listing)).toEqual([
      'W011|',
      'W011|leche',
      'W011|queso',
      'W011|entera',
      'W011|entera leche',
      'W011|fresca',
      'W011|leche fresca',
    ]);
    expect(runReport['sections']).toEqual([
      expect.objectContaining({
        code: 'W011',
        queries: 7,
        stoppedBy: 'NO_TERM',
      }),
      expect.objectContaining({ code: 'W051' }),
    ]);
  });

  it('tries a term spent under one query again under another (plan 0257)', async () => {
    // `oferta` is a word of the rows of `[leche]` and of `[queso]` both.
    listing = await startFakeListing(SECTIONS, [
      ...rows('Leche', 0, 160),
      ...rows('Queso', 160, 140),
      ...rows('Leche oferta', 300, 20),
      ...rows('Leche', 320, 180),
      ...rows('Queso oferta', 500, 200),
    ]);
    const { runner, context, report, runReport } = build(listing);

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url })
    );

    // Each capped query keeps its own tried terms, so `oferta`, spent on the
    // section's own query, still narrows `[queso]` and then `[leche]`. Every
    // capped query is weighed at each narrowing (plan 0258, section 2), so
    // the section gives `queso` and `oferta` first, where plan 0257 split the
    // newest capped query first and issued `[leche oferta]` second; `[queso
    // oferta]` reaches 40 products only `[oferta]` returned and outweighs
    // `[leche oferta]`, whose 20 products were all returned twice.
    expect(carniceria(listing)).toEqual([
      'W011|',
      'W011|leche',
      'W011|queso',
      'W011|oferta',
      'W011|queso oferta',
      'W011|leche oferta',
    ]);
    // Every capped query closed, so the section ran out of terms. The last
    // narrowing was taken from `[leche]`.
    expect(runReport['incompleteSections']).toEqual([
      {
        code: 'W011',
        name: 'Carniceria',
        queries: 6,
        stoppedBy: 'NO_TERM',
        openQueries: [],
        narrowing: 'leche',
        termsTried: 1,
      },
    ]);
  });

  it('never issues one query twice, whatever the order of its terms (plan 0257)', async () => {
    // `[leche]`, `[queso]` and `[oferta]` are all capped, and `oferta` is a
    // word of the rows of the first two while `leche` and `queso` are words
    // of the rows of the third. The site reads both orders of two terms as one
    // query, so each pair is issued once, under whichever query weighs it
    // first, and the other query skips it.
    //
    // Since plan 0258 section 2 every open capped query is weighed, so the
    // section gives `queso` and then `oferta` before any capped child is
    // split (plan 0257 split the newest first and issued `[leche oferta]`
    // second). `[queso oferta]` and `[oferta leche]` weigh the same, and the
    // older capped query, `[queso]`, gives its pair first. `[oferta]` then
    // gives `[oferta leche]`, so `[leche]` has no pair of its own left.
    listing = await startFakeListing(SECTIONS, [
      ...rows('Leche', 0, 160),
      ...rows('Queso', 160, 140),
      ...rows('Leche oferta', 300, 160),
      ...rows('Queso oferta', 460, 320),
    ]);
    const { runner, context, report } = build(listing);

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url })
    );

    const queries = carniceria(listing);
    expect(queries).toEqual([
      'W011|',
      'W011|leche',
      'W011|queso',
      'W011|oferta',
      'W011|queso oferta',
      'W011|oferta leche',
    ]);
    const asOne = queries.map((query) =>
      query.split('|')[1].split(' ').sort().join(' ')
    );
    expect(new Set(asOne).size).toBe(queries.length);
  });

  it('narrows the section next while its word outweighs every word of a capped child (plan 0258)', async () => {
    // The section shows 150 `alfa` and 150 `beta` rows. `[alfa]` is capped,
    // and the only word of its rows it has not spent is `gamma`, ten products
    // returned once (5). The section's `beta` reaches 150 products returned
    // once (75), so the section is narrowed next, not the newest capped
    // query. `[beta]` is capped too, with no word of its own left.
    listing = await startFakeListing(SECTIONS, [
      ...rows('Alfa', 0, 150),
      ...rows('Beta', 150, 150),
      ...rows('Alfa gamma', 300, 10),
      ...rows('Alfa', 310, 200),
      ...rows('Beta', 510, 200),
    ]);
    const { runner, context, report } = build(listing);

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url })
    );

    // `gamma` weighs the same under the section and under `[alfa]`, and the
    // tie falls to the query with fewer terms. `[alfa gamma]` is still a new
    // query, its products returned twice and not yet saturated, so `[alfa]`
    // gives it last.
    expect(carniceria(listing)).toEqual([
      'W011|',
      'W011|alfa',
      'W011|beta',
      'W011|gamma',
      'W011|alfa gamma',
    ]);
  });

  it('narrows a capped child once the words of the section are spent (plan 0258)', async () => {
    // 100 `alfa`, 100 `beta` and 100 `alfa beta` rows shown, 300 more `alfa
    // beta` behind the ceiling. The section gives `alfa` and then `beta`, the
    // heavier word each time, and has no word left after them. `[alfa]` is
    // capped and has not tried `beta`, and 100 of the products `beta` reaches
    // under it were returned twice only, so the narrowing moves into it.
    listing = await startFakeListing(SECTIONS, [
      ...rows('Alfa', 0, 100),
      ...rows('Beta', 100, 100),
      ...rows('Alfa beta', 200, 400),
    ]);
    const { runner, context, report, runReport } = build(listing);

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url })
    );

    // `[beta alfa]` is the same query, so `[beta]` closes unnarrowed.
    expect(carniceria(listing)).toEqual([
      'W011|',
      'W011|alfa',
      'W011|beta',
      'W011|alfa beta',
    ]);
    expect(runReport['incompleteSections']).toEqual([
      expect.objectContaining({
        code: 'W011',
        stoppedBy: 'NO_TERM',
        narrowing: 'alfa',
        termsTried: 1,
      }),
    ]);
  });

  it('keeps the section open while it has nothing, and narrows it by a word a capped child brought in (plan 0258)', async () => {
    // The section shows 150 `alfa` and 150 `beta` rows. `[alfa]` and `[beta]`
    // are capped, each with 50 `alfa beta` rows, and after them the section
    // has no word left. `[alfa]` gives `[alfa beta]`, which is capped and
    // returns the first `gamma` rows anyone has seen. `gamma` weighs the same
    // under the section and under `[alfa beta]`, and the section, with fewer
    // terms, gives it. Before this fix round the section was closed when it
    // had nothing, so the fifth query was `[alfa beta gamma]` and the section
    // never offered `gamma` at all.
    listing = await startFakeListing(SECTIONS, [
      ...rows('Alfa', 0, 150),
      ...rows('Beta', 150, 150),
      ...rows('Alfa', 300, 100),
      ...rows('Beta', 400, 100),
      ...rows('Alfa beta', 500, 100),
      ...rows('Alfa beta gamma', 600, 50),
      ...rows('Alfa beta', 650, 250),
    ]);
    const { runner, context, report } = build(listing);

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url })
    );

    expect(carniceria(listing).slice(0, 5)).toEqual([
      'W011|',
      'W011|alfa',
      'W011|beta',
      'W011|alfa beta',
      'W011|gamma',
    ]);
  });

  it('ends a section barren on what its own queries add, whatever another section adds meanwhile (plan 0257)', async () => {
    // Carniceria shows exactly 300 rows, at the ceiling with nothing behind
    // it, in four words of 75 rows each, so every narrowing of it returns rows
    // the section already showed. Bolleria, crawled by the second worker at the
    // same time, adds 85 products with each of its twenty narrowings. A test of
    // the run's product count saw Bolleria's products land during Carniceria's
    // queries and never counted a barren pass.
    //
    // The floor is four, so the third barren pass reaches it: the barren rule
    // acts only from the floor on (plan 0258, fix round).
    //
    // The section was 301 `Pollo asado` rows before plan 0258. Under the
    // weight both words saturate after the third query, so the section would
    // end `NO_TERM` and no longer prove the barren point; four words of 75
    // rows each give the three barren passes the case needs.
    const words = [
      'alfa',
      'beta',
      'gamma',
      'delta',
      'epsilon',
      'zeta',
      'theta',
      'iota',
      'kappa',
      'lambda',
      'sigma',
      'omega',
      'tango',
      'fresa',
      'limon',
      'melon',
      'nuez',
      'pera',
      'kiwi',
      'mango',
    ];
    listing = await startFakeListing(SECTIONS, [
      ...rows('Pollo', 0, 75),
      ...rows('Asado', 75, 75),
      ...rows('Pavo', 150, 75),
      ...rows('Conejo', 225, 75),
      ...Array.from({ length: 2000 }, (_, index) => ({
        description: `${words[index % words.length]} ${index} g`,
        section: 'W051',
        shops: ['T1'],
      })),
    ]);
    const { runner, context, report, runReport } = build(listing);

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url, sectionQueryBudget: 4 }, 2)
    );

    // The section's own query, then three narrowings that added nothing.
    expect(carniceria(listing)).toEqual([
      'W011|',
      'W011|pollo',
      'W011|asado',
      'W011|pavo',
    ]);
    expect(runReport['sections']).toEqual([
      expect.objectContaining({
        code: 'W011',
        firstSeen: 300,
        queries: 4,
        stoppedBy: 'BARREN',
      }),
      expect.objectContaining({
        code: 'W051',
        firstSeen: 2000,
        queries: 21,
        stoppedBy: 'NO_TERM',
      }),
    ]);
    // Bolleria really was adding while Carniceria spent its barren passes.
    const during = listing.queries.slice(
      listing.queries.indexOf('W011|pollo'),
      listing.queries.indexOf('W011|pavo')
    );
    expect(during.some((query) => query.startsWith('W051|'))).toBe(true);
  });

  it('counts a product under the section that saw it first, so firstSeen adds up (plan 0257)', async () => {
    const repeated = {
      description: 'Perlas de perfume LENOR classic 195 g',
      shops: ['T1'],
    };
    listing = await startFakeListing(SECTIONS, [
      { ...repeated, section: 'W011' },
      { ...repeated, section: 'W051' },
      {
        description: 'Croissants ALTEZA 360 g',
        section: 'W051',
        shops: ['T1'],
      },
    ]);
    const { runner, context, report, runReport } = build(listing);

    await runner.run(
      context,
      report,
      { supermarketId: CHAIN },
      source({ baseUrl: listing.url })
    );

    // `products` counts the repeat under both sections; `firstSeen` under
    // the first only, so its sum is the run's product count.
    expect(runReport['sections']).toEqual([
      expect.objectContaining({ code: 'W011', products: 1, firstSeen: 1 }),
      expect.objectContaining({ code: 'W051', products: 2, firstSeen: 1 }),
    ]);
    expect(runReport['products']).toBe(2);
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
