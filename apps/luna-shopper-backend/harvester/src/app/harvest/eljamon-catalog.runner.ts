import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HarvestDetailFetch,
  HarvestWarningCode,
} from '@portfolio/luna-shopper/contracts';
import {
  ELJAMON_DEFAULT_POSTAL_CODE,
  ElJamonClient,
  ElJamonTimeoutError,
  createElJamonFetch,
  photoAddressRead,
  splitSize,
  type ElJamonCategory,
  type ElJamonListingRow,
  type ElJamonProduct,
} from '@portfolio/luna-shopper/eljamon';
import type { HarvesterConfig } from '../config/app-config';
import type { SupermarketSource } from '../entities';
import { runWorkerPool } from '../runner/worker-pool';
import {
  DETAIL_FAILED_KEY,
  type CatalogDiscoveryInput,
  type CatalogRunner,
} from './catalog-runner';
import { photoOf } from './photo-address';
import { listingWarning, type RunContext } from './run-context';
import type { RunReport } from './run-report';
import type {
  SourceObservation,
  SourceObservationPrice,
} from './source-ingest';

/**
 * How many silent attempts in a row, across every worker of the pool, stop the
 * detail stage (plan 0253, D1). An attempt is one request the transport sent,
 * a retry included, and it is silent when it timed out. With six workers and a
 * 30 second idle timeout, 20 is about 100 seconds of a chain that answers
 * nothing. Any attempt that gets an answer, a 404 included, starts the count
 * again. A reset connection, a socket hang up or a DNS failure is no answer
 * and no silence, so it leaves the count as it is.
 */
export const DETAIL_TIMEOUTS_IN_A_ROW = 20;

/**
 * The silent attempts in a row of one run, counted at the transport, below the
 * client's retries, so a page that timed out on every retry counts each one.
 */
export class SilentAttempts {
  /** Silent attempts since the last answer. */
  inARow = 0;
  /** Every silent attempt since the count was armed. On the report. */
  total = 0;

  /** Starts counting from nothing, at the start of the detail stage. */
  reset(): void {
    this.inARow = 0;
    this.total = 0;
  }

  /** Whether the chain has been silent long enough to stop asking. */
  get exhausted(): boolean {
    return this.inARow >= DETAIL_TIMEOUTS_IN_A_ROW;
  }

  /** `fetchImpl`, counted: a `Response` resets, a timeout counts. */
  watch(fetchImpl: typeof fetch): typeof fetch {
    return (async (input: string | URL | Request, init?: RequestInit) => {
      try {
        const response = await fetchImpl(input, init);
        // The transport resolves only once the whole body arrived, so any
        // status is an answer.
        this.inARow = 0;
        return response;
      } catch (error) {
        if (isTimeout(error)) {
          this.inARow += 1;
          this.total += 1;
        }
        throw error;
      }
    }) as typeof fetch;
  }
}

/**
 * `CATALOG_DISCOVERY` against the `eljamon-web` adapter (plan 0169, section 5).
 *
 * **One price list for every shop** (section 2). Five postal codes in five
 * provinces and one pickup shop showed the same prices and the same
 * assortment, so a run writes one price per product with `scopeKey: null`, into
 * the default scope the spawn gives it, which is the chain's `NATIONAL` scope
 * (plan 0153). It declares no scope: the seeded national scope has no
 * `externalKey`, and a declared one would be created a second time beside it.
 *
 * **It writes no availability, positive or negative.** The site publishes none
 * per shop, and the JSON-LD `availability` is a template constant (section 2.3).
 * It does hand over its national listing when the walk read it whole (plan
 * 0220, section 2.3), and the delisting counter writes a negative only after
 * several such walks did not list a product.
 *
 * The order (section 8):
 *
 * 1. `LIST`. Walk the eleven top level categories, page by page. A category is
 *    serial, because page N is a POST of the filters page N - 1 carried.
 * 2. `DETAIL`. One product page per product this chain has no row for, for the
 *    category path. A known product skips it (plan 0119, section 3).
 * 3. `INGEST`. Report every product, with its listing price.
 *
 * **`processed` counts products**, the unit of `totalPlanned` (plan 0217,
 * section 4), and this runner counts it itself (plan 0253, section 2): a known
 * product when the detail stage starts, a new one when its page is read or
 * fails, and one whose page was never asked for when the ingest records it.
 * So the counter moves during the hour of product pages and not only at the
 * end, and it ends at `totalPlanned` once.
 *
 * **The detail stage stops when the chain stops answering** (plan 0253,
 * section 3, D1 (b)): {@link DETAIL_TIMEOUTS_IN_A_ROW} silent attempts in a
 * row across the pool, retries included, about 100 seconds of six workers with
 * nothing answered, and no new page is asked. The run still records every
 * listed row and ends `COMPLETED` with one `DETAIL_UNREAD` warning. On a `NEW`
 * walk a new product whose page was not read is written with
 * {@link DETAIL_FAILED_KEY}, so the next walk asks for it. An `ALL` walk was
 * handed no ids, so it reports every product whose page it never asked for
 * from the listing alone, and the ingest creates no row from that for a
 * product the chain does not hold yet.
 *
 * **No number here claims the catalog is complete.** The sum of the counts
 * the categories printed is what the site said, and the report says it in those
 * words.
 */
@Injectable()
export class ElJamonCatalogRunner implements CatalogRunner {
  private readonly logger = new Logger(ElJamonCatalogRunner.name);

  constructor(private readonly config: ConfigService) {}

  async run(
    context: RunContext,
    report: RunReport,
    input: CatalogDiscoveryInput,
    source: SupermarketSource
  ): Promise<void> {
    const postalCode =
      readString(source.config, 'postalCode') ?? ELJAMON_DEFAULT_POSTAL_CODE;
    const silence = new SilentAttempts();
    const client = this.createClient(context, source, postalCode, silence);
    const walk = new Walk();
    context.countProgressItself();

    // --- 1. The listing ----------------------------------------------------
    await context.setStage('LIST', 'Reading the top level categories');
    const categories = await client.topCategories();
    for (const category of categories) {
      // An abort, a person's or the refusal guard's (plan 0215), ends the
      // listing and not the run: every row listed so far is reported below.
      if (context.signal.aborted) {
        break;
      }
      await this.listCategory(context, client, walk, category);
    }
    await context.setTotalPlanned(walk.rows.size);
    this.logger.log(
      `Run ${context.runId}: ${walk.rows.size} product(s) listed in ` +
        `${categories.length} categories`
    );

    // --- 2. One product page per new product -------------------------------
    const known = knownIds(input);
    const fresh = [...walk.rows.values()].filter(
      (listed) => !known.has(listed.row.code)
    );
    await context.setStage(
      'DETAIL',
      `Reading ${fresh.length} product page(s), ` +
        `${walk.rows.size - fresh.length} product(s) already known`
    );
    // A known product needs no page, so its share of the plan is done now.
    await context.report({ processed: walk.rows.size - fresh.length });
    const detail = await this.readDetails(
      context,
      client,
      walk,
      fresh,
      source,
      silence
    );
    for (const disagreement of walk.priceDisagreements) {
      // The listing wins: it is what a shopper sees with the session's postal
      // code (section 5.2). The disagreement is named on the report.
      this.logger.warn(
        `Run ${context.runId}: product ${disagreement.code} lists at ` +
          `${disagreement.listing} and its page says ${disagreement.productPage}`
      );
    }

    // --- 3. Report every product -------------------------------------------
    await context.setStage('INGEST', `Recording ${walk.rows.size} product(s)`);
    const observedAt = new Date();
    const failed = new Set(walk.failedProducts.map((product) => product.code));
    const holdsRow = rowsHeld(input);
    // The pages never asked for, or cut short by an abort, were counted by
    // nobody: they count as their rows are recorded here.
    await context.report({
      processed: fresh.filter(
        (listed) =>
          !walk.details.has(listed.row.code) && !failed.has(listed.row.code)
      ).length,
    });
    const pagesNotRead = context.signal.aborted || detail.stopped;
    for (const listed of walk.rows.values()) {
      const code = listed.row.code;
      // An aborted walk still reports every listed row (plan 0215, section
      // 6.1), and so does one whose detail stage stopped (plan 0253). A row
      // whose page it never read, and that the chain may already hold, is
      // reported from the listing alone, as a known one is: a full
      // observation would state no photo and the top level category, and the
      // ingest would clear the stored photo and category path with them.
      const unread =
        pagesNotRead && !walk.details.has(code) && !failed.has(code);
      if (known.has(code) || (unread && holdsRow(code))) {
        // What the listing said and nothing else, so the stored name, brand
        // and category path stay what the last full read wrote (plan 0119,
        // section 6). The photo address is on the product page alone (plan
        // 0198), so it is not stated here and the stored one stays too. A row
        // held from a page that failed keeps its `DETAIL_FAILED_KEY`, so the
        // next `NEW` walk reads it.
        report.product({
          externalId: listed.row.code,
          detailFetched: false,
          observedAt,
          prices: pricesOf(listed.row),
        });
      } else {
        report.product(
          observationOf(listed, walk.details.get(listed.row.code), observedAt)
        );
      }
    }

    declareListing(report, walk, context.signal);
    warnShortCategories(context, walk);
    warnDetailUnread(context, walk, detail, fresh.length);

    await context.flush();
    await context.setReport(
      walk.toReport(postalCode, fresh.length, client.requests, detail)
    );
  }

  /**
   * One product page per new product, over the source's workers (section 8).
   *
   * Each page read or failed is one product of `processed`. The pool runs on
   * a signal of its own, which the run's abort reaches too, so this stage can
   * stop alone: {@link DETAIL_TIMEOUTS_IN_A_ROW} silent attempts in a row,
   * across every worker and every retry, and no new page is asked. `silence`
   * counts them at the transport; the pool reads it as each page fails. A
   * page already in flight finishes or fails as it would have, its retries
   * included. What stopping costs is on the report, and in the
   * `DETAIL_UNREAD` warning the run writes.
   */
  private async readDetails(
    context: RunContext,
    client: ElJamonClient,
    walk: Walk,
    fresh: readonly ListedRow[],
    source: SupermarketSource,
    silence: SilentAttempts
  ): Promise<DetailStage> {
    const stage: DetailStage = {
      pages: 0,
      failed: 0,
      timeouts: 0,
      silentAttempts: 0,
      stopped: false,
    };
    // A listing that ended in silence is not this stage's to count.
    silence.reset();
    const pool = new AbortController();
    const stopPool = (): void => pool.abort();
    if (context.signal.aborted) {
      pool.abort();
    } else {
      context.signal.addEventListener('abort', stopPool, { once: true });
    }
    try {
      await runWorkerPool({
        items: fresh,
        workers: source.workers,
        signal: pool.signal,
        handle: async (listed) => {
          stage.pages += 1;
          const product = await client.getProduct(listed.row.url);
          if (!product) {
            throw new Error('The page carried no product JSON-LD.');
          }
          walk.details.set(listed.row.code, product);
          if (product.price !== null && product.price !== listed.row.price) {
            walk.priceDisagreements.push({
              code: listed.row.code,
              listing: listed.row.price,
              productPage: product.price,
            });
          }
          await context.report({ processed: 1 });
        },
        onError: async (error, listed) => {
          // The page the abort cut short is not a failed page: it was not
          // read, and is reported below as the pages never asked for are.
          if (context.signal.aborted) {
            return;
          }
          // One page costs one product's category path, never the product:
          // it is still reported, with its top level category (section 5.3).
          this.logger.warn(
            `Run ${context.runId}: product ${listed.row.code} failed: ${String(error)}`
          );
          walk.failedProducts.push({
            code: listed.row.code,
            url: listed.row.url,
            error: String(error),
          });
          stage.failed += 1;
          if (isTimeout(error)) {
            stage.timeouts += 1;
          }
          if (silence.exhausted && !stage.stopped) {
            stage.stopped = true;
            this.logger.warn(
              `Run ${context.runId}: ${silence.inARow} attempts in a row got ` +
                'no answer; no new page is asked, and the listing is recorded'
            );
            pool.abort();
          }
          await context.report({ failed: 1, processed: 1 });
        },
      });
    } finally {
      context.signal.removeEventListener('abort', stopPool);
    }
    stage.silentAttempts = silence.total;
    return stage;
  }

  /**
   * One top level category, every page of it. Every page that fails, retries
   * included, is named on the report. One after the first is skipped and the
   * walk goes on to the next page; page 1, or a second failure in a row, ends
   * the category and the walk moves to the next one.
   */
  private async listCategory(
    context: RunContext,
    client: ElJamonClient,
    walk: Walk,
    category: ElJamonCategory
  ): Promise<void> {
    const summary = {
      code: category.code,
      name: category.name,
      printedCount: null as number | null,
      rowsRead: 0,
      rowsRepeated: 0,
    };
    /** Every row the pages printed, the repeated ones included. */
    let rowsPrinted = 0;
    walk.categories.push(summary);
    let page = 0;
    /** Every page that failed, named on the report, in the order they failed. */
    const skipped: Array<{ page: number; error: unknown }> = [];
    try {
      for await (const row of client.walkCategory(
        category,
        (read, index) => {
          page = index;
          rowsPrinted += read.rows.length;
          if (index === 1) {
            summary.printedCount = read.articleCount;
          }
        },
        (index, error) => {
          // A page after the first is skipped rather than ending the
          // category: the next one is asked for with the last filters read.
          page = index;
          skipped.push({ page: index, error });
        }
      )) {
        summary.rowsRead += 1;
        walk.record(category, row);
        await context.heartbeat();
      }
    } catch (error) {
      // The page the abort cut short is not a failed page, and the rows read
      // before it stay in the walk.
      if (context.signal.aborted) {
        return;
      }
      skipped.push({ page: page + 1, error });
    }
    // The rows a page printed again after an earlier page of this category
    // printed them (plan 0253, section 1): the walk keeps going past them, and
    // the count says how often the chain's order shifted under the walk. A
    // last page that repeats in full is how a clamping server ends a category.
    summary.rowsRepeated = rowsPrinted - summary.rowsRead;
    for (const failure of skipped) {
      this.logger.warn(
        `Run ${context.runId}: ${category.path} page ${failure.page} failed: ` +
          String(failure.error)
      );
      walk.failedPages.push({
        category: category.code,
        path: category.path,
        page: failure.page,
        error: String(failure.error),
      });
      await context.report({ failed: 1 });
    }
  }

  /**
   * The client this run drives. **A seam and not a knob**: a test hands back a
   * client built on a fake fetch, and nothing in the runtime overrides it. The
   * fetch goes through `silence`, which is how the detail stage knows the
   * chain stopped answering, so an override wraps its fake the same way.
   */
  protected createClient(
    context: RunContext,
    source: SupermarketSource,
    postalCode: string,
    silence: SilentAttempts
  ): ElJamonClient {
    const settings = this.config.getOrThrow<HarvesterConfig>('harvester');
    return new ElJamonClient({
      userAgent: settings.userAgent,
      baseUrl: readString(source.config, 'baseUrl'),
      postalCode,
      fetchImpl: silence.watch(createElJamonFetch()),
      // The run's own bucket, so the rate the owner set on this row is the rate
      // the source sees, whatever the number of workers.
      acquire: context.acquire,
      guard: context.guard,
      signal: context.signal,
    });
  }
}

/**
 * The national listing, whole or not (plan 0220, section 2.3).
 *
 * Whole needs three things: no page failed, the run was not aborted, and every
 * category read at least the rows it printed. The client ends a category
 * quietly on an empty page or on a page that repeats a code it read, with no
 * failed page, so the printed count is what tells a whole category from a
 * short one. A category that printed no count is short too: to count too few
 * walks is the safe error. A product filed in two categories is read twice,
 * so a category may read more than it printed, never fewer.
 *
 * The key is the chain's product code, so a renamed product keeps its key.
 */
function declareListing(
  report: RunReport,
  walk: Walk,
  signal: AbortSignal
): void {
  if (signal.aborted) {
    return;
  }
  const listed = walk.rows.keys();
  if (walk.failedPages.length > 0) {
    report.listingNotWhole(
      null,
      'failed-page',
      walk.failedPages.map((page) => ({
        category: page.category,
        page: page.page,
      })),
      listed
    );
    return;
  }
  const short = walk.categories.filter(
    (category) =>
      category.printedCount === null ||
      category.rowsRead < category.printedCount
  );
  if (short.length > 0) {
    report.listingNotWhole(
      null,
      'short-category',
      short.map((category) => ({
        category: category.code,
        printedCount: category.printedCount,
        rowsRead: category.rowsRead,
      })),
      listed
    );
    return;
  }
  report.listingWhole(null, listed);
}

/**
 * One warning per category that read fewer rows than it printed (plan 0251).
 *
 * The run still ends `COMPLETED`, and these are what say it is partial. Why a
 * category comes back short is plan 0253's; this only names it, with both
 * numbers. A category that printed no count and gave no row is a category
 * whose first page never answered, which is a part not read at all rather
 * than a short one. One that printed no count and gave rows answered without
 * the count, and is short: what it read is named, against nothing.
 * An aborted walk writes none: it does not end `COMPLETED`, and every
 * category after the abort would read as short.
 */
function warnShortCategories(context: RunContext, walk: Walk): void {
  if (context.signal.aborted) {
    return;
  }
  for (const category of walk.categories) {
    if (category.printedCount === null && category.rowsRead === 0) {
      context.warn(
        listingWarning(
          HarvestWarningCode.LISTING_UNREAD,
          category.name,
          `Category ${category.code} ${category.name} printed no count: its ` +
            `first page did not answer, and 0 row(s) were read.`
        )
      );
    } else if (category.printedCount === null) {
      // The first page answered and printed no count, so there is nothing to
      // read the rows against: a part read, not a part never reached.
      context.warn(
        listingWarning(
          HarvestWarningCode.LISTING_SHORT,
          category.name,
          `Category ${category.code} ${category.name}: ` +
            `${category.rowsRead} row(s) read, no count printed.`
        )
      );
    } else if (category.rowsRead < category.printedCount) {
      context.warn(
        listingWarning(
          HarvestWarningCode.LISTING_SHORT,
          category.name,
          `Category ${category.code} ${category.name}: ${category.rowsRead} ` +
            `of ${category.printedCount} row(s) read.`
        )
      );
    }
  }
}

/**
 * The one warning of a detail stage that stopped on silence (plan 0253, D1
 * (b)). The run ends `COMPLETED`, so this is what says the products listed in
 * it have no page yet. An aborted walk writes none: it does not end
 * `COMPLETED`, and its own reason says why.
 *
 * The words hold on both kinds of walk. A page that failed is written from the
 * listing, marked for the next walk, on either. A page never asked for is
 * written the same way on a `NEW` walk; an `ALL` walk reports it from the
 * listing alone, and the ingest creates no row from that for a product the
 * chain does not hold. Either way the next walk asks for its page.
 */
function warnDetailUnread(
  context: RunContext,
  walk: Walk,
  detail: DetailStage,
  planned: number
): void {
  if (!detail.stopped || context.signal.aborted) {
    return;
  }
  const withoutPage = planned - walk.details.size;
  context.warn({
    code: HarvestWarningCode.DETAIL_UNREAD,
    offerId: null,
    page: null,
    name: null,
    message:
      `Product pages stopped after ${DETAIL_TIMEOUTS_IN_A_ROW} attempts in a ` +
      `row got no answer: ${detail.pages} of ${planned} page(s) asked, ` +
      `${detail.failed} failed, ${detail.timeouts} timed out. ` +
      `${withoutPage} product(s) had no page; the next walk asks for them ` +
      'again.',
  });
}

/**
 * Whether a product page failed because the chain said nothing: the
 * transport's idle timeout, or a socket that timed out below it.
 */
function isTimeout(error: unknown): boolean {
  return (
    error instanceof ElJamonTimeoutError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === 'ETIMEDOUT')
  );
}

/**
 * The products a walk skips the page of (plan 0119, section 3).
 *
 * The executor splits the chain's rows into the ids that carry an EAN and the
 * ids that do not, because for Mercadona the page is where the EAN comes from.
 * **This source has no EAN**, so every row it wrote is in the second set, and
 * reading the page again would answer the same category path. So a row in
 * either set is known here. `ALL` reads every page, as it does for Mercadona.
 *
 * **Except a row written from a page that failed**, which carries
 * {@link DETAIL_FAILED_KEY} (section 5.3). Counting it as known would keep the
 * listing's top level category forever, so its page is read again, which is
 * how a failed detail is retried here, as the missing EAN is for Mercadona. A
 * page that was read and whose breadcrumb has one level is not a failure, and
 * is not read again.
 */
function knownIds(input: CatalogDiscoveryInput): ReadonlySet<string> {
  if ((input.details ?? HarvestDetailFetch.ALL) !== HarvestDetailFetch.NEW) {
    return new Set();
  }
  const failed = input.externalIdsWithFailedDetail ?? new Set<string>();
  return new Set(
    [
      ...(input.knownExternalIds ?? []),
      ...(input.externalIdsWithoutEan ?? []),
    ].filter((id) => !failed.has(id))
  );
}

/**
 * Whether the chain may already hold a row for a product (plan 0215).
 *
 * A `NEW` walk was handed every id the chain holds, so the answer is exact. Any
 * other walk was handed none, so the answer is yes for every product: reading
 * an unread one from the listing alone costs a new product its first row until
 * the next walk, and the other answer could clear what a stored one holds.
 */
function rowsHeld(input: CatalogDiscoveryInput): (id: string) => boolean {
  if ((input.details ?? HarvestDetailFetch.ALL) !== HarvestDetailFetch.NEW) {
    return () => true;
  }
  const known = input.knownExternalIds ?? new Set<string>();
  const withoutEan = input.externalIdsWithoutEan ?? new Set<string>();
  return (id) => known.has(id) || withoutEan.has(id);
}

/**
 * One product as the listing and, when it was read, its page describe it.
 *
 * A missing detail is a page that failed (section 5.3), or on an aborted walk
 * a page never read of a product the chain holds no row for (plan 0215). The
 * observation says so in its `extra` for the next walk to read the page again.
 * An unread page of a row the chain may hold never reaches here, because this
 * states no photo and the top level category, and the ingest would write both.
 */
function observationOf(
  listed: ListedRow,
  detail: ElJamonProduct | undefined,
  observedAt: Date
): SourceObservation {
  const size = splitSize(listed.row.description);
  const extra: Record<string, unknown> = {};
  if (listed.row.previousPrice !== null) {
    extra['previousPrice'] = listed.row.previousPrice;
  }
  if (!detail) {
    extra[DETAIL_FAILED_KEY] = true;
  }
  return {
    externalId: listed.row.code,
    name: size.name,
    brand: listed.row.brand ?? detail?.brand ?? null,
    // The product pages carry none, and the basket's "barcode" argument repeats
    // the article code (section 1), which is not an EAN.
    ean: null,
    unitSize: size.unitSize,
    sizeUnit: size.sizeUnit,
    // A bare `kg` after the comma (plan 0181): the row is weighed at the till
    // and the price the chain prints for it is already the price of a kilo, so
    // nothing about the price changes here.
    soldByWeight: size.soldByWeight,
    sizeFormat: size.sizeFormat,
    packCount: size.packCount,
    categoryPath:
      detail && detail.categoryPath.length > 0
        ? detail.categoryPath
        : [listed.category.name],
    url: listed.row.url,
    // The `image` of the product page's JSON-LD (plan 0198). A page that
    // failed states none.
    imageUrl: detail
      ? photoOf(photoAddressRead(detail), listed.row.code)
      : null,
    observedAt,
    extra: Object.keys(extra).length > 0 ? extra : null,
    prices: pricesOf(listed.row),
  };
}

/**
 * One price, with no scope key, so it lands in the run's default scope, the
 * chain's `NATIONAL` one (section 2). The site states no offer dates, so the
 * window is open at both ends.
 */
function pricesOf(row: ElJamonListingRow): SourceObservationPrice[] {
  if (row.price === null) {
    return [];
  }
  return [
    {
      scopeKey: null,
      price: row.price,
      currency: 'EUR',
      unitPrice: row.unitPrice,
      unitPriceLabel: row.unitPriceLabel,
      validFrom: null,
      validUntil: null,
    },
  ];
}

interface ListedRow {
  category: ElJamonCategory;
  row: ElJamonListingRow;
}

/** What the detail stage did, on the report as `detail` (plan 0253). */
interface DetailStage {
  /** Product pages asked for, each once, retries not counted. */
  pages: number;
  /** Pages that failed, timeouts included. */
  failed: number;
  /** Failed pages whose last attempt timed out. */
  timeouts: number;
  /** Attempts that timed out, retries included: what the stop counts. */
  silentAttempts: number;
  /** Whether the silent attempts in a row stopped the stage. Not on the report. */
  stopped: boolean;
}

/**
 * What one run accumulates. Shared by every detail worker, which is safe
 * because the pool is concurrency rather than parallelism.
 */
class Walk {
  /** Article code -> the first category that listed it, and its row. */
  readonly rows = new Map<string, ListedRow>();
  readonly details = new Map<string, ElJamonProduct>();
  readonly categories: Array<{
    code: string;
    name: string;
    printedCount: number | null;
    rowsRead: number;
    rowsRepeated: number;
  }> = [];
  readonly failedPages: Array<{
    category: string;
    path: string;
    page: number;
    error: string;
  }> = [];
  readonly failedProducts: Array<{ code: string; url: string; error: string }> =
    [];
  readonly priceDisagreements: Array<{
    code: string;
    listing: number | null;
    productPage: number | null;
  }> = [];
  private repeated = 0;

  /**
   * One listing row. A product filed under two top level categories keeps the
   * first, and the repeat is counted so the listed total reads against the
   * printed one.
   */
  record(category: ElJamonCategory, row: ElJamonListingRow): void {
    if (this.rows.has(row.code)) {
      this.repeated += 1;
      return;
    }
    this.rows.set(row.code, { category, row });
  }

  toReport(
    postalCode: string,
    detailPlanned: number,
    requests: number,
    detail: DetailStage
  ): Record<string, unknown> {
    const listed = [...this.rows.values()];
    return {
      postalCode,
      categories: this.categories,
      /**
       * The sum of the counts the categories printed. What the site said, not
       * a proof that the walk saw everything it sells.
       */
      printedArticleCountSum: this.categories.reduce(
        (sum, category) => sum + (category.printedCount ?? 0),
        0
      ),
      listed: listed.length,
      listedInMoreThanOneCategory: this.repeated,
      onOffer: listed.filter((item) => item.row.previousPrice !== null).length,
      unpriced: listed.filter((item) => item.row.price === null).length,
      detailPlanned,
      detailRead: this.details.size,
      detailFailed: this.failedProducts.length,
      /** The detail stage's own counts (plan 0253, section 3). */
      detail: {
        pages: detail.pages,
        failed: detail.failed,
        timeouts: detail.timeouts,
        silentAttempts: detail.silentAttempts,
      },
      /** Named, never only counted. */
      failedPages: this.failedPages,
      failedProducts: this.failedProducts,
      priceDisagreements: this.priceDisagreements,
      requests,
    };
  }
}

/** A setting from the source row rather than the environment (plan 0083). */
function readString(
  config: Record<string, unknown>,
  key: string
): string | undefined {
  const value = config[key];
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined;
}
