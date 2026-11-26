import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PriceScopeKind,
  sourceSizeUnitOf,
} from '@portfolio/luna-shopper/contracts';
import {
  isGroceryCategory,
  LidlClient,
  photoAddressRead,
  type LidlListRow,
  type LidlProduct,
} from '@portfolio/luna-shopper/lidl';
import type { HarvesterConfig } from '../config/app-config';
import type { SupermarketSource } from '../entities';
import type { CatalogDiscoveryInput, CatalogRunner } from './catalog-runner';
import { photoOf } from './photo-address';
import type { RunContext } from './run-context';
import type { RunReport } from './run-report';
import type {
  SourceObservation,
  SourceObservationPrice,
} from './source-ingest';

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
 *    A product goes to the sink as soon as its page answers, after the
 *    regions it names that the run has not declared yet (plan 0267). The sink
 *    writes a chunk each time `PRODUCT_CHUNK` (400) products wait. For LIDL,
 *    whose walk is about a hundred and fifty products, the chunk that is not
 *    full is the whole walk, so it is written when the run drains. What a
 *    walk that ends early keeps depends on how it ends:
 *    - The process dies: the walk keeps the chunks the sink had written, less
 *      what was still queued or in flight in it.
 *    - The runner throws with no abort: the executor settles the sink, which
 *      lets the queued chunks finish and writes no partial chunk. What is
 *      lost is the chunk that never filled, which for LIDL is the whole walk.
 *    - A person or a deploy aborts the run: the executor drains the sink,
 *      which writes the partial chunk too, and every path call goes as `ADD`.
 *    The paths of the walk are written only by the drain, after the last
 *    chunk, so only an aborted or completed run writes any.
 * 3. `INGEST`. Every path of each product read (plan 0268), then the sink
 *    writes the last chunk when the run drains.
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
    /**
     * Every product whose page answered, in the order it answered. Each one
     * went to the sink at that moment (plan 0267, section 5), so this is kept
     * only for what reads the whole walk at the end: its category paths (plan
     * 0268) and {@link describeRun}.
     */
    const products: LidlProduct[] = [];
    /** Every offer region declared so far, by key, with its first name. */
    const regions = new Map<string, string | null>();
    const unreadable: string[] = [];
    for (const row of grocery) {
      // An abort, a person's or the refusal guard's (plan 0215), ends the
      // reading and not the run. Every product read before it was already
      // reported, and is valid data.
      if (context.signal.aborted) {
        break;
      }
      try {
        const product = await client.getProduct(row);
        if (product) {
          products.push(product);
          reportProduct(report, regions, product);
        } else {
          // Section 8: a page that fails names the product and costs that one
          // product. 152 written is worth more than a run that failed on one.
          unreadable.push(row.externalId);
          await context.report({ failed: 1 });
        }
      } catch (error) {
        // The page the abort cut short is not a failed product.
        if (context.signal.aborted) {
          break;
        }
        this.logger.warn(
          `Run ${context.runId}: product ${row.externalId} failed: ${String(error)}`
        );
        unreadable.push(row.externalId);
        await context.report({ failed: 1 });
      }
    }

    // --- 3. What only the whole walk can say -------------------------------
    // Every product and every region went to the sink as its page answered
    // (plan 0267, section 5). The paths of each product follow, once a
    // product, before the run flushes and the sink drains (plan 0268). The
    // sink writes what is left of the last chunk when the run drains.
    reportCategoryPaths(report, products, context.signal);
    await context.setStage(
      'INGEST',
      `Finishing the walk: ${products.length} product(s) read, each full ` +
        'chunk written as it filled and the rest written now'
    );

    await context.flush();
    await context.setReport(
      describeRun(
        listed,
        grocery.length,
        products,
        unreadable,
        [...regions.keys()],
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
      guard: context.guard,
      signal: context.signal,
    });
  }
}

/**
 * One product, as soon as its page answered (plan 0267, section 5): first each
 * of its offer regions the run has not declared yet, then the product itself.
 *
 * **The region is declared before any price refers to it** (plan 0103, D4).
 * The sink runs its writes in the order they were said, so a declaration made
 * here is resolved before the chunk that holds this product is written.
 *
 * **The run declares its regions and creates none** (plan 0103, section 6.4).
 * Declaring is all a source can honestly do: it says what it named, and the
 * orchestrator decides what that is in catalog.
 *
 * **One scope per region, at the granularity the source publishes at** (plan
 * 0089, section 4), declared once, named by its first sighting. Collapsing the
 * regions that agree this week into two or three groups reads as an obvious
 * simplification and cannot store next week's disagreement.
 *
 * **One pass, not one per scope** (plan 0103, D5). A price carries the region
 * it is for, so the regions travel with their products.
 *
 * **A product with no price is still reported** (plan 0089, section 8.1). Some
 * of the week's products are in the window with no price at all, and the
 * catalog is allowed to know the article exists.
 */
function reportProduct(
  report: RunReport,
  declared: Map<string, string | null>,
  product: LidlProduct
): void {
  for (const price of product.prices) {
    for (const region of price.regions) {
      if (declared.has(region.id)) {
        continue;
      }
      declared.set(region.id, region.name ?? null);
      report.scope({
        key: region.id,
        // A LIDL offer region is not a postal code and not a shop: it is a
        // group of shops the chain prices together and names itself.
        kind: PriceScopeKind.REGION,
        name: region.name ?? null,
      });
    }
  }
  report.product(observationOf(product));
}

/**
 * Every category path of each product the walk read (plan 0268, section 3),
 * once a product, at the end of the walk.
 *
 * **`REPLACE` when the page stated its paths, else `ADD`.** A product's paths
 * are read from its own page, all at once: the need world path and the
 * `wonCategoryBreadcrumbs` list of the online shop tree. A page that states
 * a need world path and a list that is not empty and is read in full has
 * said where the chain files the product now, so a stored path it does not
 * name no longer holds. Anything less has disproved nothing, and says
 * `ADD`: a path taken from the index row, a page that left the list out, an
 * empty list (owner decision 95b), or a list with a part that could not be
 * read. `categoryPathsStated` of the product holds that test. The index
 * row's paths are among a product's paths only when the page's list was not
 * read in full (owner decisions 101b and 115b), so they always go as `ADD`.
 *
 * **The rolling window does not change that.** What LIDL publishes is a week
 * of offers, so a run proves nothing about a product it did not meet, and
 * such a product gets no call: its stored paths stay as they are. The window
 * decides which products a run reads, not which paths a product it read has.
 *
 * A product whose page did not answer was not reported and gets no call. An
 * aborted run says `ADD`, and the sink would make it so anyway.
 */
function reportCategoryPaths(
  report: RunReport,
  products: readonly LidlProduct[],
  signal: AbortSignal
): void {
  for (const product of products) {
    if (product.categoryPaths.length === 0) {
      continue;
    }
    report.categoryPaths(
      product.externalId,
      product.categoryPaths,
      !signal.aborted && product.categoryPathsStated ? 'REPLACE' : 'ADD'
    );
  }
}

/**
 * One product as LIDL described it, with every price it publishes.
 *
 * **A price per offer region, and there are 59 of them** (plan 0089, section 4).
 * A price the chain states for several regions becomes one entry per region,
 * each naming that region as its scope, because the format allows a different
 * price per region and a model that collapsed the ones that agree this week
 * could not store the week one of them differs. {@link lidlObservationPrices}
 * says what each figure is.
 *
 * **It never says a product is sold by weight (plan 0181).** The payload has
 * no field for it. In the captured fixtures a price block carries `price`,
 * `packaging.text` and a `basePrice` that is `{ prefix: false }` on every
 * product, with no amount and no unit. The eight digit code LIDL keeps for a
 * weight item does not say it either: `product-short-code.json` carries one
 * and prints a fixed `400 g`. So the row is left as it is, and a person
 * decides the unit when the product is created. A `ca.` week priced by the
 * kilo (owner decision 141a) does not change that either: the flag would
 * flip every week on a product the chain sells as a piece.
 *
 * **It does state the weight of a tray printed `Aprox.`** (plan 0244, section
 * 5.2). LIDL prints one price for that tray and none per kilo, so it is a
 * piece priced as one: no size, the weight, and not sold by weight. A week
 * printed with a range of any prefix states no weight, so the stored one
 * stays (owner decisions 141a and 144).
 *
 * **A page that prints no format states no size** (owner decision 143a).
 * LIDL prints the format only inside a price block, so a week that prices a
 * product nowhere prints none for it. The format, the size, its unit, the
 * weight and the count, which are all read out of the format, are then
 * absent rather than null, and the ingest leaves the stored ones alone
 * ("Empanada de atún" lost its `500 g` to a null before the decision). The
 * product is still reported whole (plan 0089, section 8.1): a new one is
 * created, and a known one has its name, brand, EAN, address and `extra`
 * rewritten as any week rewrites them.
 */
function observationOf(product: LidlProduct): SourceObservation {
  const formatted = product.sizeFormat !== null;
  return {
    externalId: product.externalId,
    name: product.name,
    brand: product.brand,
    ean: product.ean,
    ...(formatted
      ? {
          unitSize: product.unitSize,
          // The unit the adapter converted the printed size into (plan 0177):
          // `75cl` is 750 here and `1,28 l` is 1.28, and this is what says
          // which is which.
          sizeUnit:
            product.unitSize === null ? null : sourceSizeUnitOf(product.unit),
          // `Aprox. 350 g` (plan 0244, section 5.2): a tray priced as one
          // piece. The adapter answers the grams here and no size, the price
          // is the tray's, and the row is not sold by weight. A printed range
          // parses to no size and states no weight: undefined, which leaves
          // the stored weight alone (owner decisions 141a and 144).
          approxWeight: product.approxWeight,
          sizeFormat: product.sizeFormat,
          packCount: product.packCount,
        }
      : {}),
    soldByWeight: false,
    categoryPath: product.categoryPath,
    url: product.url,
    // The search row's `image`, else the first of its `imageList` (plan
    // 0198).
    imageUrl: photoOf(photoAddressRead(product), product.externalId),
    observedAt: product.observedAt,
    // Stored, shown in the queue and never interpreted. The short code is
    // LIDL's own number for a weight item, and the aisle is a proposal a person
    // reads: neither may be written as an identifier or as a decision. A
    // range whose figure a person decides is named here too (owner decision
    // 144).
    extra: extraOf(product),
    prices: lidlObservationPrices(product),
  };
}

/**
 * Every price of one product, one entry per offer region, as the walk and a
 * one product refresh both write them.
 *
 * **Each figure is verbatim, and the block says what it is the price of.** A
 * block printed with a size or an `Aprox.` weight prints the price of the
 * piece, and LIDL prints no figure per kilo beside it: `unitPrice` is null,
 * because deriving one from the printed size would disagree with the chain in
 * the last cent on the field whose only purpose is comparison.
 *
 * **A block printed with a `ca.` weight range prints the price of a kilo**
 * (owner decisions 141a and 144). `ca.220-360g` at 21.99 one week and
 * `Aprox.300 g` at 6.60 the next are one sea bass fillet. So that figure is
 * the unit price, under the label `kg`, and the piece price is null: a
 * shopper sees no LIDL price that week rather than a wrong one. **No piece
 * price is derived from the weight** (the owner refused that, option b of
 * decision 141a).
 *
 * **A block printed with any other range keeps its figure as the piece
 * price** (owner decision 144), as before decision 141a: nothing proves an
 * `Aprox. 360-460g` figure is per kilo. `extraOf` names the range for a
 * person and the curator, and the run report lists the product.
 */
export function lidlObservationPrices(
  product: LidlProduct
): SourceObservationPrice[] {
  return product.prices.flatMap((price) =>
    price.regions.map((region) => ({
      // The chain's own id for the offer region, which is what a scope is
      // resolved by: it survives a move to another cluster, and a uuid does
      // not (plan 0103, D3).
      scopeKey: region.id,
      price: price.perKilo ? null : price.price,
      currency: price.currency,
      unitPrice: price.perKilo ? price.price : null,
      unitPriceLabel: price.perKilo ? 'kg' : null,
      // The window the chain published, kept as it stated it. Next week's
      // prices arrive with a start date in the future and are written with
      // it: plan 0080 decides on read whether a price applies.
      validFrom: price.validFrom,
      validUntil: price.validUntil,
    }))
  );
}

function extraOf(product: LidlProduct): Record<string, unknown> | null {
  // The leaf the need world path resolved to, or null (plan 0166, section 7).
  // Kept as a note beside the row, which is all it ever was: the product is
  // placed from `categoryPath` when it is created, and nothing reads this.
  const extra: Record<string, unknown> = {
    categorySlug: product.categorySlug,
  };
  if (product.shortCode) {
    extra['shortCode'] = product.shortCode;
  }
  if (product.ian) {
    extra['ian'] = product.ian;
  }
  const toReview = rangesToReview(product);
  if (toReview.length > 0) {
    extra[PRICE_BASIS_TO_REVIEW] = toReview.join(', ');
  }
  return extra;
}

/**
 * The key of `extra` that names a range whose figure a person decides (owner
 * decision 144): the printed ranges, verbatim, such as `Aprox. 360-460g`.
 *
 * The figure beside such a range was written as the price of the piece, and
 * it may be the price of a kilo: on `ca.` ranges it is, and nothing measured
 * says which it is beside `Aprox.` or no prefix. The queue shows the key on
 * the row, and the curation packet carries `extra` to the model. Nothing in
 * the harvester reads it.
 */
export const PRICE_BASIS_TO_REVIEW = 'priceBasisToReview';

/** The printed ranges of a product's blocks whose figure a person decides. */
function rangesToReview(product: LidlProduct): string[] {
  const printed = new Set<string>();
  for (const price of product.prices) {
    if (price.basisToReview) {
      printed.add(price.sizeFormat ?? product.sizeFormat ?? '');
    }
  }
  printed.delete('');
  return [...printed];
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
    /**
     * The products priced beside a weight range that does not start with
     * `ca.` (owner decision 144), by id, with the name and the range. Each
     * figure was written as the price of the piece, and a person or the
     * curator decides whether it is. The row carries the same range under
     * `extra.priceBasisToReview`.
     */
    pricesToReview: products.flatMap((product) => {
      const ranges = rangesToReview(product);
      return ranges.length === 0
        ? []
        : [
            {
              externalId: product.externalId,
              name: product.name,
              sizeFormat: ranges.join(', '),
            },
          ];
    }),
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
