import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  PriceSourceKind,
  SourceEntryStatus,
} from '@portfolio/luna-shopper/contracts';
import {
  MercadonaClient,
  type MercadonaListProduct,
} from '@portfolio/luna-shopper/mercadona';
import { Repository } from 'typeorm';
import type { HarvesterConfig } from '../config/app-config';
import { SourceCatalogEntry, SupermarketSource } from '../entities';
import { runWorkerPool } from '../runner/worker-pool';
import { CatalogClient } from './catalog-client.service';
import type { CatalogDiscoveryInput, CatalogRunner } from './catalog-runner';
import type { RunContext } from './run-context';
import { SourceIngest, type SourceObservation } from './source-ingest';

/** Availability entries per call, as the refresh this replaced used. */
const AVAILABILITY_BATCH = 200;

/**
 * `CATALOG_DISCOVERY` against the `mercadona-api` adapter (plan 0038, section
 * 6.2). The expensive one.
 *
 * 1. Walk the category tree, level 1 by level 1: **151 requests**.
 * 2. For each unique product, fetch detail **in `es` only**, to capture `ean` and
 *    `brand`: **4,232 requests**.
 * 3. Hand the details to {@link SourceIngest} as observations, each carrying the
 *    price the detail stated.
 * 4. Say what the warehouse carries and what it does not.
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

  constructor(
    @InjectRepository(SourceCatalogEntry)
    private readonly entries: Repository<SourceCatalogEntry>,
    private readonly ingest: SourceIngest,
    private readonly catalog: CatalogClient,
    private readonly config: ConfigService
  ) {}

  async run(
    context: RunContext,
    input: CatalogDiscoveryInput,
    source: SupermarketSource
  ): Promise<void> {
    // No per chain gate here (plan 0083). `harvest-run.service.ts` refuses the
    // spawn when `source.enabled` is false, so a disabled chain never reaches
    // this method and a second check would only ever guard a run that could not
    // have started.
    const settings = this.config.getOrThrow<HarvesterConfig>('harvester');
    const priceScopeId = requireScope(input.priceScopeId);

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
    const observations: SourceObservation[] = [];

    await runWorkerPool({
      items: products,
      workers: source.workers,
      signal: context.signal,
      handle: async (listProduct) => {
        const detail = await client.fetchProduct(listProduct.externalId, ['es'], {
          // The walk's own path, passed straight through. It used to be a list
          // of bare names that had to be wrapped into nodes here; it carries
          // each node's id now, and rewrapping it made a node whose `name` was
          // a node. Section 5.6 splits cheese from cured meat on the level 2
          // id, so the ids have to survive this hop.
          categoryPath: listProduct.categoryPath,
          observedAt,
        });

        // A 404 is "not stocked in this warehouse" (section 2.6): a value, not a
        // failure, and it neither fails the run nor deletes what we know. It
        // produces no observation, and the absence is what phase 4 reads.
        if (!detail) {
          await context.report({ processed: 1, notFound: 1 });
          return;
        }

        observations.push({
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
          price: {
            price: detail.price,
            currency: detail.currency,
            unitPrice: detail.unitPrice,
            unitPriceLabel: detail.unitPriceLabel,
            // A storefront price has no window: it is what the till charges
            // until the storefront says otherwise (plan 0086, section 5).
            validFrom: null,
            validUntil: null,
          },
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

    // --- Phase 3: the rows, the ladder and the prices ----------------------
    await context.setStage(
      'INGEST',
      `Recording ${observations.length} product(s)`
    );
    const { outcomes } = await this.ingest.ingest(context, {
      supermarketId: input.supermarketId,
      priceScopeId,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      observations,
    });

    // --- Phase 4: what this warehouse carries ------------------------------
    await context.setStage('AVAILABILITY', 'Recording what is stocked');
    await this.writeAvailability(context, input, priceScopeId, outcomes);
    await context.flush();
  }

  /**
   * What the warehouse carries, and what it does not (plan 0086, section 5).
   *
   * Every `ACTIVE` row this run observed is stocked. Every `ACTIVE` row of this
   * chain of kind `OFFICIAL_API` that it did **not** observe is not, which is
   * what a refresh's 404 used to mean, said by the walk instead: a product the
   * whole tree walk did not list is not stocked in this warehouse.
   *
   * **An aborted run asserts nothing negative.** It did not walk the whole tree,
   * so the products it never reached are unobserved for a reason that says
   * nothing about the warehouse. It still writes what it did see, because prices
   * and stock already fetched are valid data (plan 0038, section 6.6).
   *
   * Rows of another source kind are left out on purpose. A leaflet row of this
   * chain is a printed name, not a product id the walk could have listed, so its
   * absence from the tree is not a claim about stock.
   */
  private async writeAvailability(
    context: RunContext,
    input: CatalogDiscoveryInput,
    priceScopeId: string,
    outcomes: ReadonlyArray<{ entry: SourceCatalogEntry; itemId: string | null }>
  ): Promise<void> {
    const byItem = new Map<string, boolean>();
    const observedIds = new Set<string>();
    for (const outcome of outcomes) {
      observedIds.add(outcome.entry.externalId);
      if (outcome.itemId) {
        byItem.set(outcome.itemId, true);
      }
    }

    if (!context.signal.aborted) {
      const tracked = await this.entries.find({
        where: {
          supermarketId: input.supermarketId,
          sourceKind: PriceSourceKind.OFFICIAL_API,
          status: SourceEntryStatus.ACTIVE,
        },
      });
      for (const row of tracked) {
        if (!row.itemId || observedIds.has(row.externalId)) {
          continue;
        }
        // A product two rows resolve to is stocked if either row saw it: the
        // false would be a claim the source never made.
        byItem.set(row.itemId, byItem.get(row.itemId) ?? false);
      }
    }

    const entries = [...byItem].map(([itemId, available]) => ({
      itemId,
      available,
    }));
    for (let i = 0; i < entries.length; i += AVAILABILITY_BATCH) {
      await this.catalog.setAvailability(
        priceScopeId,
        entries.slice(i, i + AVAILABILITY_BATCH)
      );
    }
    this.logger.log(
      `Run ${context.runId}: availability for ${entries.length} item(s)` +
        (context.signal.aborted ? ', positives only (the run was aborted)' : '')
    );
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
