import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ItemCategory,
  ItemSourceMatch,
  ItemSourceRefStatus,
  UnitOfMeasure,
  type CreateItemFromSourceEntryRequest,
  type ItemView,
  type ListSourceEntriesRequest,
  type SourceCatalogEntryPage,
} from '@portfolio/luna-shopper/contracts';
import {
  MercadonaClient,
  mapSizeFormat,
  resolveCategory,
} from '@portfolio/luna-shopper/mercadona';
import {
  clampPageSize,
  ConflictException,
  decodeCursor,
  encodeCursor,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import type { HarvesterConfig } from '../config/app-config';
import { ItemSourceRef, SourceCatalogEntry } from '../entities';
import { CatalogClient } from './catalog-client.service';
import { toSourceCatalogEntryView } from './harvest.mappers';
import { PlatformAdminService } from './platform-admin.service';
import { SupermarketSourceService } from './supermarket-source.service';

interface EntryCursor {
  value: string;
  id: string;
}

/**
 * The discovery snapshot, and the one action that turns it into catalog rows
 * (plan 0038, section 6.2).
 *
 * **This is the path that populates the database**, and it is deliberately a
 * review queue rather than a bulk insert of 4,232 products nobody chose. The
 * owner reads `sourceEntry.list` with `unmatchedOnly`, picks the twenty or so
 * products of a real weekly shop, and promotes them one at a time.
 */
@Injectable()
export class SourceEntryService {
  constructor(
    @InjectRepository(SourceCatalogEntry)
    private readonly entries: Repository<SourceCatalogEntry>,
    @InjectRepository(ItemSourceRef)
    private readonly refs: Repository<ItemSourceRef>,
    private readonly catalog: CatalogClient,
    private readonly sources: SupermarketSourceService,
    private readonly admin: PlatformAdminService,
    private readonly config: ConfigService
  ) {}

  async list(req: ListSourceEntriesRequest): Promise<SourceCatalogEntryPage> {
    await this.admin.requireAdmin(req);
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as EntryCursor | undefined;

    const qb = this.entries
      .createQueryBuilder('e')
      .where('e."supermarketId" = :sid', { sid: req.supermarketId })
      .orderBy('e.name', 'ASC')
      .addOrderBy('e.id', 'ASC')
      .take(limit + 1);
    if (req.query?.trim()) {
      qb.andWhere('(e.name ILIKE :q OR e.brand ILIKE :q OR e.ean = :ean)', {
        q: `%${req.query.trim()}%`,
        ean: req.query.trim(),
      });
    }
    if (req.unmatchedOnly) {
      // The candidate new items: everything the ladder could not tie to a
      // catalog row. This is the list the owner actually shops from.
      qb.andWhere(
        `NOT EXISTS (
          SELECT 1 FROM "item_source_refs" r
          WHERE r."supermarketId" = e."supermarketId"
            AND r."externalId" = e."externalId"
        )`
      );
    }
    if (cursor) {
      qb.andWhere('(e.name, e.id) > (:cv, :cid)', {
        cv: cursor.value,
        cid: cursor.id,
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toSourceCatalogEntryView),
      nextCursor:
        hasMore && last
          ? encodeCursor({ value: last.name, id: last.id })
          : null,
    };
  }

  /**
   * Promote one entry to a catalog `Item`, and link it.
   *
   * **The English name is fetched here**, which is the whole point of section
   * 6.2's `es`-only discovery: paying for `en` during the walk would double a
   * 4,232 request run to 8,464, and it is needed only at this moment, for this
   * one product. If Mercadona has no English string it falls back to Spanish, so
   * an English speaking user sees Spanish; refusing to import would be worse.
   */
  async createItem(
    req: CreateItemFromSourceEntryRequest
  ): Promise<ItemView> {
    await this.admin.requireAdmin(req);
    const entry = await this.load(req.entryId);

    // EAN is unique in catalog, so a duplicate would be refused by the database
    // anyway. Asking first turns that into a sentence naming the existing item.
    if (entry.ean) {
      const { item } = await this.catalog.findItemByEan(entry.ean);
      if (item) {
        throw new ConflictException(
          `Catalog already holds an item with EAN ${entry.ean} (${item.id}). ` +
            'Link it with itemSourceRef.setManual instead of creating a second one.'
        );
      }
    }

    const englishName = await this.fetchEnglishName(entry);
    const unitSize = entry.unitSize === null ? null : Number(entry.unitSize);

    const item = await this.catalog.createItem({
      name: {
        es: entry.name,
        en: englishName ?? entry.name,
      },
      brand: entry.brand,
      ean: entry.ean,
      unitSize,
      // Never from the chain (section 5.7): `imageUrl` comes from Open Food Facts
      // or the owner, and is never rehosted from a supermarket's own photography.
      imageUrl: null,
      sku: null,
      category:
        (req.category as ItemCategory | undefined) ??
        resolveCategory(
          (entry.categoryPath ?? []).map((name) => ({ name }))
        ),
      defaultUnit: mapSizeFormat(entry.sizeFormat) ?? UnitOfMeasure.UNIT,
    });

    // Link it immediately: the owner chose this product, so the ref is ACTIVE
    // rather than a candidate, and a refresh will start including it.
    await this.refs.save(
      this.refs.create({
        itemId: item.id,
        supermarketId: entry.supermarketId,
        externalId: entry.externalId,
        externalUrl: entry.url,
        matchedBy: ItemSourceMatch.MANUAL,
        status: ItemSourceRefStatus.ACTIVE,
        confidence: 1,
        lastSeenAt: entry.lastSeenAt,
        lastResolvedAt: new Date(),
      })
    );

    return item;
  }

  /** One extra request, for this one product. Null when it cannot be had. */
  private async fetchEnglishName(
    entry: SourceCatalogEntry
  ): Promise<string | null> {
    const settings = this.config.getOrThrow<HarvesterConfig>('harvester');
    if (!settings.mercadonaEnabled) {
      return null;
    }
    const source = await this.sources.findBySupermarket(entry.supermarketId);
    const warehouse = source?.config?.['warehouse'];
    if (typeof warehouse !== 'string' || warehouse.length === 0) {
      return null;
    }

    const client = new MercadonaClient({
      warehouse,
      userAgent: settings.userAgent,
      baseUrl: settings.mercadonaBaseUrl,
      minIntervalMs: 250,
    });
    const product = await client.fetchProduct(entry.externalId, ['es', 'en']);
    return product?.name.en ?? null;
  }

  private async load(id: string): Promise<SourceCatalogEntry> {
    const row = await this.entries.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Source catalog entry not found');
    }
    return row;
  }
}
