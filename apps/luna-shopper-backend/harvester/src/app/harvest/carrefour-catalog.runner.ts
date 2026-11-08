import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CARREFOUR_PAGE_SIZE,
  CarrefourClient,
  CarrefourHttpError,
  listingPath,
  pagesFor,
  photoAddressRead,
  readCards,
  type CarrefourCappedCategory,
  type CarrefourCategory,
  type CarrefourProduct,
} from '@portfolio/luna-shopper/carrefour';
import { HarvestWarningCode } from '@portfolio/luna-shopper/contracts';
import { SourceBlockedError } from '@portfolio/luna-shopper/source-guard';
import type { HarvesterConfig } from '../config/app-config';
import type { SupermarketSource } from '../entities';
import type { CatalogDiscoveryInput, CatalogRunner } from './catalog-runner';
import { readDelistCountsCrawl } from './delisting';
import { photoOf } from './photo-address';
import { listingWarning, type RunContext } from './run-context';
import type { RunReport } from './run-report';

/**
 * `CATALOG_DISCOVERY` against the `carrefour-web` adapter (plan 0090).
 *
 * The third adapter under one mode, and the second that renders a page rather
 * than answering JSON. **It writes prices**, which is what separates it from
 * DEZA: every card carries a price and a price per unit, and 0 of 192 sampled
 * products lacked one.
 *
 * The order (plan 0090, sections 7 and 12):
 *
 * 1. Walk the category tree and pick the frontier: the shallowest node under
 *    the paging ceiling on every branch. About 95 page loads.
 * 2. Page every category in the frontier, 756 loads for 17,135 category
 *    memberships, which deduplicate on the chain's product id as the run goes.
 * 3. Hand every product to {@link SourceIngest} as an observation carrying the
 *    price the card printed.
 *
 * **851 page loads, about 62 minutes.** The run is politeness bound and not
 * latency bound: the storefront tolerates one page every two seconds and
 * blocks on burst, so there is no worker pool here and adding one would buy a
 * block rather than a shorter run.
 *
 * **The browser is given back whatever happens.** A leaked Chromium is 300 MB
 * of resident memory in a pod sized for a Nest service, so `close` is in the
 * `finally` and not on the happy path.
 *
 * It reads no product page. The EAN lives there and is worth having, and
 * {@link CarrefourDetailRunner} is how: a backfill keyed on the product rather
 * than on the run, because a price crawl that waited for 18,000 loads is a
 * price crawl that never finishes.
 */
@Injectable()
export class CarrefourCatalogRunner implements CatalogRunner {
  private readonly logger = new Logger(CarrefourCatalogRunner.name);

  constructor(private readonly config: ConfigService) {}

  async run(
    context: RunContext,
    report: RunReport,
    input: CatalogDiscoveryInput,
    source: SupermarketSource
  ): Promise<void> {
    requireScope(input.priceScopeId);
    // The plan is listings, so a listing paged is the unit of `processed` and
    // the ingest adds no products to it (plan 0217).
    context.countProgressItself();
    const client = this.createClient(context, source);

    try {
      // --- 1. The frontier ------------------------------------------------
      await context.setStage('FRONTIER', 'Finding the categories to page');
      const frontier = await client.walkCategories(readSeedPath(source.config));
      const planned = frontier.categories.reduce(
        (total, category) => total + category.totalResults,
        0
      );
      await context.setTotalPlanned(planned);
      this.logger.log(
        `Run ${context.runId}: ${frontier.categories.length} category(ies) ` +
          `holding ${planned} listing(s), found in ${frontier.loads} load(s)`
      );

      // --- 2. Every category, page by page --------------------------------
      await context.setStage(
        'ENUMERATE',
        `Paging ${frontier.categories.length} category(ies)`
      );
      const products = new Map<string, CarrefourProduct>();
      const unreadable = [...frontier.unreadable];
      /**
       * Every frontier category that failed, by its url, in the order they
       * failed, and what cost it (plan 0251). One the end pass read stays
       * here with no error and leaves `unreadable`.
       */
      const lost = new Map<string, LostCategory>();
      let blocked: unknown = null;
      for (const category of frontier.categories) {
        // An abort, a person's or the refusal guard's (plan 0215), ends the
        // crawl and not the run: what was read is reported below.
        if (context.signal.aborted) {
          break;
        }
        const cursor = { page: 0 };
        try {
          await this.pageCategory(context, client, category, products, cursor);
        } catch (error) {
          // **The block is the one failure a category may not swallow** (plan
          // 0090, section 13). Refusals that have stopped being isolated say
          // the address is in the state section 4 describes, and every page
          // after that deepens it, so the crawl stops here and the run fails
          // once what it already read is written.
          if (error instanceof SourceBlockedError) {
            this.logger.warn(`Run ${context.runId}: ${String(error)}`);
            unreadable.push(category.url);
            await context.report({ failed: 1 });
            blocked = error;
            break;
          }
          // A person's abort cut this category short. Its products read so
          // far are in the map, and it is named as unread.
          if (context.signal.aborted) {
            unreadable.push(category.url);
            break;
          }
          // Anything else costs one category. It is counted, logged and named
          // in the report, which is the same shape an unreadable node produces
          // and reads the same way to an operator.
          this.logger.warn(
            `Run ${context.runId}: category ${category.id} (${category.name}) ` +
              `failed: ${String(error)}`
          );
          unreadable.push(category.url);
          lost.set(category.url, {
            category,
            page: cursor.page,
            error,
            askedAgain: false,
          });
          await context.report({ failed: 1 });
        }
      }

      // --- 2b. Once more, at the end, for a category refused once ----------
      if (blocked === null && !context.signal.aborted) {
        blocked = await this.askAgain(
          context,
          client,
          products,
          unreadable,
          lost
        );
      }

      // --- 3. Report what was read -----------------------------------------
      await context.setStage('INGEST', `Recording ${products.size} product(s)`);
      this.reportProducts(report, products);
      if (!context.signal.aborted) {
        warnUnread(context, unreadable, lost);
      }
      declareListing(report, products, {
        switchOn: readDelistCountsCrawl(source.config),
        seedPath: readSeedPath(source.config) !== undefined,
        blocked: blocked !== null,
        truncated: frontier.capped.length > 0,
        unreadable: unreadable.length > 0,
        aborted: context.signal.aborted,
      });

      await context.flush();
      await context.setReport(
        describeRun(
          frontier.categories,
          frontier.capped,
          unreadable,
          [...lost.values()].filter((entry) => entry.askedAgain),
          products.size,
          client.loads,
          blocked
        )
      );
      // A blocked crawl returns here too, after the snapshot. The guard's stop
      // aborted the run, so the executor ends it FAILED with its reason and
      // keeps every product it read (plan 0215, section 6.2). Prices already
      // fetched are valid data (plan 0038, section 6.6); what a block costs is
      // the rest of the crawl, not the part that worked.
    } finally {
      // Including when the run aborted, and including when it never opened a
      // page (plan 0090, section 11).
      await client.close();
    }
  }

  /**
   * The client this run drives.
   *
   * **A seam and not a knob.** Chromium is the one thing about this run a test
   * cannot have, so a test hands back a client built on a fake page loader.
   * Nothing in the runtime overrides it.
   */
  protected createClient(
    context: RunContext,
    source: SupermarketSource
  ): CarrefourClient {
    const settings = this.config.getOrThrow<HarvesterConfig>('harvester');
    return new CarrefourClient({
      baseUrl: readBaseUrl(source.config),
      userAgent: settings.userAgent,
      delayMs: readDelay(source.config),
      // The run's own bucket, so the rate the owner set on this row is a rate
      // the source sees on top of the floor the client already keeps.
      acquire: context.acquire,
      guard: context.guard,
      signal: context.signal,
    });
  }

  /**
   * One category, every page of it, into the run's own map.
   *
   * **17,135 is a count of category memberships and not of distinct products**
   * (plan 0090, section 7). A product filed in two frontier categories is
   * listed twice, and the first sighting is the one kept: a product genuinely
   * filed in two places has no one true category, and the first is as good an
   * answer as the last.
   */
  private async pageCategory(
    context: RunContext,
    client: CarrefourClient,
    category: CarrefourCategory,
    products: Map<string, CarrefourProduct>,
    cursor: { page: number }
  ): Promise<void> {
    let seen = 0;
    // The page after the last one that answered is the page that failed, and
    // the one the end pass starts from (plan 0251).
    const walk = client.walkCategory(category, (_listing, page) => {
      cursor.page = page + 1;
    });
    try {
      for await (const product of walk) {
        seen += 1;
        if (!products.has(product.externalId)) {
          products.set(product.externalId, product);
        }
      }
    } finally {
      // **Progress, and a heartbeat with it.** The first crawl reported
      // nothing between the frontier and the snapshot, so an hour of paging
      // looked identical to a run that had stopped, and it was a stopped run
      // that showed it. A category is the smallest unit worth a row: 86 of
      // them over an hour is a number that moves, without a write per page.
      // A category that failed part way counts the listings it did page.
      await context.report({ processed: seen });
    }
  }

  /**
   * The end pass of plan 0251 (D1 a): every category one isolated refusal
   * cost, asked for once more, after every other category, in the order they
   * failed.
   *
   * **This is not the retry plan 0090 section 13 forbids.** That retry asks
   * the refused page again at once, inside the paging loop, which is how a
   * refusal deepens into a block. This is one request per refused category,
   * minutes later, through the same guard and pacing as every other page: a
   * refusal here counts toward the block exactly as one in the walk does, and
   * the block still stops the crawl. A category is paged from the page that
   * failed, and the products it gives are added to the run's map.
   *
   * Only a refusal is asked again. A browser that stopped answering is a
   * different failure, and a node the frontier walk could not open was never
   * paged at all. Answers the block, when one stopped the pass.
   */
  private async askAgain(
    context: RunContext,
    client: CarrefourClient,
    products: Map<string, CarrefourProduct>,
    unreadable: string[],
    lost: ReadonlyMap<string, LostCategory>
  ): Promise<unknown> {
    const refused = [...lost.values()].filter(
      (entry) => entry.error instanceof CarrefourHttpError
    );
    if (refused.length === 0) {
      return null;
    }
    await context.setStage(
      'ENUMERATE',
      `Asking once more for ${refused.length} refused category(ies)`
    );
    for (const entry of refused) {
      if (context.signal.aborted) {
        return null;
      }
      entry.askedAgain = true;
      try {
        await this.pageFrom(context, client, entry, products);
      } catch (error) {
        if (error instanceof SourceBlockedError) {
          this.logger.warn(`Run ${context.runId}: ${String(error)}`);
          return error;
        }
        if (context.signal.aborted) {
          return null;
        }
        // It stays unread, with what cost it the second time.
        this.logger.warn(
          `Run ${context.runId}: category ${entry.category.id} ` +
            `(${entry.category.name}) failed again: ${String(error)}`
        );
        entry.error = error;
        continue;
      }
      // Read this time: it is no longer unread. Its first failure stays
      // counted in `failed`, because that page did fail.
      entry.error = null;
      unreadable.splice(unreadable.indexOf(entry.category.url), 1);
    }
    return null;
  }

  /**
   * One category, from the page that failed to its last.
   *
   * The library's walk always starts at the first page, and a category of
   * 40 pages refused on its 30th need not ask for 29 again. The page reads go
   * through {@link CarrefourClient.readListing}, so the pacing, the session
   * handling and the guard are the walk's own.
   */
  private async pageFrom(
    context: RunContext,
    client: CarrefourClient,
    entry: LostCategory,
    products: Map<string, CarrefourProduct>
  ): Promise<void> {
    const { category } = entry;
    const pages = pagesFor(category.totalResults);
    let seen = 0;
    try {
      for (; entry.page < pages; entry.page += 1) {
        context.signal.throwIfAborted();
        const listing = await client.readListing(
          listingPath(category.id, entry.page * CARREFOUR_PAGE_SIZE)
        );
        if (!listing || listing.cards.length === 0) {
          return;
        }
        for (const product of readCards(listing.cards, category.path)) {
          seen += 1;
          if (!products.has(product.externalId)) {
            products.set(product.externalId, product);
          }
        }
      }
    } finally {
      await context.report({ processed: seen });
    }
  }

  /**
   * Step 3: every product the crawl read, and the price each card printed.
   *
   * **A card with no readable price reports no price** (plan 0090, section 12).
   * Some products are priced by weight and print no figure, and a zero there is
   * a lie about a real product.
   *
   * The EAN is null on every observation, because the listing card carries
   * none. Until the backfill has run, every row resolves through the fuzzy rung
   * of plan 0086 and waits for a person, which is where DEZA sits today.
   *
   * It states no completeness here. A Carrefour crawl walks a frontier of
   * categories, and a product filed nowhere in it is unseen for a reason that
   * says nothing about stock. The crawl is handed over as a whole listing only
   * under the five conditions of {@link declareListing}.
   */
  private reportProducts(
    report: RunReport,
    products: Map<string, CarrefourProduct>
  ): void {
    const observedAt = new Date();
    for (const product of products.values()) {
      report.product({
        externalId: product.externalId,
        name: product.name,
        brand: product.brand,
        // The listing card has none. The detail pass fills it, keyed on the
        // product, and never from here.
        ean: null,
        unitSize: product.unitSize,
        sizeUnit: product.sizeUnit,
        sizeFormat: product.sizeFormat,
        packCount: product.packCount,
        categoryPath: product.categoryPath,
        url: product.path,
        // The card's `images.desktop`, else `images.mobile` (plan 0198).
        imageUrl: photoOf(photoAddressRead(product), product.externalId),
        observedAt,
        extra: null,
        // An empty array is a card with no readable price. Carrefour names no
        // scope of its own, so the one price it states falls to the run's
        // default (plan 0103, section 3.2).
        prices:
          product.priceCents === null && product.unitPriceCents === null
            ? []
            : [
                {
                  scopeKey: null,
                  price: centsToUnits(product.priceCents),
                  currency: 'EUR',
                  // Stored as printed and never recomputed. The field exists so
                  // a shopper can compare, and a derivation that disagrees with
                  // the chain in the last cent is worse than useless.
                  unitPrice: centsToUnits(product.unitPriceCents),
                  unitPriceLabel: product.unitPriceLabel,
                  // A storefront price has no window: it is what the till
                  // charges until the storefront says otherwise.
                  validFrom: null,
                  validUntil: null,
                },
              ],
      });
    }
  }
}

/** A frontier category the crawl did not finish, and what cost it. */
interface LostCategory {
  category: CarrefourCategory;
  /** The page that failed, from 0. The end pass starts there. */
  page: number;
  /** What it failed with, or null once the end pass read it. */
  error: unknown;
  /** Whether the end pass asked for it once more. */
  askedAgain: boolean;
}

/**
 * One `LISTING_UNREAD` per category the crawl did not read (plan 0251).
 *
 * The run still ends `COMPLETED`, and these are what say it is partial. A
 * category that failed part way names the offset it failed at: the listings
 * before it were read and are kept. A node the frontier walk could not open
 * is named by its address, since its name and everything under it were never
 * seen.
 */
function warnUnread(
  context: RunContext,
  unreadable: readonly string[],
  lost: ReadonlyMap<string, LostCategory>
): void {
  for (const url of unreadable) {
    const entry = lost.get(url);
    if (!entry) {
      context.warn(
        listingWarning(
          HarvestWarningCode.LISTING_UNREAD,
          url,
          `The category page ${url} did not answer while the tree was ` +
            `walked, so nothing filed under it was read.`
        )
      );
      continue;
    }
    const { category } = entry;
    const offset = entry.page * CARREFOUR_PAGE_SIZE;
    const cost =
      entry.error instanceof CarrefourHttpError
        ? `Carrefour answered ${entry.error.status}`
        : String(entry.error);
    const again = entry.askedAgain ? ', once more at the end of the run' : '';
    context.warn(
      listingWarning(
        HarvestWarningCode.LISTING_UNREAD,
        category.name,
        `Category ${category.id} ${category.name}: ${cost} at offset ` +
          `${offset}${again}. The listings from there on, of ` +
          `${category.totalResults}, were not read.`
      )
    );
  }
}

/**
 * The crawl as a whole listing of the default scope, or why it is not one
 * (plan 0220, section 15.4).
 *
 * Whole only when the chain's own `delistCountsCrawl` is on, no seed path
 * narrowed the walk, nothing blocked it, no category was capped at the paging
 * ceiling, no category was unreadable, and the run was not aborted. The doubt
 * that remains is a product filed in no frontier category, which nobody has
 * measured: the switch stays off until two clean crawls were compared. A crawl
 * that is not whole declares nothing and is named with the first reason.
 */
function declareListing(
  report: RunReport,
  products: ReadonlyMap<string, CarrefourProduct>,
  crawl: {
    switchOn: boolean;
    seedPath: boolean;
    blocked: boolean;
    truncated: boolean;
    unreadable: boolean;
    aborted: boolean;
  }
): void {
  if (crawl.aborted) {
    return;
  }
  const reason = !crawl.switchOn
    ? 'switch-off'
    : crawl.seedPath
      ? 'seed-path'
      : crawl.blocked
        ? 'blocked'
        : crawl.truncated
          ? 'truncated'
          : crawl.unreadable
            ? 'unreadable'
            : null;
  if (reason !== null) {
    report.listingNotWhole(null, reason);
    return;
  }
  report.listingWhole(null, products.keys());
}

/** What a run has to say about itself beyond its counters. */
function describeRun(
  frontier: readonly CarrefourCategory[],
  capped: readonly CarrefourCappedCategory[],
  unreadable: readonly string[],
  askedAgain: readonly LostCategory[],
  products: number,
  loads: number,
  blocked: unknown
): Record<string, unknown> {
  return {
    frontierCategories: frontier.length,
    listingsInFrontier: frontier.reduce((t, c) => t + c.totalResults, 0),
    distinctProducts: products,
    pageLoads: loads,
    /**
     * **The honest artifact** (plan 0090, section 7). A category over the
     * ceiling with no children cannot be enumerated, none was found on
     * 2026-09-06, and that is a measurement rather than a guarantee. Named
     * rather than counted: "3 categories truncated" tells an operator that
     * something is missing and nothing about what.
     */
    truncatedCategories: capped.map((category) => ({
      id: category.id,
      name: category.name,
      totalResults: category.totalResults,
      path: category.path,
    })),
    unreadableCategories: [...unreadable],
    /**
     * The categories one refusal cost, asked for once more at the end (plan
     * 0251), and whether that read them. A category read the second time is
     * no longer in `unreadableCategories`.
     */
    askedAgain: askedAgain.map((entry) => ({
      id: entry.category.id,
      name: entry.category.name,
      read: entry.error === null,
    })),
    /**
     * Set when the run stopped because the refusals stopped being isolated. It
     * is the difference between a crawl that read the whole frontier and one
     * that read part of it, and no count on this object says which.
     */
    blockedAfter: blocked ? String(blocked) : null,
  };
}

/**
 * Cents to the units `source_entry_prices` stores.
 *
 * The library reads cents because that is what a display string converts to
 * without a rounding decision; the column is a decimal of currency units, as
 * every other source writes.
 */
function centsToUnits(cents: number | null): number | null {
  return cents === null ? null : cents / 100;
}

/**
 * The storefront, from the source row rather than the environment.
 *
 * Plan 0083 deleted the per chain environment variable and put the per chain
 * switch in this same jsonb, for the same reason: a chain that needed a new
 * variable threaded through `app-config.ts`, the config map, `_env.tpl` and
 * both `luna-slot` scripts is a chain nobody can turn on without a deploy.
 */
function readBaseUrl(config: Record<string, unknown>): string | undefined {
  const baseUrl = config['baseUrl'];
  return typeof baseUrl === 'string' && baseUrl.trim() !== ''
    ? baseUrl.trim()
    : undefined;
}

/** Where the walk starts. Any listing page names the first level. */
function readSeedPath(config: Record<string, unknown>): string | undefined {
  const seed = config['seedPath'];
  return typeof seed === 'string' && seed.trim() !== ''
    ? seed.trim()
    : undefined;
}

/**
 * Milliseconds between navigations, overridable per chain on the same row.
 *
 * **The client clamps it up and never down** (plan 0090, section 13). The block
 * escalates and is not instant to clear, so a smaller number here buys a longer
 * outage rather than a shorter run.
 */
function readDelay(config: Record<string, unknown>): number | undefined {
  const delay = Number(config['delayMs']);
  return Number.isFinite(delay) && delay > 0 ? Math.floor(delay) : undefined;
}

/** The scope the prices are written for (plan 0086, section 9). */
function requireScope(priceScopeId: string | undefined): string {
  if (!priceScopeId) {
    throw new Error(
      'This crawl reads a price from every card and has no price scope to ' +
        'write them for. Start it again with one.'
    );
  }
  return priceScopeId;
}
