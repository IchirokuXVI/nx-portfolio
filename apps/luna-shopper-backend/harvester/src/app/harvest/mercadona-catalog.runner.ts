import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MercadonaClient,
  type MercadonaListProduct,
} from '@portfolio/luna-shopper/mercadona';
import type { HarvesterConfig } from '../config/app-config';
import type { SupermarketSource } from '../entities';
import { runWorkerPool } from '../runner/worker-pool';
import type { CatalogDiscoveryInput, CatalogRunner } from './catalog-runner';
import type { RunContext } from './run-context';
import type { RunReport } from './run-report';

/**
 * `CATALOG_DISCOVERY` against the `mercadona-api` adapter (plan 0038, section
 * 6.2). The expensive one.
 *
 * 1. Walk the category tree, level 1 by level 1: **151 requests**.
 * 2. For each unique product, fetch detail **in `es` only**, to capture `ean` and
 *    `brand`: **4,232 requests**.
 * 3. Report each detail as a product, carrying the price the detail stated.
 * 4. Say that the walk was whole, so the orchestrator can work out what the
 *    warehouse does not carry.
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
 * **Why `es` only.** Fetching both languages doubles the run to 8,464 requests.
 * The row exists for matching and for the queue, and the Spanish name serves
 * both. The English name is needed only when an `Item` is actually created, so it
 * is fetched then, for that one product.
 *
 * **Why it is a background job.** The run is not latency bound, it is politeness
 * bound: at 4 requests per second those 4,383 requests take about 18 minutes.
 * Raising the worker count shortens nothing on its own, because the rate limit is
 * what binds.
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
    // Checked and not kept: the scope the prices land in is the sink's, and a
    // walk that reached here with none was written some other way than the
    // spawn. It is worth an error rather than a silent walk that throws its
    // prices away, which is the thing plan 0086 deleted.
    requireScope(input.priceScopeId);

    const warehouse = readWarehouse(source.config);
    const client = new MercadonaClient({
      warehouse,
      userAgent: settings.userAgent,
      baseUrl: settings.mercadonaBaseUrl,
      acquire: context.acquire,
      signal: context.signal,
    });

    // --- Phase 1: the tree walk -------------------------------------------
    await context.setStage('WALK', 'Walking the category tree');
    const products: MercadonaListProduct[] = [];
    for await (const product of client.walkCatalog('es')) {
      products.push(product);
      // The walk reports no counter until the detail phase, so at a low owner
      // set rate its 151 requests can outlast `HARVEST_STALE_AFTER` with the
      // heartbeat still sitting at the stage change.
      await context.heartbeat();
      if (context.signal.aborted) {
        break;
      }
    }
    await context.setTotalPlanned(products.length);
    this.logger.log(
      `Run ${context.runId}: ${products.length} product(s) in warehouse ${warehouse}`
    );

    // --- Phase 2: detail per product, on the worker pool -------------------
    // EAN and brand exist only on the detail endpoint (section 2.5), which is
    // the whole reason this phase exists and the whole reason it is expensive.
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
      handle: async (listProduct) => {
        const detail = await client.fetchProduct(
          listProduct.externalId,
          ['es'],
          {
            // The walk's own path, passed straight through. It used to be a list
            // of bare names that had to be wrapped into nodes here; it carries
            // each node's id now, and rewrapping it made a node whose `name` was
            // a node. Section 5.6 splits cheese from cured meat on the level 2
            // id, so the ids have to survive this hop.
            categoryPath: listProduct.categoryPath,
            observedAt,
          }
        );

        // A 404 is "not stocked in this warehouse" (section 2.6): a value, not a
        // failure, and it neither fails the run nor deletes what we know. It
        // produces no observation, and the absence is what phase 4 reads.
        if (!detail) {
          await context.report({ processed: 1, notFound: 1 });
          return;
        }

        observed += 1;
        report.product({
          externalId: detail.externalId,
          name: detail.name.es,
          brand: detail.brand,
          ean: detail.ean,
          unitSize: detail.unitSize,
          sizeFormat: listProduct.sizeFormat,
          categoryPath: detail.categoryPath,
          url: detail.sourceUrl,
          observedAt,
          extra: null,
          // One price, for the scope the run was started with. Mercadona names
          // no scope of its own, so the key is null and the price falls to the
          // run's default (plan 0103, section 3.2).
          prices: [
            {
              scopeKey: null,
              price: detail.price,
              currency: detail.currency,
              unitPrice: detail.unitPrice,
              unitPriceLabel: detail.unitPriceLabel,
              // A storefront price has no window: it is what the till charges
              // until the storefront says otherwise (plan 0086, section 5).
              validFrom: null,
              validUntil: null,
            },
          ],
        });
      },
      onError: async (error, listProduct) => {
        // A failing worker does not fail the run: the item is counted and logged
        // with its external id and URL, and the worker takes the next one.
        this.logger.warn(
          `Run ${context.runId}: product ${listProduct.externalId} ` +
            `(${listProduct.shareUrl ?? 'no url'}) failed: ${String(error)}`
        );
        await context.report({ failed: 1 });
      },
    });

    // --- Phase 3: what this warehouse carries, and what it does not --------
    //
    // The runner used to load every `ACTIVE` row of the chain here to work out
    // which tracked products the walk had not seen, and call those out of stock.
    // That fact is already in the report: the orchestrator knows what the run
    // named, so the runner says only that the walk was whole (plan 0103, 6.1).
    //
    // **An aborted run declares nothing**, so it writes positives only. A walk
    // that stopped early has not proved anything absent.
    if (!context.signal.aborted) {
      report.assortmentComplete(null);
    }
    this.logger.log(
      `Run ${context.runId}: ${observed} product(s) observed in warehouse ` +
        `${warehouse}` +
        (context.signal.aborted ? ', positives only (the run was aborted)' : '')
    );
    await context.flush();
  }
}

/**
 * Mercadona's warehouse, resolved once from the postal code and then stored on
 * the source's `config`. It is a **string in two shapes**, a numeric code
 * (`4661`) and a city slug (`mad3`), so nothing here parses it.
 */
function readWarehouse(config: Record<string, unknown>): string {
  const warehouse = config['warehouse'];
  if (typeof warehouse === 'string' && warehouse.trim().length > 0) {
    return warehouse.trim();
  }
  throw new Error(
    'This source has no `warehouse` in its config. Resolve one from a postal ' +
      'code first (plan 0038, section 2.2) and set it with supermarketSource.upsert.'
  );
}

/**
 * The scope the prices are written for (plan 0086, section 9).
 *
 * The spawn refuses a `mercadona-api` discovery without one, so reaching here
 * with none means the run was written some other way. It is worth an error
 * rather than a silent walk that throws its prices away, which is the thing this
 * plan deleted.
 */
function requireScope(priceScopeId: string | undefined): string {
  if (!priceScopeId) {
    throw new Error(
      'This walk fetches a price for every product and has no price scope to ' +
        'write them for. Start it again with one.'
    );
  }
  return priceScopeId;
}
