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
   * One section, crawled and then narrowed until it is complete, exhausted or
   * out of budget (plan 0085, section 3).
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
    let next: string[] | null = [];
    // The budget, unless a narrowing ran out or three passes added nothing.
    let stoppedBy: SectionStop = 'BUDGET';

    while (state.queries < crawl.budget) {
      if (!next) {
        next = state.narrow();
        if (!next) {
          // A section whose own query fit under the ceiling was read whole and
          // had nothing to narrow. One with a capped query left every capped
          // query with no term of its own untried.
          stoppedBy = state.capped.length === 0 ? 'COMPLETE' : 'NO_TERM';
          break;
        }
      }
      const terms = next;
      next = null;
      state.queries += 1;

      const { capped, added, vocabulary } = await this.crawlQuery(
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
      if (added === 0) {
        state.barren += 1;
        if (state.barren >= BARREN_QUERIES) {
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
   * how many of its rows were new to the run, and the vocabulary of the rows it
   * returned: the only terms that can reach the rows hidden behind its ceiling
   * are terms those rows carry (plan 0257).
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
    vocabulary: Map<string, number>;
  }> {
    const query: DezaQuery = { section: section.code, terms };
    const vocabulary = new Map<string, number>();
    let lastPage = 0;
    let added = 0;
    for await (const row of client.walkQuery(query, (page) => {
      lastPage = Math.max(lastPage, page.lastPage);
    })) {
      if (crawl.record(section, row)) {
        added += 1;
      }
      learn(vocabulary, row.name);
      await context.heartbeat();
    }
    return { capped: lastPage >= DEZA_CEILING_PAGES, added, vocabulary };
  }
}

/**
 * How many queries a capped section is allowed, **the owner's number**.
 *
 * It bounds a run at roughly `34 + 28 * 25` queries of a few pages each, which
 * is about 5,000 page fetches and 630 MB (plan 0085, section 3).
 */
const DEFAULT_SECTION_BUDGET = 25;

/** Consecutive queries adding nothing new before a section gives up. */
const BARREN_QUERIES = 3;

/** A word short enough to be noise is not a useful narrowing term. */
const MIN_TERM_LENGTH = 4;

interface CrawledProduct {
  name: string;
  sizeFormat: string | null;
  /** The number the size states and the unit it is in (plan 0177). */
  unitSize: number | null;
  sizeUnit: SourceSizeUnit | null;
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
 * - `BUDGET`: it spent its query budget with a capped query still open.
 * - `BARREN`: three passes in a row added nothing new. That is the stop rule
 *   of plan 0085 working, and the section is not reported as unfinished.
 * - `NO_TERM`: every capped query is closed: none has a term of its own left
 *   to narrow it by (plan 0257).
 * - `COMPLETE`: the section's own query fit under the ceiling, so it was read
 *   whole and nothing was narrowed. Only the `sections` list names it.
 */
type SectionStop = 'BUDGET' | 'BARREN' | 'NO_TERM' | 'COMPLETE';

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
  stoppedBy: Exclude<SectionStop, 'BARREN' | 'COMPLETE'> | null;
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
}

/**
 * A query that came back at the ceiling, and what it can still be narrowed by
 * (plan 0257, section 1).
 */
interface CappedQuery {
  terms: string[];
  /**
   * The words of the rows this query returned. The section's own query reads
   * the section's vocabulary instead, which grows with every row the section
   * shows, because every row of the section is a row of that query.
   */
  vocabulary: Map<string, number>;
  /** The terms a narrowing of this query added, in the order it added them. */
  tried: Set<string>;
  /** No term of its own is left untried. It stays for the report. */
  closed: boolean;
}

interface SectionState {
  queries: number;
  barren: number;
  /** Queries that came back at the ceiling, oldest first. */
  capped: CappedQuery[];
  /** Keep a capped query, with the vocabulary of the rows it returned. */
  capture(terms: string[], vocabulary: Map<string, number>): void;
  /** The next narrowing of an already capped query, or null when there is none. */
  narrow(): string[] | null;
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
  private readonly vocabularies = new Map<string, Map<string, number>>();
  /** Section code -> its summary and the keys of the products it recorded. */
  private readonly summaries = new Map<
    string,
    { summary: Omit<SectionSummary, 'products'>; products: Set<string> }
  >();

  constructor(readonly budget: number = DEFAULT_SECTION_BUDGET) {}

  begin(section: DezaSection): SectionState {
    const vocabulary = new Map<string, number>();
    this.vocabularies.set(section.code, vocabulary);
    const summary = this.summarize(section);
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
      narrow: () => {
        // Newest capped query first (plan 0257). A capped query is a ceiling
        // with rows behind it, and the newest is the narrowest one still
        // capped: splitting it by a word of its own rows reaches rows that a
        // second single term drawn from the whole section would show again.
        for (let index = state.capped.length - 1; index >= 0; index -= 1) {
          const query = state.capped[index];
          if (query.closed) {
            continue;
          }
          const term = mostFrequentUntried(query, issued);
          if (!term) {
            query.closed = true;
            continue;
          }
          query.tried.add(term);
          lastNarrowed = query;
          const terms = [...query.terms, term];
          issued.add(queryKey(terms));
          return terms;
        }
        return null;
      },
      finish: (stoppedBy) => {
        summary.queries = state.queries;
        summary.stoppedBy = stoppedBy;
        // A section never capped was read whole by its own query. One that
        // stopped barren was narrowed until three passes added nothing, which
        // is where plan 0085 says a term cover has done what it can: it is
        // not unfinished, and naming it would put the one section that
        // finished beside the ones that did not.
        if (
          state.capped.length === 0 ||
          stoppedBy === 'BARREN' ||
          stoppedBy === 'COMPLETE'
        ) {
          return;
        }
        // The capped queries no narrowing was taken from, still at the
        // ceiling when the section stopped. This is the honest artifact:
        // completeness cannot be proven against this source, there is no
        // total to check against, and a number would be a guess. The
        // section's own query is here only when it was never narrowed. Where
        // the section was still digging is named beside them.
        const digging: CappedQuery | null = lastNarrowed;
        this.incomplete.push({
          code: section.code,
          name: section.name,
          queries: state.queries,
          stoppedBy,
          openQueries: state.capped
            .filter((query) => query.tried.size === 0)
            .map((query) => describeQuery(query.terms)),
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
   * Answers whether the row was new to the run, which is what a section's
   * barren rule and its `firstSeen` count read.
   */
  record(section: DezaSection, row: DezaProductRow): boolean {
    for (const shop of row.shops) {
      this.shops.set(shop.code, shop.printedName);
    }
    const vocabulary = this.vocabularies.get(section.code);
    if (vocabulary) {
      learn(vocabulary, row.name);
    }

    const key = entryKey(row.name, row.sizeFormat);
    const summarized = this.summaries.get(section.code);
    summarized?.products.add(key);
    const held = this.products.get(key);
    if (held) {
      for (const shop of row.shops) {
        held.shops.add(shop.code);
      }
      return false;
    }
    if (summarized) {
      summarized.summary.firstSeen += 1;
    }
    this.products.set(key, {
      name: row.name,
      sizeFormat: row.sizeFormat,
      unitSize: row.unitSize,
      sizeUnit: row.sizeUnit,
      packCount: row.packCount,
      brand: row.brand,
      // The attribute icons sit beside the section path because they are the
      // only classification beyond the section the page offers (section 8).
      categoryPath: [...section.path, ...row.attributes],
      shops: new Set(row.shops.map((shop) => shop.code)),
    });
    return true;
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
        ({ summary, products }): SectionSummary => ({
          code: summary.code,
          name: summary.name,
          products: products.size,
          firstSeen: summary.firstSeen,
          queries: summary.queries,
          stoppedBy: summary.stoppedBy,
        })
      ),
    };
  }

  /** The summary of a section, made on its first mention. */
  private summarize(section: DezaSection): Omit<SectionSummary, 'products'> {
    let held = this.summaries.get(section.code);
    if (!held) {
      held = {
        summary: {
          code: section.code,
          name: section.name,
          firstSeen: 0,
          queries: 0,
          stoppedBy: null,
        },
        products: new Set(),
      };
      this.summaries.set(section.code, held);
    }
    return held.summary;
  }
}

/** The words of a description that are worth narrowing a query by. */
function learn(vocabulary: Map<string, number>, name: string): void {
  for (const word of normalizeName(name).split(' ')) {
    if (word.length < MIN_TERM_LENGTH || /^\d+$/.test(word)) {
      continue;
    }
    vocabulary.set(word, (vocabulary.get(word) ?? 0) + 1);
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
 * The most frequent word of a capped query's own rows that it has not been
 * narrowed by, is not one of its own terms, and would not issue a query the
 * section already issued under another order of the same terms.
 *
 * The tried set is the query's own (plan 0257): a term spent under `[leche]`
 * is still a term `[yogur]` may be narrowed by.
 */
function mostFrequentUntried(
  query: CappedQuery,
  issued: Set<string>
): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [term, count] of query.vocabulary) {
    if (
      count <= bestCount ||
      query.tried.has(term) ||
      query.terms.includes(term) ||
      issued.has(queryKey([...query.terms, term]))
    ) {
      continue;
    }
    best = term;
    bestCount = count;
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

/** The per section query budget, overridable per chain on the same row. */
function readBudget(config: Record<string, unknown>): number {
  const budget = Number(config['sectionQueryBudget']);
  return Number.isFinite(budget) && budget > 0
    ? Math.floor(budget)
    : DEFAULT_SECTION_BUDGET;
}
