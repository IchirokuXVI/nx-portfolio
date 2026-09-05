import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ItemSourceRefStatus,
  type ItemView,
} from '@portfolio/luna-shopper/contracts';
import {
  MercadonaClient,
  type MercadonaListProduct,
} from '@portfolio/luna-shopper/mercadona';
import { Repository } from 'typeorm';
import type { HarvesterConfig } from '../config/app-config';
import {
  ItemSourceRef,
  SourceCatalogEntry,
  SupermarketSource,
} from '../entities';
import { runWorkerPool } from '../runner/worker-pool';
import { CatalogClient } from './catalog-client.service';
import { ItemMatchIndex } from './matching';
import type { RunContext } from './run-context';

export interface CatalogDiscoveryInput {
  supermarketId: string;
  priceScopeId?: string;
}

/**
 * `CATALOG_DISCOVERY` (plan 0038, section 6.2). The expensive one.
 *
 * 1. Walk the category tree, level 1 by level 1: **151 requests**.
 * 2. For each unique product, fetch detail **in `es` only**, to capture `ean` and
 *    `brand`: **4,232 requests**.
 * 3. Upsert `source_catalog_entries`.
 * 4. Match against catalog items and refresh `item_source_refs`.
 *
 * **Why `es` only.** Fetching both languages doubles the run to 8,464 requests.
 * The snapshot exists for matching and for candidate review, and the Spanish name
 * serves both. The English name is needed only when an `Item` is actually
 * created, so it is fetched then, for that one product. A discovery run therefore
 * costs 4,383 requests and an item creation costs one more.
 *
 * **Why it is a background job.** The run is not latency bound, it is politeness
 * bound: at 4 requests per second those 4,383 requests take about 18 minutes, and
 * the range the knobs allow runs from 9 to 73. Raising the worker count shortens
 * nothing on its own, because the rate limit is what binds. Either way this is
 * tens of minutes, which is why it cannot live in a service that redeploys.
 */
@Injectable()
export class CatalogDiscoveryRunner {
  private readonly logger = new Logger(CatalogDiscoveryRunner.name);

  constructor(
    @InjectRepository(SourceCatalogEntry)
    private readonly entries: Repository<SourceCatalogEntry>,
    @InjectRepository(ItemSourceRef)
    private readonly refs: Repository<ItemSourceRef>,
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

    const index = new ItemMatchIndex(await this.loadCatalogItems());
    const existingRefs = await this.refs.find({
      where: { supermarketId: input.supermarketId },
    });
    const refByExternalId = new Map(
      existingRefs.map((ref) => [ref.externalId, ref])
    );
    const seenAt = new Date();

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
            observedAt: seenAt,
          }
        );

        // A 404 is "not stocked in this warehouse" (section 2.6): a value, not a
        // failure, and it neither fails the run nor deletes what we know.
        if (!detail) {
          await context.report({ processed: 1, notFound: 1 });
          return;
        }

        const outcome = await this.upsertEntry(input.supermarketId, {
          externalId: detail.externalId,
          name: detail.name.es,
          brand: detail.brand,
          ean: detail.ean,
          unitSize: detail.unitSize,
          sizeFormat: listProduct.sizeFormat,
          price: detail.price,
          unitPrice: detail.unitPrice,
          unitPriceLabel: detail.unitPriceLabel,
          categoryPath: detail.categoryPath,
          url: detail.sourceUrl,
          lastSeenAt: seenAt,
        });

        await this.refreshRef(
          input.supermarketId,
          detail.externalId,
          detail.sourceUrl,
          {
            externalId: detail.externalId,
            name: detail.name.es,
            brand: detail.brand,
            ean: detail.ean,
            unitSize: detail.unitSize,
          },
          index,
          refByExternalId,
          seenAt
        );

        await context.report({ processed: 1, ...outcome });
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

    await context.flush();
  }

  /**
   * Upsert the snapshot row. It is also what makes **resuming free**: an aborted
   * run leaves rows with a fresh `lastSeenAt`, so a re-run skips what it already
   * has by reading that timestamp. There is no checkpoint to replay.
   */
  private async upsertEntry(
    supermarketId: string,
    fields: Omit<
      SourceCatalogEntry,
      'id' | 'createdAt' | 'updatedAt' | 'supermarketId'
    >
  ): Promise<{ created?: number; updated?: number; unchanged?: number }> {
    const existing = await this.entries.findOne({
      where: { supermarketId, externalId: fields.externalId },
    });
    if (!existing) {
      await this.entries.save(
        this.entries.create({ supermarketId, ...fields })
      );
      return { created: 1 };
    }

    const changed =
      numeric(existing.price) !== numeric(fields.price) ||
      numeric(existing.unitPrice) !== numeric(fields.unitPrice) ||
      existing.name !== fields.name ||
      existing.ean !== fields.ean ||
      existing.brand !== fields.brand;

    Object.assign(existing, fields, { supermarketId });
    await this.entries.save(existing);
    return changed ? { updated: 1 } : { unchanged: 1 };
  }

  /**
   * Rung 1 of the ladder, then rungs 2 and 3 through the index. An existing ref
   * is only touched, never re-derived: once the owner has confirmed or rejected a
   * link, a later run does not get to change its mind.
   */
  private async refreshRef(
    supermarketId: string,
    externalId: string,
    externalUrl: string | null,
    candidate: Parameters<ItemMatchIndex['match']>[0],
    index: ItemMatchIndex,
    refByExternalId: Map<string, ItemSourceRef>,
    seenAt: Date
  ): Promise<void> {
    const existing = refByExternalId.get(externalId);
    if (existing) {
      existing.lastSeenAt = seenAt;
      existing.lastResolvedAt = seenAt;
      existing.externalUrl = externalUrl;
      await this.refs.save(existing);
      return;
    }

    const match = index.match(candidate);
    if (!match) {
      return;
    }

    const created = await this.refs.save(
      this.refs.create({
        itemId: match.itemId,
        supermarketId,
        externalId,
        externalUrl,
        matchedBy: match.matchedBy,
        status: match.status,
        confidence: match.confidence,
        lastSeenAt: seenAt,
        lastResolvedAt:
          match.status === ItemSourceRefStatus.ACTIVE ? seenAt : null,
      })
    );
    refByExternalId.set(externalId, created);
  }

  /** The whole catalog item index, paged once. See ItemMatchIndex's doc. */
  private async loadCatalogItems(): Promise<ItemView[]> {
    const items: ItemView[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.catalog.searchItems(cursor);
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return items;
  }
}

function numeric(value: number | string | null): number | null {
  return value === null || value === undefined ? null : Number(value);
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
