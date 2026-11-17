import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HarvestWarningCode,
  type SourceSizeUnit,
} from '@portfolio/luna-shopper/contracts';
import {
  DEZA_CEILING_PAGES,
  DezaClient,
  leafSections,
  type DezaProductRow,
  type DezaQuery,
  type DezaSection,
} from '@portfolio/luna-shopper/deza';
import type { HarvesterConfig } from '../config/app-config';
import type { SupermarketSource } from '../entities';
import { runWorkerPool } from '../runner/worker-pool';
import type { CatalogDiscoveryInput, CatalogRunner } from './catalog-runner';
import { entryKey, normalizeName } from './matching';
import { listingWarning, type RunContext } from './run-context';
import type { RunReport } from './run-report';

/**
 * The identity of a DEZA product, which is the identity of any product from a
 * source with no id of its own (plan 0085, section 6; plan 0086, D2).
 *
 * Re-exported here because this is where it was born and where its reasoning is
 * written down. It lives in `matching.ts` now, because a file import keys a
 * nameless product exactly the same way and rung 4 reads the unhashed half.
 */
export { entryKey } from './matching';

/**
 * `CATALOG_DISCOVERY` against the `deza-web` adapter (plan 0085).
 *
 * **It writes no price.** The site prints none. What a run produces is candidate
 * products for review and, for every shop the listing names, whether that shop
 * carries each product. Every one of those claims is kept (plan 0182), and it
 * reaches catalog when its product is bound and its shop is mapped, whichever
 * comes last.
 *
 * The order (section 9):
 *
 * 1. Read the section tree.
 * 2. Enumerate, section by section, under the ceiling rules and the budget.
 * 3. Hand every product to {@link SourceIngest} as an observation with no price,
 *    which upserts `source_catalog_entries` and runs the one ladder over it.
 *    **The EAN rung never fires here**, because the site has no EAN, so every
 *    automatic match is a `CANDIDATE` and none of them writes anything a shopper
 *    reads.
 * 4. Read back which catalog item each product resolved to, from the outcomes.
 * 5. Resolve the shop codes through `source_locations` (plan 0084, section 6),
 *    and store a claim for every product at every shop, positive **and**
 *    negative, in `source_entry_availability` (plan 0182).
 * 6. Call `supermarketLocationItem.setAvailability` once per mapped shop, with
 *    the stored claims of the products that are bound. The rest wait in the
 *    table for a binding or a mapping, and are sent when it happens.
 *
 * Step 3 is what makes an aborted run cheap to resume, exactly as plan 0038
 * section 6.3 describes: the snapshot is already the answer.
 *
 * **A capped section is narrowed where the weight is highest, root or child**
 * (plan 0258, section 2). Every query of the section that came back at the
 * ceiling stays open, the section's own query included, and each narrowing
 * weighs the untried words of all of them and issues the heaviest pair of
 * query and word. Plan 0257 narrowed the newest capped query first, and in
 * Color that dug inside one capped child with term queries that added nothing
 * while single brand terms over the whole section each opened up to 300 new
 * rows. The root's vocabulary holds every row the section showed, so its words
 * weigh most while they still reach products few queries returned, and the
 * narrowing moves into a child once they are spent.
 */
@Injectable()
export class DezaCatalogRunner implements CatalogRunner {
  private readonly logger = new Logger(DezaCatalogRunner.name);

  constructor(private readonly config: ConfigService) {}

  async run(
    context: RunContext,
    report: RunReport,
    input: CatalogDiscoveryInput,
    source: SupermarketSource
  ): Promise<void> {
    const settings = this.config.getOrThrow<HarvesterConfig>('harvester');
    const client = (): DezaClient =>
      new DezaClient({
        baseUrl: readBaseUrl(source.config),
        userAgent: settings.userAgent,
        // The run's own token bucket, shared by every worker and every query,
        // so the rate the owner set on this row is the rate the source sees.
        acquire: context.acquire,
        // The run's one refusal guard (plan 0215), for the same reason: a
        // count kept by a client of one query would start at zero each time.
        guard: context.guard,
        signal: context.signal,
      });

    // --- 1. The section tree ----------------------------------------------
    await context.setStage('SECTIONS', 'Reading the section tree');
    const sections = leafSections(await client().fetchSectionTree());
    this.logger.log(
      `Run ${context.runId}: ${sections.length} section(s) to enumerate`
    );

    // --- 2. Enumeration ---------------------------------------------------
    await context.setStage(
      'ENUMERATE',
      `Enumerating ${sections.length} section(s)`
    );
    const crawl = new Crawl(readBudget(source.config));
    await runWorkerPool({
      items: sections,
      workers: source.workers,
      signal: context.signal,
      handle: (section) =>
        this.enumerateSection(context, crawl, client, section),
      onError: async (error, section) => {
        // A section that fails does not fail the run. It is counted, logged, and
        // named in the report as unfinished, which is the same thing the budget
        // running out produces and reads the same way to an operator.
        this.logger.warn(
          `Run ${context.runId}: section ${section.code} (${section.name}) ` +
            `failed: ${String(error)}`
        );
        crawl.unfinished(section, [String(error)]);
        await context.report({ failed: 1 });
      },
    });
    // A section the run could not finish is a part of the listing it cannot
    // speak for, and the run row says so (plan 0251). An aborted crawl writes
    // none: it does not end `COMPLETED`, and every section the abort cut
    // short would read as unfinished.
    if (!context.signal.aborted) {
      for (const section of crawl.incompleteSections) {
        context.warn(unfinishedWarning(section));
      }
    }
    await context.setTotalPlanned(crawl.products.size);

    // --- 3 and 4. The products this crawl saw ------------------------------
    await context.setStage(
      'SNAPSHOT',
      `Writing ${crawl.products.size} product(s)`
    );
    this.reportProducts(report, crawl);

    // --- 5 and 6. The shops, and what each carries ------------------------
    //
    // **Absence is the claim.** The popup names the shops that carry a product,
    // so a shop it did not name does not stock it, and a run that reported only
    // the positives could say nothing negative at all.
    //
    // The codes are the source's own. Which catalog location each one is stays
    // a person's decision, resolved by the orchestrator through the queue that
    // holds it (plan 0103, section 6.3). An unmapped shop is named and never
    // guessed, and its claims are kept until somebody maps it (plan 0182).
    await context.setStage('AVAILABILITY', 'Reading what each shop carries');
    this.reportAvailability(report, crawl);

    await context.flush();
    await context.setReport(crawl.toReport());
  }

  /**
   * Steps 3 and 4: every product this crawl saw.
   *
   * **It reports no price, ever.** The site prints none, and the blank price
   * elements in its markup are the storefront's own hidden pricing, which a
   * parser reading them would write as zeros.
   *
   * It states no completeness either. Every query answers at most 300 rows
   * however it is filtered, so a section the budget could not finish is a
   * section this run cannot speak for, and `harvest_runs.report` names each one
   * rather than a number claiming otherwise (plan 0085).
   */
  private reportProducts(report: RunReport, crawl: Crawl): void {
    const observedAt = new Date();
    for (const [externalId, product] of crawl.products) {
      report.product({
        externalId,
        name: product.name,
        brand: product.brand,
        // The site states neither, and a field invented here is a field that
        // joins two different products in the one place chains meet.
        ean: null,
        // The size the adapter's own parser read out of the printed text
        // (plan 0177). The runner used to write null here whatever the row
        // printed, so the format gate never ran for a DEZA row.
        unitSize: product.unitSize,
        sizeUnit: product.sizeUnit,
        approxWeight: product.approxWeight,
        sizeFormat: product.sizeFormat,
        packCount: product.packCount,
        categoryPath: product.categoryPath,
        // There is no per product URL on this site; the listing is the page.
        url: null,
        // The listing prints badges and no product photo (plan 0198).
        imageUrl: null,
        observedAt,
        extra: null,
        prices: [],
      });
    }
  }

  /** Every shop the crawl met, and whether each carries each product. */
  private reportAvailability(report: RunReport, crawl: Crawl): void {
    for (const [shopCode, printedName] of crawl.shops) {
      for (const [externalId, product] of crawl.products) {
        report.availability({
          externalId,
          shopCode,
          shopName: printedName,
          available: product.shops.has(shopCode),
        });
      }
    }
  }

  /**
   * One section, crawled and then narrowed until it is complete, exhausted,
   * barren past its floor, no longer growing past its floor, or at the hard cap
   * (plan 0085, section 3; plan 0258).
   *
   * **Under the floor only `COMPLETE` and `NO_TERM` end a section.** The floor
   * is what the owner said a section may always spend, and the barren rule is
   * no exception to it. Under a capped child query the next terms are words of
   * that query's own rows, and each returns a subset of rows mostly read
   * already: three of them in a row can add nothing while rows behind the
   * ceiling are still unread. Before this rule, Color ended `BARREN` after 11
   * queries with over a thousand of its rows unread, and KIOSCO after 15 with
   * two hundred.
   *
   * Each query gets **its own client**, because the chain holds the selected
   * section in a PHP session cookie and two queries sharing a jar would move
   * each other's selection between pages (section 2). What the workers share is
   * the token bucket, which is the thing that has to be shared.
   */
  private async enumerateSection(
    context: RunContext,
    crawl: Crawl,
    client: () => DezaClient,
    section: DezaSection
  ): Promise<void> {
    const state = crawl.begin(section);
    let stoppedBy: SectionStop;

    for (;;) {
      // The section's own query first, then the narrowings. A narrowing is
      // drawn before any stop is asked, so a section with no term left says
      // `NO_TERM` whether or not it also reached the cap or stopped growing.
      let narrowing: Narrowing | null = null;
      if (state.queries > 0) {
        narrowing = state.narrow();
        if (!narrowing) {
          // A section whose own query fit under the ceiling was read whole and
          // had nothing to narrow. One with a capped query left every capped
          // query with no term of its own untried.
          stoppedBy = state.capped.length === 0 ? 'COMPLETE' : 'NO_TERM';
          break;
        }
      }
      // The hard cap bounds every section, whatever it still adds (plan 0258,
      // D1). `BUDGET` means a term was found and the cap left no query for it.
      if (state.queries >= crawl.cap) {
        stoppedBy = 'BUDGET';
        break;
      }
      // Past the floor a section goes on only while it grows (plan 0258,
      // section 3).
      if (state.queries >= crawl.floor && !state.growing()) {
        stoppedBy = 'GROWTH';
        break;
      }
      // Only a narrowing that is issued counts as tried, so a term drawn for a
      // query a stop above refused leaves the report as it was.
      const terms = narrowing ? state.take(narrowing) : [];
      state.queries += 1;

      const { capped, added, returned, vocabulary } = await this.crawlQuery(
        context,
        crawl,
        client(),
        section,
        terms
      );
      // The whole enumeration writes no counter while it is healthy, so without
      // this the heartbeat sits at the stage change until the stage ends, and a
      // twenty minute crawl reads as a stopped run to the stale reaper. Per row
      // covers a query that returns products; this covers one that returns none.
      await context.heartbeat();
      state.observe(returned, added);
      if (capped) {
        state.capture(terms, vocabulary);
      }
      // A pass that adds nothing new is where a term based cover stops paying:
      // the remaining vocabulary is describing products already seen, and the
      // budget is better left unspent than spent proving it again.
      //
      // **What this query added, not what the run grew by.** The pool crawls
      // `source.workers` sections at once, and they share `crawl.products`. A
      // test of the run's product count before and after this query counted
      // every product another section recorded meanwhile, so a section that had
      // stopped growing was reset to zero barren passes by its neighbours and
      // spent its whole budget, ending `BUDGET` with nothing left to find.
      //
      // **Only from the floor on.** Under it the barren passes still count, so
      // a section whose last three queries under the floor added nothing ends
      // `BARREN` on the query that reaches the floor, and one whose floor query
      // added something goes on under the growth rule. It is tested here,
      // after the query, so it ends a section before the growth rule at the
      // top of the loop is consulted.
      if (added === 0) {
        state.barren += 1;
        if (state.barren >= BARREN_QUERIES && state.queries >= crawl.floor) {
          stoppedBy = 'BARREN';
          break;
        }
      } else {
        state.barren = 0;
      }
    }

    state.finish(stoppedBy);
  }

  /**
   * One query, every page of it, recorded. Answers whether it hit the ceiling,
   * how many of its rows were new to the run, the products it returned, and
   * the vocabulary of the rows it returned: the only terms that can reach the
   * rows hidden behind its ceiling are terms those rows carry (plan 0257).
   *
   * `returned` is a set because the listing repeats rows inside one result
   * set, and a product counts once for each query that returned it (plan 0258,
   * section 1).
   */
  private async crawlQuery(
    context: RunContext,
    crawl: Crawl,
    client: DezaClient,
    section: DezaSection,
    terms: string[]
  ): Promise<{
    capped: boolean;
    added: number;
    returned: Set<string>;
    vocabulary: Vocabulary;
  }> {
    const query: DezaQuery = { section: section.code, terms };
    const vocabulary: Vocabulary = new Map();
    const returned = new Set<string>();
    let lastPage = 0;
    let added = 0;
    for await (const row of client.walkQuery(query, (page) => {
      lastPage = Math.max(lastPage, page.lastPage);
    })) {
      const recorded = crawl.record(section, row);
      if (recorded.added) {
        added += 1;
      }
      returned.add(recorded.key);
      learn(vocabulary, row.name, recorded.key);
      await context.heartbeat();
    }
    return {
      capped: lastPage >= DEZA_CEILING_PAGES,
      added,
      returned,
      vocabulary,
    };
  }
}

/**
 * How many queries a capped section may always spend, **the owner's number**:
 * the floor neither the growth rule nor the barren rule cuts below (plan 0258,
 * section 3). Under it a section ends only when it is complete or has no term
 * left.
 * `config.sectionQueryBudget` on the source row overrides it.
 *
 * It was the whole budget before plan 0258, and bounded a run at roughly
 * `34 + 28 * 25` queries of a few pages each (plan 0085, section 3).
 */
const DEFAULT_SECTION_BUDGET = 25;

/**
 * The most queries any section spends, whatever it still adds (plan 0258, D1).
 * About 2,000 pages at the ceiling for one section in the worst case. A floor
 * set above it on the source row is held to it.
 */
const SECTION_QUERY_CAP = 100;

/**
 * Consecutive queries adding nothing new before a section gives up, **once it
 * has spent its floor**. Under a capped child query three term queries in a
 * row can add nothing with rows still unread behind the ceiling, so the count
 * is kept under the floor and acted on only from it.
 */
const BARREN_QUERIES = 3;

/**
 * Past the floor, a section goes on while its last {@link GROWTH_WINDOW}
 * queries together added at least {@link GROWTH_SHARE} of its `firstSeen`
 * so far, and at least one product (plan 0258, D2).
 */
const GROWTH_WINDOW = 5;
const GROWTH_SHARE = 0.01;

/**
 * A word whose every product the section has returned this many times or more
 * is not offered as a term: it can only reach rows already read (plan 0258,
 * section 2).
 */
const SATURATED_COVERAGE = 3;

/** Two weights closer than this are a tie: they are sums of fractions. */
const WEIGHT_EPSILON = 1e-9;

/** A word short enough to be noise is not a useful narrowing term. */
const MIN_TERM_LENGTH = 4;

/**
 * Word -> the `entryKey`s of the products that carry it, among the rows a query
 * returned (plan 0258, section 2). A set, so a repeated row is one product.
 */
type Vocabulary = Map<string, Set<string>>;

interface CrawledProduct {
  name: string;
  sizeFormat: string | null;
  /** The number the size states and the unit it is in (plan 0177). */
  unitSize: number | null;
  sizeUnit: SourceSizeUnit | null;
  /** Grams of a size printed with `aprox`, null beside a size (plan 0266). */
  approxWeight: number | null;
  /** Read from the description by the adapter (plan 0162). */
  packCount: number | null;
  brand: string | null;
  categoryPath: string[];
  /** The codes of the shops that carry it. Absence is the negative claim. */
  shops: Set<string>;
}

/**
 * Why a section's enumeration stopped (plan 0251, section 2).
 *
 * - `BUDGET`: it reached the hard cap, {@link SECTION_QUERY_CAP} queries
 *   (plan 0258), with a term still found to narrow a capped query by. A
 *   section whose last query left no term at the cap ends `NO_TERM`.
 * - `BARREN`: at or past the floor, three passes in a row added nothing new.
 *   That is the stop rule of plan 0085 working, and the section is not
 *   reported as unfinished.
 * - `GROWTH`: past the floor, its last five queries added under one percent
 *   of its `firstSeen` (plan 0258, section 3). The source has shown it as far
 *   as this method reaches, and it is not reported as unfinished either.
 * - `NO_TERM`: every capped query is closed: none has a term of its own left
 *   to narrow it by (plan 0257).
 * - `COMPLETE`: the section's own query fit under the ceiling, so it was read
 *   whole and nothing was narrowed. Only the `sections` list names it.
 */
type SectionStop = 'BUDGET' | 'BARREN' | 'GROWTH' | 'NO_TERM' | 'COMPLETE';

/** A section the run could not finish, as `incompleteSections` names it. */
interface IncompleteSection {
  code: string;
  name: string;
  /**
   * Queries spent on it, the section's own first. Null for a section that
   * threw, where the count is not known.
   */
  queries: number | null;
  /** Null for a section that threw: `openQueries` then holds the error. */
  stoppedBy: Exclude<SectionStop, 'BARREN' | 'GROWTH' | 'COMPLETE'> | null;
  /** The capped queries that were never narrowed. */
  openQueries: string[];
  /**
   * The capped query the last narrowing was taken from: where the section
   * was still digging when it stopped. `openQueries` cannot say it, because a
   * query leaves it at its first narrowing, so a section that spent its
   * budget while every pass still added products names no open query at all.
   * Null when nothing was narrowed, and for a section that threw.
   */
  narrowing: string | null;
  /**
   * The terms spent narrowing {@link narrowing}. Zero when nothing was
   * narrowed, null for a section that threw.
   */
  termsTried: number | null;
}

/**
 * Every section the run began, finished or not, as `sections` names it (plan
 * 0257, section 2): what each one took and why it ended, which is the number
 * the owner sets the budget from.
 */
interface SectionSummary {
  code: string;
  name: string;
  /**
   * Distinct products recorded under this section, repeats of another
   * included. A product filed under two sections counts in both, so this does
   * **not** add up to the run's product count. {@link firstSeen} does.
   */
  products: number;
  /**
   * The products that were new to the run when this section recorded them.
   * Each product is first seen by exactly one section, so the sum over
   * `sections` is the run's product count.
   */
  firstSeen: number;
  /** Null for a section that threw, as in `incompleteSections`. */
  queries: number | null;
  stoppedBy: SectionStop | null;
  /**
   * Products the section returned by exactly one query: the ones the next term
   * would be drawn from (plan 0258, section 4). Null for a section that threw.
   */
  coverageOnce: number | null;
  /**
   * What the section's last five queries added to the run when it stopped,
   * the number the growth rule read. Null for a section that threw.
   */
  growthAtStop: number | null;
  /**
   * For a `GROWTH` section, the capped queries never narrowed, rendered as
   * `incompleteSections` renders them. Such a section is not reported as
   * unfinished, so this is the one place that names what was still at the
   * ceiling when it stopped (plan 0258, section 4). Empty for every other
   * section.
   */
  openQueries: string[];
}

/**
 * A query that came back at the ceiling, and what it can still be narrowed by
 * (plan 0257, section 1).
 */
export interface CappedQuery {
  terms: string[];
  /**
   * The words of the rows this query returned, each with the products that
   * carry it. The section's own query reads the section's vocabulary instead,
   * which grows with every row the section shows, because every row of the
   * section is a row of that query.
   */
  vocabulary: Vocabulary;
  /** The terms a narrowing of this query added, in the order it added them. */
  tried: Set<string>;
  /**
   * No term of its own is left untried. It stays for the report. Only a query
   * with terms is ever closed: see {@link SectionState.narrow}.
   */
  closed: boolean;
}

/** A term drawn to narrow a capped query by, not yet issued. */
interface Narrowing {
  query: CappedQuery;
  term: string;
}

interface SectionState {
  queries: number;
  barren: number;
  /** Queries that came back at the ceiling, oldest first. */
  capped: CappedQuery[];
  /** Keep a capped query, with the vocabulary of the rows it returned. */
  capture(terms: string[], vocabulary: Vocabulary): void;
  /**
   * One issued query: the products it returned, each covered once more, and
   * what it added to the run, for the growth window.
   */
  observe(returned: Set<string>, added: number): void;
  /** Whether the last five queries added enough to go on past the floor. */
  growing(): boolean;
  /**
   * The next narrowing: the heaviest untried word of any open capped query,
   * root or child. Null when no capped query has a word to offer. It is only
   * drawn: nothing counts as tried until {@link take} issues it.
   */
  narrow(): Narrowing | null;
  /** Issue a narrowing: its word is tried, and its terms are answered. */
  take(narrowing: Narrowing): string[];
  finish(stoppedBy: SectionStop): void;
}

/**
 * What one run accumulates: the products, the shops, and the sections it could
 * not finish.
 *
 * It is shared by every worker, which is safe because a worker pool here is
 * concurrency rather than parallelism: only one of them is between two `await`s
 * at a time.
 */
class Crawl {
  /** Identity key -> product. Deduplicated across sections and across queries. */
  readonly products = new Map<string, CrawledProduct>();
  /** Shop code -> the name the source printed for it, most recently. */
  readonly shops = new Map<string, string>();

  private readonly incomplete: IncompleteSection[] = [];
  private readonly vocabularies = new Map<string, Vocabulary>();
  /** Section code -> its summary and the keys of the products it recorded. */
  private readonly summaries = new Map<
    string,
    {
      summary: Omit<SectionSummary, 'products' | 'coverageOnce'>;
      products: Set<string>;
      /**
       * `entryKey` -> how many issued queries of the section returned it
       * (plan 0258, section 1). Null until the section began.
       */
      coverage: Map<string, number> | null;
    }
  >();

  /** The floor: what a section may always spend, held to the cap. */
  readonly floor: number;
  readonly cap = SECTION_QUERY_CAP;

  constructor(floor: number = DEFAULT_SECTION_BUDGET) {
    this.floor = Math.min(floor, this.cap);
  }

  begin(section: DezaSection): SectionState {
    const vocabulary: Vocabulary = new Map();
    this.vocabularies.set(section.code, vocabulary);
    const summary = this.summarize(section);
    const coverage = new Map<string, number>();
    const held = this.summaries.get(section.code);
    if (held) {
      held.coverage = coverage;
    }
    /** What each issued query added to the run, oldest first. */
    const added: number[] = [];
    const window = (): number =>
      added.slice(-GROWTH_WINDOW).reduce((sum, count) => sum + count, 0);
    /**
     * Every query issued, by its terms in any order: `[leche, desnatada]` and
     * `[desnatada, leche]` are one query to the site, and a section never
     * issues one twice.
     */
    const issued = new Set<string>([queryKey([])]);
    /** The capped query the last narrowing was taken from. */
    let lastNarrowed: CappedQuery | null = null;
    const state: SectionState = {
      queries: 0,
      barren: 0,
      capped: [],
      capture: (terms, rows) => {
        state.capped.push({
          terms,
          // The section's own query returned every row the section shows.
          vocabulary: terms.length === 0 ? vocabulary : rows,
          tried: new Set(),
          closed: false,
        });
      },
      observe: (returned, count) => {
        for (const key of returned) {
          coverage.set(key, (coverage.get(key) ?? 0) + 1);
        }
        added.push(count);
      },
      growing: () => window() >= Math.max(1, summary.firstSeen * GROWTH_SHARE),
      narrow: () => {
        // **Every open capped query is weighed, the root included** (plan
        // 0258, section 2). The newest first order of plan 0257 is withdrawn:
        // in Color it spent the section's terms inside one capped child, where
        // two term queries added nothing, while `dev`'s single brand terms
        // over the whole section each opened up to 300 new rows. A word of the
        // root reaches at least the products the same word reaches under a
        // child, so the root wins while its words still lead to products few
        // queries returned, and a child is narrowed once they are spent or
        // saturated. Ties fall to more products, then to the query with fewer
        // terms, then to the older query, whose word is the earlier one.
        let best: { query: CappedQuery; weighed: WeighedTerm } | null = null;
        for (const query of state.capped) {
          if (query.closed) {
            continue;
          }
          const weighed = weighUntried(query, issued, coverage);
          if (!weighed) {
            // A child's vocabulary is fixed once captured, coverage only grows
            // and a tried word stays tried, so a child with nothing to offer
            // now never has anything again. **The root is never closed**: its
            // vocabulary is the section's, which every later query's rows
            // feed, so a word a child's rows bring in is a word the root can
            // offer next time. It is only skipped while it has nothing.
            if (query.terms.length > 0) {
              query.closed = true;
            }
            continue;
          }
          if (
            best === null ||
            outweighs(weighed, best.weighed) ||
            (ties(weighed, best.weighed) &&
              query.terms.length < best.query.terms.length)
          ) {
            best = { query, weighed };
          }
        }
        return best === null
          ? null
          : { query: best.query, term: best.weighed.term };
      },
      take: ({ query, term }) => {
        query.tried.add(term);
        lastNarrowed = query;
        const terms = [...query.terms, term];
        issued.add(queryKey(terms));
        return terms;
      },
      finish: (stoppedBy) => {
        summary.queries = state.queries;
        summary.stoppedBy = stoppedBy;
        summary.growthAtStop = window();
        // The section's rows are all read: its vocabulary is not needed
        // again, and held for the whole run it is the largest thing a run
        // keeps per section. Coverage stays, `coverageOnce` reads it.
        this.vocabularies.delete(section.code);
        // The capped queries no narrowing was taken from, still at the
        // ceiling when the section stopped.
        const open = state.capped
          .filter((query) => query.tried.size === 0)
          .map((query) => describeQuery(query.terms));
        // A section that stopped growing is not unfinished (below), so
        // `sections` is where its open queries are named.
        summary.openQueries = stoppedBy === 'GROWTH' ? open : [];
        // A section never capped was read whole by its own query. One that
        // stopped barren was narrowed until three passes added nothing, which
        // is where plan 0085 says a term cover has done what it can: it is
        // not unfinished, and naming it would put the one section that
        // finished beside the ones that did not. One that stopped growing is
        // the same end reached by a slower decline (plan 0258, section 4).
        if (
          state.capped.length === 0 ||
          stoppedBy === 'BARREN' ||
          stoppedBy === 'GROWTH' ||
          stoppedBy === 'COMPLETE'
        ) {
          return;
        }
        // The open queries are the honest artifact: completeness cannot be
        // proven against this source, there is no total to check against,
        // and a number would be a guess. The section's own query is here
        // only when it was never narrowed. Where the section was still
        // digging is named beside them.
        const digging: CappedQuery | null = lastNarrowed;
        this.incomplete.push({
          code: section.code,
          name: section.name,
          queries: state.queries,
          stoppedBy,
          openQueries: open,
          narrowing: digging === null ? null : describeQuery(digging.terms),
          termsTried: digging === null ? 0 : digging.tried.size,
        });
      },
    };
    return state;
  }

  /** A section that never ran, or that threw. Recorded the same way. */
  unfinished(section: DezaSection, openQueries: string[]): void {
    const summary = this.summarize(section);
    summary.queries = null;
    summary.stoppedBy = null;
    summary.growthAtStop = null;
    summary.openQueries = [];
    this.vocabularies.delete(section.code);
    const held = this.summaries.get(section.code);
    if (held) {
      held.coverage = null;
    }
    this.incomplete.push({
      code: section.code,
      name: section.name,
      queries: null,
      stoppedBy: null,
      openQueries,
      narrowing: null,
      termsTried: null,
    });
  }

  /** The sections named unfinished so far. */
  get incompleteSections(): readonly IncompleteSection[] {
    return this.incomplete;
  }

  /**
   * Record one row.
   *
   * **The listing repeats rows** (plan 0085, section 6): one product filed under
   * two sections comes back in both, and was seen twice inside a single result
   * set. The key is what deduplicates it. The section path of the **first**
   * sighting is kept, because a product genuinely filed in two places has no one
   * true section and the first is as good an answer as the last.
   *
   * Answers the row's key and whether it was new to the run, which is what a
   * section's barren rule, its growth rule and its `firstSeen` count read.
   */
  record(
    section: DezaSection,
    row: DezaProductRow
  ): { key: string; added: boolean } {
    for (const shop of row.shops) {
      this.shops.set(shop.code, shop.printedName);
    }
    const key = entryKey(row.name, row.sizeFormat);
    const vocabulary = this.vocabularies.get(section.code);
    if (vocabulary) {
      learn(vocabulary, row.name, key);
    }

    const summarized = this.summaries.get(section.code);
    summarized?.products.add(key);
    const held = this.products.get(key);
    if (held) {
      for (const shop of row.shops) {
        held.shops.add(shop.code);
      }
      return { key, added: false };
    }
    if (summarized) {
      summarized.summary.firstSeen += 1;
    }
    this.products.set(key, {
      name: row.name,
      sizeFormat: row.sizeFormat,
      unitSize: row.unitSize,
      sizeUnit: row.sizeUnit,
      approxWeight: row.approxWeight,
      packCount: row.packCount,
      brand: row.brand,
      // The attribute icons sit beside the section path because they are the
      // only classification beyond the section the page offers (section 8).
      categoryPath: [...section.path, ...row.attributes],
      shops: new Set(row.shops.map((shop) => shop.code)),
    });
    return { key, added: true };
  }

  toReport(): Record<string, unknown> {
    return {
      products: this.products.size,
      /**
       * Named, never counted alone. "28 sections incomplete" tells an operator
       * that something is missing and nothing about what.
       */
      incompleteSections: this.incomplete,
      /**
       * Every section, finished or not, in the order the run began them, with
       * what each took and why it ended (plan 0257, section 2).
       */
      sections: [...this.summaries.values()].map(
        ({ summary, products, coverage }): SectionSummary => ({
          code: summary.code,
          name: summary.name,
          products: products.size,
          firstSeen: summary.firstSeen,
          queries: summary.queries,
          stoppedBy: summary.stoppedBy,
          coverageOnce:
            coverage === null
              ? null
              : [...coverage.values()].filter((count) => count === 1).length,
          growthAtStop: summary.growthAtStop,
          openQueries: summary.openQueries,
        })
      ),
    };
  }

  /** The summary of a section, made on its first mention. */
  private summarize(
    section: DezaSection
  ): Omit<SectionSummary, 'products' | 'coverageOnce'> {
    let held = this.summaries.get(section.code);
    if (!held) {
      held = {
        summary: {
          code: section.code,
          name: section.name,
          firstSeen: 0,
          queries: 0,
          stoppedBy: null,
          growthAtStop: null,
          openQueries: [],
        },
        products: new Set(),
        coverage: null,
      };
      this.summaries.set(section.code, held);
    }
    return held.summary;
  }
}

/** The words of a description that are worth narrowing a query by. */
function learn(vocabulary: Vocabulary, name: string, key: string): void {
  for (const word of normalizeName(name).split(' ')) {
    if (word.length < MIN_TERM_LENGTH || /^\d+$/.test(word)) {
      continue;
    }
    let products = vocabulary.get(word);
    if (!products) {
      products = new Set();
      vocabulary.set(word, products);
    }
    products.add(key);
  }
}

/** One `LISTING_UNREAD` for a section the run could not finish (plan 0251). */
function unfinishedWarning(section: IncompleteSection) {
  const label = `Section ${section.code} ${section.name}`;
  const message =
    section.stoppedBy === null
      ? `${label} failed: ${section.openQueries.join('; ')}`
      : `${label} stopped by ${section.stoppedBy} after ` +
        plural(section.queries ?? 0, 'query', 'queries') +
        (section.narrowing !== null
          ? ` while narrowing ${section.narrowing}, ` +
            `${plural(section.termsTried ?? 0, 'term', 'terms')} tried`
          : '') +
        (section.openQueries.length > 0
          ? `, still capped: ${section.openQueries.join(', ')}`
          : '') +
        '.';
  return listingWarning(
    HarvestWarningCode.LISTING_UNREAD,
    section.name,
    message
  );
}

/** "1 query", "25 queries". */
function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The heaviest word of a capped query's own rows that it has not been narrowed
 * by, is not one of its own terms, and would not issue a query the section
 * already issued under another order of the same terms (plan 0258, section 2).
 *
 * **The weight is the products a word would reach that the section has seen
 * least**, not how often the word was seen: the sum over the products that
 * carry it of `1 / (1 + coverage)`, where coverage counts the section's
 * queries that returned the product (D3). A word frequent among rows already
 * returned describes rows already returned. The rows hidden behind a ceiling
 * can only be reached through a word they carry, and the best evidence for one
 * is a product few queries have returned. A word whose every product was
 * returned {@link SATURATED_COVERAGE} times or more is not offered at all.
 * Ties fall to the word with more products, then to the word seen first.
 *
 * The tried set is the query's own (plan 0257): a term spent under `[leche]`
 * is still a term `[yogur]` may be narrowed by.
 */
export function heaviestUntried(
  query: CappedQuery,
  issued: ReadonlySet<string>,
  coverage: ReadonlyMap<string, number>
): string | null {
  return weighUntried(query, issued, coverage)?.term ?? null;
}

/** A word offered to narrow a query by, with what decided it. */
interface WeighedTerm {
  term: string;
  weight: number;
  products: number;
}

/** Whether `a` is the heavier word: by weight, then by products. */
function outweighs(a: WeighedTerm, b: WeighedTerm): boolean {
  if (a.weight > b.weight + WEIGHT_EPSILON) {
    return true;
  }
  return a.weight >= b.weight - WEIGHT_EPSILON && a.products > b.products;
}

/** Whether neither word outweighs the other. */
function ties(a: WeighedTerm, b: WeighedTerm): boolean {
  return !outweighs(a, b) && !outweighs(b, a);
}

/** {@link heaviestUntried}, with its weight and product count. */
function weighUntried(
  query: CappedQuery,
  issued: ReadonlySet<string>,
  coverage: ReadonlyMap<string, number>
): WeighedTerm | null {
  let best: WeighedTerm | null = null;
  for (const [term, products] of query.vocabulary) {
    if (
      query.tried.has(term) ||
      query.terms.includes(term) ||
      issued.has(queryKey([...query.terms, term]))
    ) {
      continue;
    }
    let weight = 0;
    let open = false;
    for (const key of products) {
      const covered = coverage.get(key) ?? 0;
      weight += 1 / (1 + covered);
      open ||= covered < SATURATED_COVERAGE;
    }
    if (!open) {
      continue;
    }
    const weighed = { term, weight, products: products.size };
    if (best === null || outweighs(weighed, best)) {
      best = weighed;
    }
  }
  return best;
}

/** One query, whatever order its terms are in. */
function queryKey(terms: string[]): string {
  return [...terms].sort().join(' ');
}

function describeQuery(terms: string[]): string {
  return terms.length === 0 ? '(the whole section)' : terms.join(' ');
}

/**
 * Where the listing lives, from the source row rather than the environment.
 *
 * Plan 0083 deleted the per chain environment variable and put the per chain
 * switch in this same jsonb, for the same reason: a second chain that needed a
 * second variable threaded through `app-config.ts`, the config map, `_env.tpl`
 * and both `luna-slot` scripts is a chain nobody can turn on without a deploy.
 * A test double points at its own server by writing this key.
 */
function readBaseUrl(config: Record<string, unknown>): string | undefined {
  const baseUrl = config['baseUrl'];
  return typeof baseUrl === 'string' && baseUrl.trim() !== ''
    ? baseUrl.trim()
    : undefined;
}

/** The per section query floor (plan 0258), overridable per chain on the same row. */
function readBudget(config: Record<string, unknown>): number {
  const budget = Number(config['sectionQueryBudget']);
  return Number.isFinite(budget) && budget > 0
    ? Math.floor(budget)
    : DEFAULT_SECTION_BUDGET;
}
