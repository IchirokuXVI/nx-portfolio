import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PriceScopeKind } from '@portfolio/luna-shopper/contracts';
import {
  MercadonaClient,
  type MercadonaListProduct,
} from '@portfolio/luna-shopper/mercadona';
import type { HarvesterConfig } from '../config/app-config';
import type { SupermarketSource } from '../entities';
import { runWorkerPool } from '../runner/worker-pool';
import type {
  CatalogDiscoveryInput,
  CatalogRunner,
  RunPriceScope,
} from './catalog-runner';
import type { RunContext } from './run-context';
import type { RunReport } from './run-report';

/**
 * `CATALOG_DISCOVERY` against the `mercadona-api` adapter (plan 0038, section
 * 6.2; several warehouses in one run since plan 0108). The expensive one.
 *
 * 1. Walk the category tree once per warehouse: **151 requests each**. This is
 *    where the prices come from, and where that warehouse's assortment comes
 *    from.
 * 2. Fetch detail once per product **ever seen across the warehouses**, to
 *    capture `ean` and `brand`: about **4,232 requests** whether the run covers
 *    one warehouse or two hundred.
 * 3. Report each product once, carrying one price per warehouse that listed it.
 * 4. Say, per warehouse, that its walk was whole, so the orchestrator can work
 *    out what that warehouse does not carry.
 *
 * **The warehouse is the scope's own `externalKey`** (plan 0108, D1). It used to
 * be `source.config.warehouse`, chosen independently of the scope the spawn was
 * given, and nothing compared the two: a source configured for `4661` started
 * with the scope keyed `4804` walked Córdoba and wrote those prices onto A
 * Coruña's scope, with no error and nothing in the report to show it. There is
 * one input now, so the mismatch is unrepresentable.
 *
 * **It fetches and reports, and holds nothing else** (plan 0103, section 2.1).
 * It used to hold a `Repository<SourceCatalogEntry>`, a `CatalogClient` and a
 * `SourceIngest`, and used all three: the repository to find the tracked
 * products it had not seen, the client to write their availability, and the
 * ingest to write the rows. All three are the orchestrator's now, and what is
 * left is the half that is different for every source.
 *
 * **The walk writes the price it fetched** (plan 0086, D4). It always had it, on
 * every one of those 4,232 details, and it used to put the number on a snapshot
 * row and nowhere a shopper reads; a second run mode existed to fetch the same
 * products again for the same numbers. That mode is deleted and this is where its
 * work went.
 *
 * **Why `es` only.** Fetching both languages doubles the run. The row exists for
 * matching and for the queue, and the Spanish name serves both. The English name
 * is needed only when an `Item` is actually created, so it is fetched then, for
 * that one product.
 *
 * **Why it is a background job.** The run is not latency bound, it is politeness
 * bound: at 4 requests per second those 4,383 requests take about 18 minutes, and
 * a run of all 255 warehouses is about three hours rather than the seventy six a
 * run each would cost. Raising the worker count shortens nothing on its own,
 * because the rate limit is what binds.
 */
@Injectable()
export class MercadonaCatalogRunner implements CatalogRunner {
  private readonly logger = new Logger(MercadonaCatalogRunner.name);

  constructor(private readonly config: ConfigService) {}

  async run(
    context: RunContext,
    report: RunReport,
    input: CatalogDiscoveryInput,
    source: SupermarketSource
  ): Promise<void> {
    // No per chain gate here (plan 0083). `harvest-run.service.ts` refuses the
    // spawn when `source.enabled` is false, so a disabled chain never reaches
    // this method and a second check would only ever guard a run that could not
    // have started.
    const settings = this.config.getOrThrow<HarvesterConfig>('harvester');
    const scopes = requireScopes(input.priceScopes);

    // Declared before any price refers to one, which is the rule every report
    // follows (plan 0103, D4). The spawn read these rows to check them, so the
    // orchestrator finds each one by key and creates nothing; the name is left
    // null because a scope that already exists is not renamed by a walk.
    for (const scope of scopes) {
      report.scope({
        key: scope.externalKey,
        // A warehouse is not a postal code and not a shop: it is the group of
        // shops the chain prices together and keys itself.
        kind: PriceScopeKind.REGION,
        name: null,
      });
    }

    // One client per warehouse, sharing the run's one token bucket through
    // `acquire`, so the rate the source sees is the configured rate however many
    // warehouses are open.
    const walks = scopes.map((scope) => ({
      warehouse: scope.externalKey,
      client: new MercadonaClient({
        warehouse: scope.externalKey,
        userAgent: settings.userAgent,
        baseUrl: settings.mercadonaBaseUrl,
        acquire: context.acquire,
        signal: context.signal,
      }),
    }));

    // --- Phase 1: one tree walk per warehouse ------------------------------
    //
    // The listing carries the price: every product in a level 2 category
    // response has `price_instructions` with `unit_price` and `bulk_price` on
    // it, so this phase is the whole of what varies between warehouses and it
    // costs 151 requests each (plan 0108, section 3).
    await context.setStage(
      'WALK',
      `Walking the category tree in ${scopes.length} warehouse(s)`
    );
    /** Per warehouse, what it lists, by external id. */
    const assortments = new Map<string, Map<string, MercadonaListProduct>>();
    /** Every product any warehouse listed, with where to fetch its detail. */
    const union = new Map<string, Detailable>();

    for (const walk of walks) {
      if (context.signal.aborted) {
        break;
      }
      const warehouse = walk.warehouse;
      const listed = new Map<string, MercadonaListProduct>();
      for await (const product of walk.client.walkCatalog('es')) {
        listed.set(product.externalId, product);
        // The walk reports no counter until the detail phase, so at a low owner
        // set rate its 151 requests can outlast `HARVEST_STALE_AFTER` with the
        // heartbeat still sitting at the stage change.
        await context.heartbeat();
        if (context.signal.aborted) {
          break;
        }
      }
      assortments.set(warehouse, listed);
      for (const [externalId, product] of listed) {
        // The first warehouse that listed it is the one its detail is fetched
        // from, and that is what makes the detail phase safe to share: a
        // product absent from warehouse one and present in warehouse four is
        // fetched from four, where it answers 200 rather than "not stocked".
        if (!union.has(externalId)) {
          union.set(externalId, { client: walk.client, listing: product });
        }
      }
      this.logger.log(
        `Run ${context.runId}: ${listed.size} product(s) in warehouse ${warehouse}`
      );
    }

    const products = [...union.entries()].map(([externalId, held]) => ({
      externalId,
      ...held,
    }));
    await context.setTotalPlanned(products.length);

    // --- Phase 2: detail once per product, over the union ------------------
    // EAN and brand exist only on the detail endpoint (section 2.5), and
    // **neither depends on the warehouse**, which is the whole reason a run of
    // six warehouses is about 5,300 requests rather than 26,298.
    await context.setStage(
      'DETAIL',
      `Fetching detail for ${products.length} product(s)`
    );
    const observedAt = new Date();
    let observed = 0;

    await runWorkerPool({
      items: products,
      workers: source.workers,
      signal: context.signal,
      handle: async (product) => {
        const detail = await product.client.fetchProduct(
          product.externalId,
          ['es'],
          {
            // The walk's own path, passed straight through. It used to be a list
            // of bare names that had to be wrapped into nodes here; it carries
            // each node's id now, and rewrapping it made a node whose `name` was
            // a node. Section 5.6 splits cheese from cured meat on the level 2
            // id, so the ids have to survive this hop.
            categoryPath: product.listing.categoryPath,
            observedAt,
          }
        );

        // A 404 is "not stocked in this warehouse" (section 2.6): a value, not a
        // failure, and it neither fails the run nor deletes what we know. It
        // produces no observation, and the absence is what phase 3 reads.
        if (!detail) {
          await context.report({ processed: 1, notFound: 1 });
          return;
        }

        observed += 1;
        report.product({
          externalId: detail.externalId,
          // What the chain printed, which for this one is always Spanish. The
          // key is optional since plan 0111 widened the type, and the only row
          // that carries no name is the unavailable one, which returned above.
          name: detail.name.es ?? '',
          brand: detail.brand,
          ean: detail.ean,
          // The detail's, and therefore the warehouse the detail was fetched
          // from. `unit_size` differs between warehouses for a product sold by
          // approximate weight, where the euros per kilo is national and the
          // typical weight of the tray is not (plan 0108, section 5.1). The row
          // holds one size, so it holds the one this read saw.
          unitSize: detail.unitSize,
          sizeFormat: product.listing.sizeFormat,
          categoryPath: detail.categoryPath,
          url: detail.sourceUrl,
          observedAt,
          extra: null,
          // One price per warehouse that listed it, each naming its own scope
          // (plan 0108, D6). Nothing is collapsed: 36 of 1,807 products
          // genuinely differed across five warehouse pairs, the format allows a
          // price per warehouse, and a model that stored the agreeing ones once
          // could not record the week one of them differs.
          prices: pricesOf(
            detail.externalId,
            detail.currency,
            scopes,
            assortments
          ),
        });
      },
      onError: async (error, product) => {
        // A failing worker does not fail the run: the item is counted and logged
        // with its external id and URL, and the worker takes the next one.
        this.logger.warn(
          `Run ${context.runId}: product ${product.externalId} ` +
            `(${product.listing.shareUrl ?? 'no url'}) failed: ${String(error)}`
        );
        await context.report({ failed: 1 });
      },
    });

    // --- Phase 3: what each warehouse carries, and what it does not --------
    //
    // The runner used to load every `ACTIVE` row of the chain here to work out
    // which tracked products the walk had not seen, and call those out of stock.
    // That fact is already in the report: the orchestrator knows what the run
    // named, so the runner says only that the walk was whole (plan 0103, 6.1).
    //
    // What the orchestrator cannot know is **which** warehouse named which
    // product, because a product is reported once for the whole run. So the
    // absences are stated here, per warehouse, and they are the only claims a
    // run of several warehouses has to add: everything the run named is implied
    // present, and a warehouse that did not list a product says so outright.
    //
    // **An aborted run declares nothing**, so it writes positives only. A walk
    // that stopped early has not proved anything absent, and neither has a
    // detail phase that stopped early, since a product it never reached is
    // indistinguishable from one no warehouse listed.
    if (!context.signal.aborted) {
      for (const scope of scopes) {
        const listed = assortments.get(scope.externalKey);
        report.assortmentComplete(scope.externalKey);
        for (const externalId of union.keys()) {
          if (!listed?.has(externalId)) {
            report.availability({
              externalId,
              available: false,
              scopeKey: scope.externalKey,
            });
          }
        }
      }
    }

    this.logger.log(
      `Run ${context.runId}: ${observed} product(s) observed across ` +
        `${scopes.length} warehouse(s)` +
        (context.signal.aborted ? ', positives only (the run was aborted)' : '')
    );
    await context.flush();
    // The saving stated rather than assumed (plan 0108, section 3): a reader
    // can divide one number by the other and see that the detail phase was
    // entered once per product and not once per warehouse.
    await context.setReport({
      warehouses: scopes.map((scope) => scope.externalKey),
      productsListed: sum(
        [...assortments.values()].map((listed) => listed.size)
      ),
      /** The size of the union, which is what the detail phase costs. */
      productsDetailed: products.length,
    });
  }
}

/** One product to fetch detail for, and the warehouse to fetch it from. */
interface Detailable {
  /** The first warehouse that listed it, which is where it answers 200. */
  client: MercadonaClient;
  listing: MercadonaListProduct;
}

/**
 * One price per warehouse that listed the product, read from that warehouse's
 * own listing row.
 *
 * **The listing is where the price comes from, not the detail.** Both carry
 * `price_instructions`, and the detail carries only the one warehouse it was
 * fetched from, so a run of six warehouses that read the detail's number would
 * write the same price six times under six scopes.
 *
 * **`bulk_price` travels verbatim and is never recomputed** (plan 0038, section
 * 2.4). A warehouse whose `unit_price` differs while its `bulk_price` matches is
 * a different pack weight and not a different price: the euros per kilo is
 * national and the typical weight of the tray is not, and 59 to 126 of the
 * differences between any pair of warehouses are of that kind.
 */
function pricesOf(
  externalId: string,
  currency: string,
  scopes: readonly RunPriceScope[],
  assortments: ReadonlyMap<string, ReadonlyMap<string, MercadonaListProduct>>
) {
  const prices = [];
  for (const scope of scopes) {
    const listing = assortments.get(scope.externalKey)?.get(externalId);
    if (!listing) {
      continue;
    }
    prices.push({
      scopeKey: scope.externalKey,
      price: listing.price,
      currency,
      unitPrice: listing.unitPrice,
      unitPriceLabel: listing.unitPriceLabel,
      // A storefront price has no window: it is what the till charges until the
      // storefront says otherwise (plan 0086, section 5).
      validFrom: null,
      validUntil: null,
    });
  }
  return prices;
}

function sum(numbers: readonly number[]): number {
  return numbers.reduce((total, value) => total + value, 0);
}

/**
 * The warehouses this walk covers, which are the scopes it writes for (plan
 * 0108, section 1).
 *
 * The spawn refuses an empty list, a scope with no `externalKey` and a scope
 * outside the adapter's priority band, so reaching here with none means the run
 * was written some other way than the spawn. It is worth an error rather than a
 * silent walk that fetches nothing, which is what a walk with no warehouse to
 * ask would be.
 */
function requireScopes(
  scopes: readonly RunPriceScope[] | undefined
): readonly RunPriceScope[] {
  if (!scopes || scopes.length === 0) {
    throw new Error(
      'This walk covers the warehouses its price scopes name, and it was given ' +
        'none. Start it again with at least one.'
    );
  }
  return scopes;
}
