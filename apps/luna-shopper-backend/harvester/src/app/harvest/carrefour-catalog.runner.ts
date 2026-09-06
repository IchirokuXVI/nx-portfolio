import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CarrefourClient,
  type CarrefourCappedCategory,
  type CarrefourCategory,
  type CarrefourProduct,
} from '@portfolio/luna-shopper/carrefour';
import { PriceSourceKind } from '@portfolio/luna-shopper/contracts';
import type { HarvesterConfig } from '../config/app-config';
import type { SupermarketSource } from '../entities';
import type { CatalogDiscoveryInput, CatalogRunner } from './catalog-runner';
import type { RunContext } from './run-context';
import { SourceIngest, type SourceObservation } from './source-ingest';

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

  constructor(
    private readonly ingest: SourceIngest,
    private readonly config: ConfigService
  ) {}

  async run(
    context: RunContext,
    input: CatalogDiscoveryInput,
    source: SupermarketSource
  ): Promise<void> {
    const priceScopeId = requireScope(input.priceScopeId);
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
      for (const category of frontier.categories) {
        context.signal.throwIfAborted();
        try {
          await this.pageCategory(client, category, products);
        } catch (error) {
          // A category that fails does not fail the run. It is counted, logged
          // and named in the report, which is the same shape an unreadable node
          // produces and reads the same way to an operator.
          this.logger.warn(
            `Run ${context.runId}: category ${category.id} (${category.name}) ` +
              `failed: ${String(error)}`
          );
          unreadable.push(category.url);
          await context.report({ failed: 1 });
        }
      }

      // --- 3. The rows, the ladder and the prices --------------------------
      await context.setStage('INGEST', `Recording ${products.size} product(s)`);
      await this.writeSnapshot(context, input, priceScopeId, products);

      await context.flush();
      await context.setReport(
        report(
          frontier.categories,
          frontier.capped,
          unreadable,
          products.size,
          client.loads
        )
      );
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
    client: CarrefourClient,
    category: CarrefourCategory,
    products: Map<string, CarrefourProduct>
  ): Promise<void> {
    for await (const product of client.walkCategory(category)) {
      if (!products.has(product.externalId)) {
        products.set(product.externalId, product);
      }
    }
  }

  /**
   * Step 3: the rows, the ladder and the price each card printed.
   *
   * **A card with no readable price writes an entry and no price row** (plan
   * 0090, section 12). Some products are priced by weight and print no figure,
   * and a zero there is a lie about a real product.
   *
   * The EAN is null on every observation, because the listing card carries
   * none. Until the backfill has run, every row resolves through the fuzzy rung
   * of plan 0086 and waits for a person, which is where DEZA sits today.
   */
  private async writeSnapshot(
    context: RunContext,
    input: CatalogDiscoveryInput,
    priceScopeId: string,
    products: Map<string, CarrefourProduct>
  ): Promise<void> {
    const observedAt = new Date();
    const observations: SourceObservation[] = [...products.values()].map(
      (product) => ({
        externalId: product.externalId,
        name: product.name,
        brand: product.brand,
        // The listing card has none. The detail pass fills it, keyed on the
        // product, and never from here.
        ean: null,
        unitSize: product.unitSize,
        sizeFormat: product.sizeFormat,
        categoryPath: product.categoryPath,
        url: product.path,
        observedAt,
        extra: null,
        price:
          product.priceCents === null && product.unitPriceCents === null
            ? null
            : {
                price: centsToUnits(product.priceCents),
                currency: 'EUR',
                // Stored as printed and never recomputed. The field exists so a
                // shopper can compare, and a derivation that disagrees with the
                // chain in the last cent is worse than useless.
                unitPrice: centsToUnits(product.unitPriceCents),
                unitPriceLabel: product.unitPriceLabel,
                // A storefront price has no window: it is what the till charges
                // until the storefront says otherwise.
                validFrom: null,
                validUntil: null,
              },
      })
    );

    await this.ingest.ingest(context, {
      supermarketId: input.supermarketId,
      priceScopeId,
      // A page the chain publishes, which is what `OFFICIAL_WEB` means.
      sourceKind: PriceSourceKind.OFFICIAL_WEB,
      observations,
    });
  }
}

/** What a run has to say about itself beyond its counters. */
function report(
  frontier: readonly CarrefourCategory[],
  capped: readonly CarrefourCappedCategory[],
  unreadable: readonly string[],
  products: number,
  loads: number
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
