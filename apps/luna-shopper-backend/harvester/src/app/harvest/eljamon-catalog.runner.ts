import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HarvestDetailFetch } from '@portfolio/luna-shopper/contracts';
import {
  ELJAMON_DEFAULT_POSTAL_CODE,
  ElJamonClient,
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
import type { RunContext } from './run-context';
import type { RunReport } from './run-report';
import type {
  SourceObservation,
  SourceObservationPrice,
} from './source-ingest';

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
 *
 * The order (section 8):
 *
 * 1. `LIST`. Walk the eleven top level categories, page by page. A category is
 *    serial, because page N is a POST of the filters page N - 1 carried.
 * 2. `DETAIL`. One product page per product this chain has no row for, for the
 *    category path. A known product skips it (plan 0119, section 3).
 * 3. `INGEST`. Report every product, with its listing price.
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
    const client = this.createClient(context, source, postalCode);
    const walk = new Walk();

    // --- 1. The listing ----------------------------------------------------
    await context.setStage('LIST', 'Reading the top level categories');
    const categories = await client.topCategories();
    for (const category of categories) {
      context.signal.throwIfAborted();
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
    await runWorkerPool({
      items: fresh,
      workers: source.workers,
      signal: context.signal,
      handle: async (listed) => {
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
        await context.heartbeat();
      },
      onError: async (error, listed) => {
        // One page costs one product's category path, never the product: it
        // is still reported, with its top level category (section 5.3).
        this.logger.warn(
          `Run ${context.runId}: product ${listed.row.code} failed: ${String(error)}`
        );
        walk.failedProducts.push({
          code: listed.row.code,
          url: listed.row.url,
          error: String(error),
        });
        await context.report({ failed: 1 });
      },
    });
    context.signal.throwIfAborted();
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
    for (const listed of walk.rows.values()) {
      if (known.has(listed.row.code)) {
        // What the listing said and nothing else, so the stored name, brand
        // and category path stay what the last full read wrote (plan 0119,
        // section 6).
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

    await context.flush();
    await context.setReport(
      walk.toReport(postalCode, fresh.length, client.requests)
    );
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
    };
    walk.categories.push(summary);
    let page = 0;
    /** Every page that failed, named on the report, in the order they failed. */
    const skipped: Array<{ page: number; error: unknown }> = [];
    try {
      for await (const row of client.walkCategory(
        category,
        (read, index) => {
          page = index;
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
      if (context.signal.aborted) {
        throw error;
      }
      skipped.push({ page: page + 1, error });
    }
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
   * client built on a fake fetch, and nothing in the runtime overrides it.
   */
  protected createClient(
    context: RunContext,
    source: SupermarketSource,
    postalCode: string
  ): ElJamonClient {
    const settings = this.config.getOrThrow<HarvesterConfig>('harvester');
    return new ElJamonClient({
      userAgent: settings.userAgent,
      baseUrl: readString(source.config, 'baseUrl'),
      postalCode,
      // The run's own bucket, so the rate the owner set on this row is the rate
      // the source sees, whatever the number of workers.
      acquire: context.acquire,
      signal: context.signal,
    });
  }
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
 * One product as the listing and, when it was read, its page describe it.
 *
 * Every product this is called for had its page asked for, so a missing detail
 * is a page that failed, and the observation says so in its `extra` for the
 * next walk to read the page again.
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
    sizeFormat: size.sizeFormat,
    packCount: size.packCount,
    categoryPath:
      detail && detail.categoryPath.length > 0
        ? detail.categoryPath
        : [listed.category.name],
    url: listed.row.url,
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
    requests: number
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
