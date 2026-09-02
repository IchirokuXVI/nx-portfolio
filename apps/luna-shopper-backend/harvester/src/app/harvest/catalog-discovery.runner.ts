import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ItemSourceMatch,
  ItemSourceRefStatus,
  PriceSourceKind,
  UnitOfMeasure,
  type ItemView,
  type SupermarketItemBatchEntry,
} from '@portfolio/luna-shopper/contracts';
import {
  MercadonaClient,
  type MercadonaLang,
  type MercadonaListProduct,
  type MercadonaProduct,
} from '@portfolio/luna-shopper/mercadona';
import { Repository } from 'typeorm';
import type { HarvesterConfig } from '../config/app-config';
import { ItemSourceRef, SourceCatalogEntry, SupermarketSource } from '../entities';
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
    const settings = this.config.getOrThrow<HarvesterConfig>('harvester');
    if (!settings.mercadonaEnabled) {
      throw new Error(
        'MERCADONA_ENABLED is false, so this deployment does not fetch from ' +
          'Mercadona. That switch exists so the chain can be dropped without ' +
          'dropping the service (plan 0038, section 8.1).'
      );
    }

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
    // TEMPORARY (catalog seeding): the walk is cheap and the detail phase is not,
    // so the filter runs here, after the tree, and costs no extra requests.
    const only = new Set(settings.onlyCategoryIds);
    const planned = only.size
      ? products.filter((p) =>
          p.categoryPath.some((node) => node.id !== undefined && only.has(node.id))
        )
      : products;
    if (only.size) {
      this.logger.warn(
        `HARVEST_ONLY_CATEGORY_IDS is set: ${planned.length} of ${products.length} product(s) will be processed`
      );
    }
    await context.setTotalPlanned(planned.length);
    this.logger.log(
      `Run ${context.runId}: ${planned.length} product(s) in warehouse ${warehouse}`
    );

    // TEMPORARY (catalog seeding): with HARVEST_AUTO_IMPORT the run also creates
    // an Item per product and writes its price, so the whole assortment lands in
    // catalog in one pass. The English name comes from this same detail fetch,
    // which is why the language list widens instead of a second pass being made.
    const autoImport = settings.autoImport;
    const priceEntries: SupermarketItemBatchEntry[] = [];
    const seenEans = new Set<string>();

    const langs: MercadonaLang[] = autoImport ? ['es', 'en'] : ['es'];

    // --- Phase 2: detail per product, on the worker pool -------------------
    // EAN and brand exist only on the detail endpoint (section 2.5), which is
    // the whole reason this phase exists and the whole reason it is expensive.
    await context.setStage(
      'DETAIL',
      `Fetching detail for ${planned.length} product(s)`
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
      items: planned,
      workers: source.workers,
      signal: context.signal,
      handle: async (listProduct) => {
        const detail = await client.fetchProduct(listProduct.externalId, langs, {
          // The nodes, ids included: `category` is resolved from this, and
          // section 5.6 splits cheese from cured meat by level 2 id.
          categoryPath: listProduct.categoryPath,
          observedAt: seenAt,
        });

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

        if (autoImport) {
          await this.autoImport(
            input,
            detail,
            listProduct,
            refByExternalId,
            priceEntries,
            seenEans,
            seenAt
          );
        }

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

    if (autoImport) {
      await this.writePrices(context, input, priceEntries);
    }

    await context.flush();
  }

  /**
   * TEMPORARY (catalog seeding). Create the catalog `Item` for one product and
   * queue its price, so a single run leaves catalog fully populated.
   *
   * This is the bulk twin of `sourceEntry.createItem`, and it keeps that path's
   * rules: the EAN decides identity, `imageUrl` is never taken from the chain
   * (section 5.7), and the ref it writes is the owner's own link. What it drops
   * is the review step, which is the entire point of section 6.2, so this is
   * expected to be deleted once the catalog has been seeded and dumped.
   */
  private async autoImport(
    input: CatalogDiscoveryInput,
    detail: MercadonaProduct,
    listProduct: MercadonaListProduct,
    refByExternalId: Map<string, ItemSourceRef>,
    priceEntries: SupermarketItemBatchEntry[],
    seenEans: Set<string>,
    seenAt: Date
  ): Promise<void> {
    // Section 5.6: two products (foil, cling film) are `size_format: 'm'`, which
    // has no UnitOfMeasure. The plan's recommendation is not to import them.
    if (listProduct.sizeFormat === 'm') {
      return;
    }

    const existing = refByExternalId.get(detail.externalId);
    let itemId = existing?.itemId;

    if (!itemId) {
      // EAN is unique in catalog, and one assortment really does repeat one:
      // the second occurrence would be refused by the database anyway.
      if (detail.ean && seenEans.has(detail.ean)) {
        return;
      }
      let item: ItemView;
      try {
        item = await this.catalog.createItem({
          name: { es: detail.name.es, en: detail.name.en ?? detail.name.es },
          brand: detail.brand,
          ean: detail.ean,
          unitSize: detail.unitSize,
          imageUrl: null,
          sku: null,
          category: detail.category,
          defaultUnit: detail.unit ?? UnitOfMeasure.UNIT,
        });
      } catch (error) {
        // Catalog refuses a second item with an EAN it already holds, and this
        // assortment really does repeat a few. That is the rule working, not a
        // failure of the run, so the product is skipped and counted nowhere.
        this.logger.warn(
          `Auto import skipped ${detail.externalId} (${detail.ean ?? 'no ean'}): ${String(error)}`
        );
        return;
      }
      itemId = item.id;
      if (detail.ean) {
        seenEans.add(detail.ean);
      }
      const ref = await this.refs.save(
        this.refs.create({
          itemId,
          supermarketId: input.supermarketId,
          externalId: detail.externalId,
          externalUrl: detail.sourceUrl,
          matchedBy: ItemSourceMatch.MANUAL,
          status: ItemSourceRefStatus.ACTIVE,
          confidence: 1,
          lastSeenAt: seenAt,
          lastResolvedAt: seenAt,
        })
      );
      refByExternalId.set(detail.externalId, ref);
    }

    priceEntries.push({
      itemId,
      price: detail.price,
      currency: detail.currency,
      unitPrice: detail.unitPrice,
      unitPriceLabel: detail.unitPriceLabel,
      available: true,
      priceObservedAt: seenAt.toISOString(),
    });
  }

  /**
   * TEMPORARY (catalog seeding). The same batched write `REFRESH` makes, so the
   * prices are recorded as OFFICIAL_API and stay refreshable. Writing them as a
   * platform admin through catalog instead would mark them ADMIN, and section
   * 6.5 would then forbid any later fetch from ever correcting them.
   */
  private async writePrices(
    context: RunContext,
    input: CatalogDiscoveryInput,
    entries: SupermarketItemBatchEntry[]
  ): Promise<void> {
    if (!input.priceScopeId || entries.length === 0) {
      return;
    }
    await context.setStage('WRITE', `Writing ${entries.length} price(s)`);
    for (let i = 0; i < entries.length; i += 200) {
      const result = await this.catalog.upsertPrices(
        input.priceScopeId,
        entries.slice(i, i + 200),
        PriceSourceKind.OFFICIAL_API
      );
      this.logger.log(
        `Run ${context.runId}: prices ${result.created} created, ` +
          `${result.updated} updated, ${result.skipped?.length ?? 0} skipped`
      );
    }
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
