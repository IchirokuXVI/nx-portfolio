import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import type { RunContext } from './run-context';
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
 * products for review and, for every shop somebody has mapped, whether that shop
 * carries each product it resolved.
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
 *    skipping the unmapped.
 * 6. Call `supermarketLocationItem.setAvailability` once per resolved shop, with
 *    a value for every product the run resolved, positive **and** negative.
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
    // holds it (plan 0103, section 6.3), and an unmapped shop is skipped,
    // counted and never guessed.
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
        unitSize: null,
        sizeFormat: product.sizeFormat,
        categoryPath: product.categoryPath,
        // There is no per product URL on this site; the listing is the page.
        url: null,
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

    while (state.queries < crawl.budget) {
      if (!next) {
        next = state.narrow();
        if (!next) {
          break;
        }
      }
      const terms = next;
      next = null;
      state.queries += 1;

      const before = crawl.products.size;
      const capped = await this.crawlQuery(
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
        state.capped.push(terms);
      }
      // A pass that adds nothing new is where a term based cover stops paying:
      // the remaining vocabulary is describing products already seen, and the
      // budget is better left unspent than spent proving it again.
      if (crawl.products.size === before) {
        state.barren += 1;
        if (state.barren >= BARREN_QUERIES) {
          break;
        }
      } else {
        state.barren = 0;
      }
    }

    state.finish();
  }

  /** One query, every page of it, recorded. Answers whether it hit the ceiling. */
  private async crawlQuery(
    context: RunContext,
    crawl: Crawl,
    client: DezaClient,
    section: DezaSection,
    terms: string[]
  ): Promise<boolean> {
    const query: DezaQuery = { section: section.code, terms };
    let lastPage = 0;
    for await (const row of client.walkQuery(query, (page) => {
      lastPage = Math.max(lastPage, page.lastPage);
    })) {
      crawl.record(section, row);
      await context.heartbeat();
    }
    return lastPage >= DEZA_CEILING_PAGES;
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

/**
/** A word short enough to be noise is not a useful narrowing term. */
const MIN_TERM_LENGTH = 4;

interface CrawledProduct {
  name: string;
  sizeFormat: string | null;
  brand: string | null;
  categoryPath: string[];
  /** The codes of the shops that carry it. Absence is the negative claim. */
  shops: Set<string>;
}

interface SectionState {
  queries: number;
  barren: number;
  /** Queries that came back at the ceiling, oldest first. */
  capped: string[][];
  /** The next narrowing of an already capped query, or null when there is none. */
  narrow(): string[] | null;
  finish(): void;
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

  private readonly incomplete: Array<{
    code: string;
    name: string;
    openQueries: string[];
  }> = [];
  private readonly vocabularies = new Map<string, Map<string, number>>();

  constructor(readonly budget: number = DEFAULT_SECTION_BUDGET) {}

  begin(section: DezaSection): SectionState {
    const vocabulary = new Map<string, number>();
    this.vocabularies.set(section.code, vocabulary);
    const used = new Set<string>();
    const state: SectionState = {
      queries: 0,
      barren: 0,
      capped: [],
      narrow: () => {
        // Oldest capped query first, so the section's own vocabulary is spread
        // across the section before anything is narrowed twice.
        for (const terms of state.capped) {
          const term = mostFrequentUnused(vocabulary, used, terms);
          if (term) {
            used.add(term);
            return [...terms, term];
          }
        }
        return null;
      },
      finish: () => {
        if (state.capped.length === 0) {
          return;
        }
        // Every query still at the ceiling when the section stopped. This is the
        // honest artifact: completeness cannot be proven against this source,
        // there is no total to check against, and a number would be a guess.
        this.incomplete.push({
          code: section.code,
          name: section.name,
          openQueries: state.capped.map(describeQuery),
        });
      },
    };
    return state;
  }

  /** A section that never ran, or that threw. Recorded the same way. */
  unfinished(section: DezaSection, openQueries: string[]): void {
    this.incomplete.push({
      code: section.code,
      name: section.name,
      openQueries,
    });
  }

  /**
   * Record one row.
   *
   * **The listing repeats rows** (plan 0085, section 6): one product filed under
   * two sections comes back in both, and was seen twice inside a single result
   * set. The key is what deduplicates it. The section path of the **first**
   * sighting is kept, because a product genuinely filed in two places has no one
   * true section and the first is as good an answer as the last.
   */
  record(section: DezaSection, row: DezaProductRow): void {
    for (const shop of row.shops) {
      this.shops.set(shop.code, shop.printedName);
    }
    this.learn(section.code, row.name);

    const key = entryKey(row.name, row.sizeFormat);
    const held = this.products.get(key);
    if (held) {
      for (const shop of row.shops) {
        held.shops.add(shop.code);
      }
      return;
    }
    this.products.set(key, {
      name: row.name,
      sizeFormat: row.sizeFormat,
      brand: row.brand,
      // The attribute icons sit beside the section path because they are the
      // only classification beyond the section the page offers (section 8).
      categoryPath: [...section.path, ...row.attributes],
      shops: new Set(row.shops.map((shop) => shop.code)),
    });
  }

  toReport(): Record<string, unknown> {
    return {
      products: this.products.size,
      /**
       * Named, never counted alone. "28 sections incomplete" tells an operator
       * that something is missing and nothing about what.
       */
      incompleteSections: this.incomplete,
    };
  }

  /** The vocabulary a section's own descriptions offer as narrowing terms. */
  private learn(sectionCode: string, name: string): void {
    const vocabulary = this.vocabularies.get(sectionCode);
    if (!vocabulary) {
      return;
    }
    for (const word of normalizeName(name).split(' ')) {
      if (word.length < MIN_TERM_LENGTH || /^\d+$/.test(word)) {
        continue;
      }
      vocabulary.set(word, (vocabulary.get(word) ?? 0) + 1);
    }
  }
}

function mostFrequentUnused(
  vocabulary: Map<string, number>,
  used: Set<string>,
  terms: string[]
): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [term, count] of vocabulary) {
    if (count <= bestCount || used.has(term) || terms.includes(term)) {
      continue;
    }
    best = term;
    bestCount = count;
  }
  return best;
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
