import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PriceScopeKind,
  PriceSourceKind,
  type PriceScopeView,
} from '@portfolio/luna-shopper/contracts';
import {
  isGroceryCategory,
  LidlClient,
  type LidlListRow,
  type LidlProduct,
} from '@portfolio/luna-shopper/lidl';
import type { HarvesterConfig } from '../config/app-config';
import type { SupermarketSource } from '../entities';
import { CatalogClient } from './catalog-client.service';
import type { CatalogDiscoveryInput, CatalogRunner } from './catalog-runner';
import type { RunContext } from './run-context';
import { SourceIngest, type SourceObservation } from './source-ingest';

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

  constructor(
    private readonly ingest: SourceIngest,
    private readonly catalog: CatalogClient,
    private readonly config: ConfigService
  ) {}

  async run(
    context: RunContext,
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

    // --- 3. The scopes, then one ingest call each --------------------------
    await context.setStage('INGEST', `Recording ${products.length} product(s)`);
    const scopes = await this.resolveScopes(input.supermarketId, products);
    await this.writeSnapshot(context, input, products, scopes);

    await context.flush();
    await context.setReport(
      report(
        listed,
        grocery.length,
        products,
        unreadable,
        scopes,
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
   * Every region the run saw, as a price scope, created on first sight.
   *
   * **One scope per region, at the granularity the source publishes at**
   * (section 4). Collapsing the regions that agree this week into two or three
   * groups reads as an obvious simplification and cannot store next week's
   * disagreement, so the scope stays as fine as the price map is.
   *
   * A region a store discovery run already met has its scope; a region met here
   * first gets one created, which is why the two runs have a recommended order
   * rather than a hard one.
   */
  private async resolveScopes(
    supermarketId: string,
    products: readonly LidlProduct[]
  ): Promise<Map<string, ScopeRef>> {
    const held = await this.loadScopes(supermarketId);
    const scopes = new Map<string, ScopeRef>();

    for (const product of products) {
      for (const price of product.prices) {
        for (const region of price.regions) {
          if (scopes.has(region.id)) {
            continue;
          }
          const existing = held.get(region.id);
          if (existing) {
            scopes.set(region.id, { id: existing.id, created: false });
            continue;
          }
          const created = await this.catalog.createPriceScope(
            supermarketId,
            // A LIDL offer region is not a postal code and not a shop: it is a
            // group of shops the chain prices together and names itself.
            PriceScopeKind.REGION,
            region.id,
            region.name ? { es: region.name, en: region.name } : null
          );
          held.set(region.id, created);
          scopes.set(region.id, { id: created.id, created: true });
        }
      }
    }
    return scopes;
  }

  private async loadScopes(
    supermarketId: string
  ): Promise<Map<string, PriceScopeView>> {
    const held = new Map<string, PriceScopeView>();
    let cursor: string | undefined;
    do {
      const page = await this.catalog.listPriceScopes(supermarketId, cursor);
      for (const scope of page.items) {
        if (scope.externalKey) {
          held.set(scope.externalKey, scope);
        }
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return held;
  }

  /**
   * Step 3: one ingest call per scope, carrying every product priced in it.
   *
   * `SourceIngest.ingest` takes a single `priceScopeId`, so the run groups its
   * observations by scope rather than calling once per product: that is about
   * 54 calls of roughly 132 products each, not 54 times 132 calls. Widening the
   * ingest to take several scopes for one set of observations would turn those
   * 54 into one, and it is deliberately not done here, because it changes a
   * contract every existing caller uses for a saving of 53 batched calls a
   * week (section 4).
   *
   * **A product with no price is still ingested** (section 8.1). 21 of the
   * week's products are in the window with no price at all, and the catalog is
   * allowed to know the article exists.
   */
  private async writeSnapshot(
    context: RunContext,
    input: CatalogDiscoveryInput,
    products: readonly LidlProduct[],
    scopes: ReadonlyMap<string, ScopeRef>
  ): Promise<void> {
    /** priceScopeId -> the observations that scope pays for. */
    const byScope = new Map<string, SourceObservation[]>();
    const unpriced: SourceObservation[] = [];

    for (const product of products) {
      if (product.prices.length === 0) {
        unpriced.push(observationOf(product, null));
        continue;
      }
      for (const price of product.prices) {
        const observation = observationOf(product, price.priceId);
        for (const region of price.regions) {
          const scope = scopes.get(region.id);
          if (!scope) {
            continue;
          }
          const held = byScope.get(scope.id);
          if (held) {
            held.push(observation);
          } else {
            byScope.set(scope.id, [observation]);
          }
        }
      }
    }

    for (const [priceScopeId, observations] of byScope) {
      context.signal.throwIfAborted();
      await this.ingest.ingest(context, {
        supermarketId: input.supermarketId,
        priceScopeId,
        // A JSON service the chain publishes, which is what OFFICIAL_API means.
        sourceKind: PriceSourceKind.OFFICIAL_API,
        observations,
      });
    }

    if (unpriced.length > 0) {
      // No scope, because there is no price to write one for. The row still
      // exists, which is the point: the catalog learns the article.
      await this.ingest.ingest(context, {
        supermarketId: input.supermarketId,
        priceScopeId: null,
        sourceKind: PriceSourceKind.OFFICIAL_API,
        observations: unpriced,
      });
    }
  }
}

/** A scope this run wrote for, and whether the run had to create it. */
interface ScopeRef {
  id: string;
  created: boolean;
}

/**
 * One product as LIDL described it, for one of its prices.
 *
 * The price is the one the group states, verbatim. `unitPrice` is null: LIDL
 * publishes no per kilogram figure, and deriving one from the printed size
 * would disagree with the chain in the last cent on the field whose only
 * purpose is comparison.
 */
function observationOf(
  product: LidlProduct,
  priceId: string | null
): SourceObservation {
  const price = product.prices.find((entry) => entry.priceId === priceId);
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
    price: price
      ? {
          price: price.price,
          currency: price.currency,
          unitPrice: null,
          unitPriceLabel: null,
          // The window the chain published, kept as it stated it. Next week's
          // prices arrive with a start date in the future and are written with
          // it: plan 0080 decides on read whether a price applies.
          validFrom: price.validFrom,
          validUntil: price.validUntil,
        }
      : null,
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
function report(
  listed: number,
  grocery: number,
  products: readonly LidlProduct[],
  unreadable: readonly string[],
  scopes: ReadonlyMap<string, ScopeRef>,
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
    regionsSeen: scopes.size,
    scopesWritten: scopes.size,
    /** Regions this run had to create a scope for, which store discovery had not. */
    scopesCreated: [...scopes.entries()]
      .filter(([, scope]) => scope.created)
      .map(([regionId]) => regionId),
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
