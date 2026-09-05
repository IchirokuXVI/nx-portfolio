import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PriceSourceKind,
  SourceLocationStatus,
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
import { CatalogClient } from './catalog-client.service';
import type { CatalogDiscoveryInput, CatalogRunner } from './catalog-runner';
import { entryKey, normalizeName } from './matching';
import type { RunContext } from './run-context';
import { SourceIngest, type SourceObservation } from './source-ingest';
import {
  SourceLocationService,
  type ObservedShop,
} from './source-location.service';

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

  constructor(
    private readonly ingest: SourceIngest,
    private readonly catalog: CatalogClient,
    private readonly shops: SourceLocationService,
    private readonly config: ConfigService
  ) {}

  async run(
    context: RunContext,
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
      handle: (section) => this.enumerateSection(crawl, client, section),
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

    // --- 3 and 4. The snapshot, and the match -----------------------------
    await context.setStage(
      'SNAPSHOT',
      `Writing ${crawl.products.size} product(s)`
    );
    const itemIdByKey = await this.writeSnapshot(context, input, crawl);

    // --- 5 and 6. The shops, and what they carry --------------------------
    await context.setStage('AVAILABILITY', 'Resolving shops');
    const report = await this.writeAvailability(
      context,
      input,
      crawl,
      itemIdByKey
    );

    await context.flush();
    await context.setReport({ ...crawl.toReport(), ...report });
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
      const capped = await this.crawlQuery(crawl, client(), section, terms);
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
    }
    return lastPage >= DEZA_CEILING_PAGES;
  }

  /**
   * Steps 3 and 4: the rows and the ladder, answering which catalog item
   * each product resolved to.
   *
   * A product that resolved to nothing is a candidate for the review queue and
   * nothing else. It cannot take part in step 6 either, because per shop
   * availability is stated per catalog item, and there is no item to state it
   * for.
   */
  private async writeSnapshot(
    context: RunContext,
    input: CatalogDiscoveryInput,
    crawl: Crawl
  ): Promise<Map<string, string>> {
    const observedAt = new Date();
    const observations: SourceObservation[] = [...crawl.products].map(
      ([externalId, product]) => ({
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
        // **It writes no price, ever.** The site prints none, and the blank
        // price elements in its markup are the storefront's own hidden pricing,
        // which a parser reading them would write as zeros.
        price: null,
      })
    );

    const { outcomes } = await this.ingest.ingest(context, {
      supermarketId: input.supermarketId,
      // A scope is accepted and ignored (plan 0086, section 9): there is no
      // price to write it for, and a required field that does nothing is a lie
      // in a form.
      priceScopeId: null,
      sourceKind: PriceSourceKind.OFFICIAL_WEB,
      observations,
    });

    const itemIdByKey = new Map<string, string>();
    for (const outcome of outcomes) {
      if (outcome.itemId) {
        itemIdByKey.set(outcome.entry.externalId, outcome.itemId);
      }
    }
    return itemIdByKey;
  }

  /**
   * Steps 5 and 6: which shop of theirs is which of ours, and what each carries.
   *
   * **Absence is the claim.** Every mapped shop receives a value for every
   * product the run resolved, `false` included: the popup names the shops that
   * carry a product, so a shop it did not name does not stock it, and dropping
   * that leaves the run unable to say anything negative at all.
   *
   * An unmapped shop is **skipped, counted and never guessed** (plan 0084,
   * section 6). The run writes nothing for it and finishes; the row is what the
   * back office shows, so the operator sees a shop waiting to be mapped rather
   * than a silence.
   */
  private async writeAvailability(
    context: RunContext,
    input: CatalogDiscoveryInput,
    crawl: Crawl,
    itemIdByKey: Map<string, string>
  ): Promise<Record<string, unknown>> {
    const observed: ObservedShop[] = [...crawl.shops].map(
      ([externalId, printedName]) => ({ externalId, printedName })
    );
    const rows = await this.shops.observe(
      input.supermarketId,
      observed,
      context.runId
    );
    const mapped = rows.filter(
      (row) =>
        row.status === SourceLocationStatus.ACTIVE && row.supermarketLocationId
    );
    const unmapped = rows.filter(
      (row) => row.status === SourceLocationStatus.UNMAPPED
    );
    const observedAt = new Date();

    let written = 0;
    const conflicts: Array<Record<string, unknown>> = [];
    for (const row of mapped) {
      const entries = this.availabilityFor(crawl, itemIdByKey, row.externalId);
      for (const chunk of chunked(entries, AVAILABILITY_BATCH)) {
        const result = await this.catalog.setLocationAvailability(
          row.supermarketLocationId as string,
          chunk,
          context.runId,
          // A page the chain publishes, which is what `OFFICIAL_WEB` means. It
          // is also the client's default; stating it keeps the provenance this
          // run stamps visible at the call rather than one file away.
          PriceSourceKind.OFFICIAL_WEB,
          observedAt
        );
        written += result.written;
        for (const conflict of result.conflicts) {
          conflicts.push({ shop: row.externalId, ...conflict });
        }
      }
    }

    if (conflicts.length > 0) {
      this.logger.warn(
        `Run ${context.runId}: ${conflicts.length} availability row(s) ` +
          'belong to a person and were left alone'
      );
    }

    return {
      shopsSeen: rows.length,
      shopsWritten: mapped.length,
      // Named rather than counted: an operator draining the queue wants to know
      // which shop they are looking at, and there are ten of them, not ten
      // thousand.
      shopsUnmapped: unmapped.map((row) => ({
        externalId: row.externalId,
        printedName: row.printedName,
      })),
      availabilityWritten: written,
      // Plan 0084, section 3: a person always wins, and the run reports the
      // disagreement rather than applying it.
      availabilityConflicts: conflicts,
    };
  }

  /**
   * One shop's entries: every product the run resolved, and whether this shop's
   * code was in that product's popup.
   *
   * Two source products can resolve to one catalog item, through two
   * rows an operator accepted. When they disagree the shop
   * **carries** it: stocking either one is stocking the item, and the false
   * would be a claim the source never made.
   */
  private availabilityFor(
    crawl: Crawl,
    itemIdByKey: Map<string, string>,
    shopCode: string
  ): Array<{ itemId: string; available: boolean }> {
    const byItem = new Map<string, boolean>();
    for (const [externalId, product] of crawl.products) {
      const itemId = itemIdByKey.get(externalId);
      if (!itemId) {
        continue;
      }
      const available = product.shops.has(shopCode);
      byItem.set(itemId, (byItem.get(itemId) ?? false) || available);
    }
    return [...byItem].map(([itemId, available]) => ({ itemId, available }));
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
 * Entries per `setAvailability` call.
 *
 * The NATS subject has no cap and the HTTP DTO caps at 500; this follows the
 * DTO. A chain of 13,000 products would otherwise be one message of the better
 * part of a megabyte per shop, which is the size a broker starts refusing at,
 * and the handler decides per item so splitting it costs nothing.
 */
const AVAILABILITY_BATCH = 500;

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

function* chunked<T>(items: T[], size: number): Iterable<T[]> {
  for (let index = 0; index < items.length; index += size) {
    yield items.slice(index, index + size);
  }
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
