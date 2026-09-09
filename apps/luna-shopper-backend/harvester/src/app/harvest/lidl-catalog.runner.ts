import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PriceScopeKind } from '@portfolio/luna-shopper/contracts';
import {
  isGroceryCategory,
  LidlClient,
  type LidlListRow,
  type LidlProduct,
} from '@portfolio/luna-shopper/lidl';
import type { HarvesterConfig } from '../config/app-config';
import type { SupermarketSource } from '../entities';
import type { CatalogDiscoveryInput, CatalogRunner } from './catalog-runner';
import type { RunContext } from './run-context';
import type { RunReport } from './run-report';
import type { SourceObservation } from './source-ingest';

/**
 * `CATALOG_DISCOVERY` against the `lidl-api` adapter (plan 0089).
 *
 * The fourth adapter under one mode, and the first that gives an EAN, a price
 * and the window that price is valid for in the same read.
 *
 * **What it walks is not a catalog** (section 2). The site publishes what is on
 * offer this week and next, not what a shop stocks, so one run reaches about a
 * hundred and fifty products and the chain sells several times that. The
 * catalog is built by running every week and keeping what earlier runs found,
 * which is why nothing here deletes a product for being absent from one week,
 * and why no number in the report claims a total for the chain.
 *
 * The order (section 8):
 *
 * 1. `LIST`. Walk the index with an empty query and the in-store filter, five
 *    requests, keeping the rows the coarse category says are groceries.
 * 2. `DETAIL`. One product page per kept row, for the EAN and the region price
 *    map, which the index does not carry. A page that fails costs one product.
 * 3. `INGEST`. Group every observation by the scope its regions resolve to, and
 *    make one call per scope.
 * 4. `REPORT`.
 *
 * **A price belongs to a region and there are 59 of them** (section 4). The run
 * resolves its own scopes from what it reads, so a `priceScopeId` on the
 * request is refused at the spawn rather than silently writing every region's
 * price into one scope.
 */
@Injectable()
export class LidlCatalogRunner implements CatalogRunner {
  private readonly logger = new Logger(LidlCatalogRunner.name);

  constructor(private readonly config: ConfigService) {}

  async run(
    context: RunContext,
    report: RunReport,
    input: CatalogDiscoveryInput,
    source: SupermarketSource
  ): Promise<void> {
    const client = this.createClient(context, source);

    // --- 1. The window ----------------------------------------------------
    await context.setStage('LIST', 'Reading the in-store assortment');
    let listed = 0;
    const grocery: LidlListRow[] = [];
    for await (const row of client.walkInStore()) {
      listed += 1;
      // Section 5. `Food` and `F+V` are the run; the weekly bazar, the plants
      // and the online shop a shop happens to stock are not.
      if (isGroceryCategory(row.siteCategory)) {
        grocery.push(row);
      }
    }
    await context.setTotalPlanned(grocery.length);
    this.logger.log(
      `Run ${context.runId}: ${listed} in-store row(s), of which ` +
        `${grocery.length} are groceries`
    );

    // --- 2. One page each, for the EAN and the regions --------------------
    await context.setStage(
      'DETAIL',
      `Reading ${grocery.length} product page(s)`
    );
    const products: LidlProduct[] = [];
    const unreadable: string[] = [];
    for (const row of grocery) {
      context.signal.throwIfAborted();
      try {
        const product = await client.getProduct(row);
        if (product) {
          products.push(product);
        } else {
          // Section 8: a page that fails names the product and costs that one
          // product. 152 written is worth more than a run that failed on one.
          unreadable.push(row.externalId);
          await context.report({ failed: 1 });
        }
      } catch (error) {
        this.logger.warn(
          `Run ${context.runId}: product ${row.externalId} failed: ${String(error)}`
        );
        unreadable.push(row.externalId);
        await context.report({ failed: 1 });
      }
    }

    // --- 3. Declare the regions, then report every product -----------------
    //
    // **The run declares its regions and creates none** (plan 0103, section
    // 6.4). Scope creation used to live here and again in the store discovery
    // runner, which meant no other runner could create one and the ingest could
    // not create one at all. Declaring is all a source can honestly do: it says
    // what it named, and the orchestrator decides what that is in catalog.
    await context.setStage('INGEST', `Recording ${products.length} product(s)`);
    const regions = declareRegions(report, products);
    this.reportProducts(report, products);

    await context.flush();
    await context.setReport(
      describeRun(
        listed,
        grocery.length,
        products,
        unreadable,
        regions,
        client.requests
      )
    );
  }

  /**
   * The client this run drives.
   *
   * **A seam and not a knob.** A test hands back a client built on a fake
   * fetch; nothing in the runtime overrides it.
   */
  protected createClient(
    context: RunContext,
    source: SupermarketSource
  ): LidlClient {
    const settings = this.config.getOrThrow<HarvesterConfig>('harvester');
    return new LidlClient({
      userAgent: settings.userAgent,
      baseUrl: readString(source.config, 'baseUrl'),
      storesApiKey: settings.lidlStoresApiKey,
      // The run's own bucket, so the rate the owner set on this row is the rate
      // the source sees. The walk is a URL shape `robots.txt` disallows, which
      // is why the limit is treated as a real constraint (section 10).
      acquire: context.acquire,
      signal: context.signal,
    });
  }

  /**
   * Step 3: every product, with every price it publishes.
   *
   * **One pass, not one per scope** (plan 0103, D5, reversing plan 0089 section
   * 8). A price carries the region it is for, so the week's 59 regions travel
   * with their products instead of being grouped into roughly 54 ingest calls
   * of the same 132 products. Widening the ingest was refused while it could
   * hold one scope, for the reason that it changed a contract every caller used
   * to save 53 batched calls a week. That reasoning was right for a plan whose
   * job was LIDL and wrong for a plan whose job is the contract.
   *
   * **A product with no price is still reported** (section 8.1). 21 of the
   * week's products are in the window with no price at all, and the catalog is
   * allowed to know the article exists.
   */
  private reportProducts(
    report: RunReport,
    products: readonly LidlProduct[]
  ): void {
    for (const product of products) {
      report.product(observationOf(product));
    }
  }
}

/**
 * Every offer region the run saw, declared once each (plan 0089, section 4).
 *
 * **One scope per region, at the granularity the source publishes at.**
 * Collapsing the regions that agree this week into two or three groups reads as
 * an obvious simplification and cannot store next week's disagreement, so the
 * scope stays as fine as the price map is.
 *
 * Declaring is all the run does. Whether catalog already holds the region, and
 * what to do when it does not, is the orchestrator's (plan 0103, section 3).
 */
function declareRegions(
  report: RunReport,
  products: readonly LidlProduct[]
): string[] {
  const seen = new Map<string, string | null>();
  for (const product of products) {
    for (const price of product.prices) {
      for (const region of price.regions) {
        if (seen.has(region.id)) {
          continue;
        }
        seen.set(region.id, region.name ?? null);
        report.scope({
          key: region.id,
          // A LIDL offer region is not a postal code and not a shop: it is a
          // group of shops the chain prices together and names itself.
          kind: PriceScopeKind.REGION,
          name: region.name ?? null,
        });
      }
    }
  }
  return [...seen.keys()];
}

/**
 * One product as LIDL described it, with every price it publishes.
 *
 * **A price per offer region, and there are 59 of them** (plan 0089, section 4).
 * A price the chain states for several regions becomes one entry per region,
 * each naming that region as its scope, because the format allows a different
 * price per region and a model that collapsed the ones that agree this week
 * could not store the week one of them differs.
 *
 * Each price is verbatim. `unitPrice` is null: LIDL publishes no per kilogram
 * figure, and deriving one from the printed size would disagree with the chain
 * in the last cent on the field whose only purpose is comparison.
 */
function observationOf(product: LidlProduct): SourceObservation {
  return {
    externalId: product.externalId,
    name: product.name,
    brand: product.brand,
    ean: product.ean,
    unitSize: product.unitSize,
    sizeFormat: product.sizeFormat,
    categoryPath: product.categoryPath,
    url: product.url,
    observedAt: product.observedAt,
    // Stored, shown in the queue and never interpreted. The short code is
    // LIDL's own number for a weight item, and the aisle is a proposal a person
    // reads: neither may be written as an identifier or as a decision.
    extra: extraOf(product),
    prices: product.prices.flatMap((price) =>
      price.regions.map((region) => ({
        // The chain's own id for the offer region, which is what a scope is
        // resolved by: it survives a move to another cluster, and a uuid does
        // not (plan 0103, D3).
        scopeKey: region.id,
        price: price.price,
        currency: price.currency,
        unitPrice: null,
        unitPriceLabel: null,
        // The window the chain published, kept as it stated it. Next week's
        // prices arrive with a start date in the future and are written with
        // it: plan 0080 decides on read whether a price applies.
        validFrom: price.validFrom,
        validUntil: price.validUntil,
      }))
    ),
  };
}

function extraOf(product: LidlProduct): Record<string, unknown> | null {
  const extra: Record<string, unknown> = { category: product.category };
  if (product.shortCode) {
    extra['shortCode'] = product.shortCode;
  }
  if (product.ian) {
    extra['ian'] = product.ian;
  }
  return extra;
}

/**
 * What the run has to say about itself beyond its counters (section 8.1).
 *
 * **No number here claims a total for the chain.** The site publishes no
 * assortment, only a window, and a probe of 105 grocery terms found nothing the
 * empty query had not already returned. `listed` and `grocery` are counts of
 * what this window held, and they are named so they cannot be read as a census.
 */
function describeRun(
  listed: number,
  grocery: number,
  products: readonly LidlProduct[],
  unreadable: readonly string[],
  regions: readonly string[],
  requests: number
): Record<string, unknown> {
  const observations = products.reduce(
    (total, product) => total + product.prices.length,
    0
  );
  const priced = products.filter((product) => product.prices.length > 0);
  const window = validityWindow(products);

  return {
    window,
    listed,
    grocery,
    detailRead: products.length,
    detailFailed: unreadable.length,
    /** The products a page could not be read for, by id, not only counted. */
    unreadableProducts: [...unreadable],
    priced: priced.length,
    unpriced: products.length - priced.length,
    withEan13: products.filter((product) => product.ean !== null).length,
    regionsSeen: regions.length,
    /**
     * The regions this run declared, by the chain's own key.
     *
     * Which of them catalog already held and which had to be created is the
     * orchestrator's to say now (plan 0103, section 3), so it is written on the
     * run beside this rather than counted here from scopes the runner made.
     */
    regionsDeclared: [...regions],
    observations,
    /** Products whose price is not the same in every region that stocks them. */
    regionallyPriced: products.filter(
      (product) => new Set(product.prices.map((price) => price.price)).size > 1
    ).length,
    requests,
  };
}

/** The earliest and latest validity the run saw, as ISO instants. */
function validityWindow(products: readonly LidlProduct[]): {
  from: string | null;
  to: string | null;
} {
  let from: Date | null = null;
  let to: Date | null = null;
  for (const product of products) {
    for (const price of product.prices) {
      if (price.validFrom && (!from || price.validFrom < from)) {
        from = price.validFrom;
      }
      if (price.validUntil && (!to || price.validUntil > to)) {
        to = price.validUntil;
      }
    }
  }
  return { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null };
}

/**
 * A setting from the source row rather than the environment (plan 0083).
 *
 * A chain that needed a new environment variable threaded through
 * `app-config.ts`, the config map, `_env.tpl` and both `luna-slot` scripts is a
 * chain nobody can configure without a deploy.
 */
function readString(
  config: Record<string, unknown>,
  key: string
): string | undefined {
  const value = config[key];
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined;
}
