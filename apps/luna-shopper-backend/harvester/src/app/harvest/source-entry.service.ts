import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  HarvestRunMode,
  HarvestRunStatus,
  ItemCategory,
  ItemSourceMatch,
  PriceSourceKind,
  SourceEntryStatus,
  UnitOfMeasure,
  type AcceptSourceEntryRequest,
  type CreateItemFromSourceEntryRequest,
  type ExportHarvestRunRequest,
  type HarvestRunExportResult,
  type ItemView,
  type ListSourceEntriesRequest,
  type SourceCatalogEntryPage,
  type SourceCatalogEntryView,
  type SourceEntryAcceptResult,
  type SourceEntryIdRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  mapSizeFormat,
  MercadonaClient,
  resolveCategory,
} from '@portfolio/luna-shopper/mercadona';
import {
  clampPageSize,
  ConflictException,
  decodeCursor,
  encodeCursor,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { In, Repository } from 'typeorm';
import type { HarvesterConfig } from '../config/app-config';
import { HarvestRun, SourceCatalogEntry, SourceEntryPrice } from '../entities';
import { CatalogClient } from './catalog-client.service';
import { buildHarvestDocument } from './harvest-export';
import {
  toItemPriceDetails,
  toSourceCatalogEntryView,
} from './harvest.mappers';
import { PlatformAdminService } from './platform-admin.service';
import { SupermarketSourceService } from './supermarket-source.service';

interface EntryCursor {
  value: string;
  id: string;
}

/** The two statuses that are waiting for a person: the queue (plan 0086, D7). */
const QUEUED = [SourceEntryStatus.CANDIDATE, SourceEntryStatus.UNRESOLVED];

/** The modes whose rows and prices an export can be taken from (section 6.2). */
const EXPORTABLE_MODES: readonly HarvestRunMode[] = [
  HarvestRunMode.CATALOG_DISCOVERY,
  HarvestRunMode.FILE_IMPORT,
];

/** The statuses a run never leaves, and the only ones an export is offered on. */
const FINISHED_STATUSES: readonly HarvestRunStatus[] = [
  HarvestRunStatus.COMPLETED,
  HarvestRunStatus.FAILED,
  HarvestRunStatus.ABORTED,
  HarvestRunStatus.STALE,
];

/**
 * The one queue, and the three decisions an admin makes about a row (plan 0086,
 * sections 7 and 10).
 *
 * **One set of operations for every source kind.** A Mercadona product a walk
 * found, a DEZA listing and a printed leaflet name were three queues over three
 * tables saying the same three things; they are one now, because they are three
 * observations of the same kind of thing.
 *
 * Two rules the whole surface exists to hold:
 *
 * - **A run proposes and never binds.** Only an EAN or a person makes a row
 *   ACTIVE, because a bad fuzzy match writes a wrong price onto a real product
 *   that people then shop on.
 * - **Accepting writes the prices the row holds**, one per scope, each stamped
 *   with the run that observed it. Without that an admin who works the queue
 *   after an eighteen minute walk would have to run it again to get the prices
 *   he just resolved, and plan 0082 would have no run id to take them back by.
 *   The old accept parsed every open run's stored document to find them, which
 *   was the only way while an offer lived nowhere else. It lives in
 *   `source_entry_prices` now.
 *
 * The fourth thing here is the export, which is a read and the other half of a
 * file import (section 6.2).
 */
@Injectable()
export class SourceEntryService {
  private readonly logger = new Logger(SourceEntryService.name);

  constructor(
    @InjectRepository(SourceCatalogEntry)
    private readonly entries: Repository<SourceCatalogEntry>,
    @InjectRepository(SourceEntryPrice)
    private readonly prices: Repository<SourceEntryPrice>,
    @InjectRepository(HarvestRun)
    private readonly runs: Repository<HarvestRun>,
    private readonly catalog: CatalogClient,
    private readonly sources: SupermarketSourceService,
    private readonly admin: PlatformAdminService,
    private readonly config: ConfigService
  ) {}

  /**
   * The queue, per chain, newest observation first.
   *
   * Absent `status` lists the two that are waiting for a person, which is what
   * the back office asks for; naming one reaches a decision to look up or undo.
   * `unmatchedOnly` is gone: it was a `NOT EXISTS` over a table that no longer
   * exists, and the status says it now.
   *
   * Each row answers its prices inline, one per scope, because the queue cannot
   * decide a row without seeing what it is waiting on and a chain has a handful
   * of scopes rather than a page of them.
   */
  async list(req: ListSourceEntriesRequest): Promise<SourceCatalogEntryPage> {
    await this.admin.requireAdmin(req);
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as EntryCursor | undefined;

    const qb = this.entries
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.prices', 'p')
      .where('e."supermarketId" = :sid', { sid: req.supermarketId })
      .orderBy('e."lastSeenAt"', 'DESC')
      .addOrderBy('e.id', 'DESC')
      .take(limit + 1);
    if (req.status) {
      qb.andWhere('e.status = :status', { status: req.status });
    } else {
      qb.andWhere('e.status IN (:...queued)', { queued: QUEUED });
    }
    if (req.sourceKind) {
      qb.andWhere('e."sourceKind" = :kind', { kind: req.sourceKind });
    }
    if (req.query?.trim()) {
      qb.andWhere('(e.name ILIKE :q OR e.brand ILIKE :q OR e.ean = :ean)', {
        q: `%${req.query.trim()}%`,
        ean: req.query.trim(),
      });
    }
    if (cursor) {
      qb.andWhere('(e."lastSeenAt", e.id) < (:cv, :cid)', {
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
          ? encodeCursor({ value: last.lastSeenAt.toISOString(), id: last.id })
          : null,
    };
  }

  /** Bind a queued row to a product the catalog already holds, then the prices. */
  async accept(
    req: AcceptSourceEntryRequest
  ): Promise<SourceEntryAcceptResult> {
    await this.admin.requireAdmin(req);
    const entry = await this.load(req.entryId);
    const bound = await this.bind(entry, req.itemId);
    const pricesWritten = await this.writeRowPrices(bound);
    return {
      entry: toSourceCatalogEntryView(bound),
      pricesWritten,
      createdItem: null,
    };
  }

  /**
   * Create the product this row is for, bind it, and write the prices.
   *
   * **Every field of the request is optional**, because the row already holds a
   * default for each: the operator sends only what he changed and the row fills
   * the rest. What he cannot change is the row: `name`, `brand` and `sizeFormat`
   * are what the source printed and stay that way whatever the item ends up
   * called (D8), so the next walk or file that produces the same key resolves
   * through this same row.
   *
   * **The English name is fetched here, and only for a row whose id can be
   * fetched.** That is the whole point of `es` only discovery: paying for `en`
   * during a walk would double a 4,232 request run, and it is needed only at
   * this moment for this one product. A leaflet row of the Mercadona chain is
   * never fetched by its key, which is the hazard plan 0081 section 2 named and
   * the reason `sourceKind` exists.
   */
  async createItem(
    req: CreateItemFromSourceEntryRequest
  ): Promise<SourceEntryAcceptResult> {
    await this.admin.requireAdmin(req);
    const entry = await this.load(req.entryId);
    const ean = req.ean === undefined ? entry.ean : req.ean;

    // EAN is unique in catalog, so a duplicate would be refused by the database
    // anyway. Asking first turns that into a sentence naming the existing item.
    if (ean) {
      const { item } = await this.catalog.findItemByEan(ean);
      if (item) {
        throw new ConflictException(
          `Catalog already holds an item with EAN ${ean} (${item.id}). ` +
            'Accept this row onto that product instead of creating a second one.'
        );
      }
    }

    const spanish = req.name?.es?.trim() || entry.name;
    if (!spanish) {
      throw new ValidationException(
        'A product needs a name in at least one language.',
        { details: { name: 'give at least one of es or en' } }
      );
    }
    const english =
      req.name?.en?.trim() || (await this.fetchEnglishName(entry));

    const item: ItemView = await this.catalog.createItem({
      // Plan 0079 reverses plan 0038 section 11: a product the source does not
      // translate gets no `en` key rather than a copy of the Spanish string. A
      // copy is indistinguishable from a translation in the row, so nothing
      // could list the products still waiting for one; an absent key is a
      // visible gap the admin lists, and a reader sees the Spanish name through
      // the fallback, which is what the copy gave them anyway.
      name: english ? { es: spanish, en: english } : { es: spanish },
      brand: req.brand === undefined ? entry.brand : req.brand,
      ean,
      unitSize:
        req.unitSize === undefined
          ? entry.unitSize === null
            ? null
            : Number(entry.unitSize)
          : req.unitSize,
      // Never from the chain (plan 0038, section 5.7): `imageUrl` comes from
      // Open Food Facts or the owner, and is never rehosted from a supermarket's
      // own photography.
      imageUrl: null,
      sku: null,
      category:
        (req.category as ItemCategory | undefined) ??
        resolveCategory((entry.categoryPath ?? []).map((name) => ({ name }))),
      defaultUnit:
        (req.defaultUnit as UnitOfMeasure | undefined) ??
        mapSizeFormat(entry.sizeFormat) ??
        UnitOfMeasure.UNIT,
    });

    const bound = await this.bind(entry, item.id);
    const pricesWritten = await this.writeRowPrices(bound);
    return {
      entry: toSourceCatalogEntryView(bound),
      pricesWritten,
      createdItem: item,
    };
  }

  /**
   * Not a product he tracks.
   *
   * Kept as a REJECTED row rather than deleted, so the next run that observes
   * the key touches the row and asks nobody. The status is the owner's, and a
   * run does not get to overwrite a decision; plan 0082 keeps it through a
   * revert for the same reason.
   */
  async reject(req: SourceEntryIdRequest): Promise<SourceCatalogEntryView> {
    await this.admin.requireAdmin(req);
    const entry = await this.load(req.entryId);
    entry.status = SourceEntryStatus.REJECTED;
    entry.itemId = null;
    entry.candidateEntryId = null;
    entry.matchedBy = ItemSourceMatch.MANUAL;
    entry.confidence = 1;
    entry.decidedAt = new Date();
    // name, brand and sizeFormat are deliberately untouched (D8).
    return toSourceCatalogEntryView(await this.entries.save(entry));
  }

  /**
   * Everything one run observed, as a file (section 6.2).
   *
   * Every row of the run's chain whose `lastRunId` is that run, with that run's
   * price for that run's scope. **A later run of the same chain moves rows out
   * of that set as it observes them again**, so the newest run of a chain is the
   * one to export, which the back office says on the button.
   *
   * A read, and deliberately not gated by `HARVEST_ENABLED`: exporting from a
   * machine that crawled to a cluster that cannot is the point of it.
   */
  async export(req: ExportHarvestRunRequest): Promise<HarvestRunExportResult> {
    await this.admin.requireAdmin(req);
    const run = await this.runs.findOne({ where: { id: req.runId } });
    if (!run) {
      throw new NotFoundException('Harvest run not found');
    }
    if (!EXPORTABLE_MODES.includes(run.mode)) {
      throw new ValidationException(
        `A ${run.mode} run observes no products, so there is nothing to export.`
      );
    }
    if (!FINISHED_STATUSES.includes(run.status)) {
      throw new ValidationException(
        `Run ${run.id} is still ${run.status}. Wait for it to finish, or abort ` +
          'it: an export of a run still writing rows is a file that disagrees ' +
          'with the run it names.'
      );
    }
    if (!run.supermarketId) {
      throw new ValidationException(
        `Run ${run.id} belongs to no chain, so its rows cannot be exported.`
      );
    }

    const entries = await this.entries.find({
      where: { supermarketId: run.supermarketId, lastRunId: run.id },
      relations: { prices: true },
      order: { lastSeenAt: 'DESC', id: 'DESC' },
    });

    return {
      supermarketId: run.supermarketId,
      priceScopeId: run.priceScopeId ?? null,
      document: buildHarvestDocument({
        run: {
          id: run.id,
          supermarketId: run.supermarketId,
          priceScopeId: run.priceScopeId ?? null,
        },
        entries,
        producedAt: new Date(),
      }),
    };
  }

  /**
   * Drop the rows one run queued that nobody has decided on (plan 0086,
   * section 8), and answer how many went.
   *
   * **Both run columns, which is new.** A row this run created and a later run
   * observed again is a real product a later run stands behind, and deleting it
   * would take the later run's observation with it. A row a person decided on
   * survives whatever run created it: an ACTIVE row is a mapping other files
   * already resolve through, and a REJECTED one is the owner saying this is not
   * a product he tracks. The run's mistake was in its prices, not in the strings
   * it read.
   *
   * Not admin gated here. It is one step of `harvest.revert`, which is gated
   * once, at its own door.
   */
  async deleteUndecidedFrom(runId: string): Promise<number> {
    const result = await this.entries.delete({
      firstRunId: runId,
      lastRunId: runId,
      status: In(QUEUED),
    });
    return result.affected ?? 0;
  }

  /**
   * Delete the price observations one run made (plan 0086, section 8).
   *
   * They are the run's claims, and an accept after the revert must not write
   * them again. Separate from the rows above because a row a person decided on
   * survives a revert while the price that run observed for it does not.
   *
   * Also not admin gated, for the same reason.
   */
  async deleteObservedPricesFrom(runId: string): Promise<number> {
    const result = await this.prices.delete({ runId });
    return result.affected ?? 0;
  }

  /** ACTIVE, bound, and MANUAL: a person decided, so the confidence is 1. */
  private async bind(
    entry: SourceCatalogEntry,
    itemId: string
  ): Promise<SourceCatalogEntry> {
    entry.itemId = itemId;
    entry.candidateEntryId = null;
    entry.status = SourceEntryStatus.ACTIVE;
    entry.matchedBy = ItemSourceMatch.MANUAL;
    entry.confidence = 1;
    entry.decidedAt = new Date();
    // name, brand and sizeFormat are deliberately untouched. The item may be
    // renamed to anything at all and the next run that produces this key still
    // resolves through this row (D8).
    const saved = await this.entries.save(entry);
    saved.prices = entry.prices ?? [];
    return saved;
  }

  /**
   * Section 7's last paragraph: write the prices this row holds.
   *
   * One `catalog.addPrices` call per scope, each with **that scope's own run
   * id** and the row's own `sourceKind`, so plan 0082 can take them back with
   * the rest of that run's rows. An admin who accepts a Mercadona product on
   * Tuesday gets the price Monday's walk saw, stamped with Monday's run.
   *
   * A row whose window has closed writes nothing: an expired price is not one
   * anybody is charged, and inserting one only to have the resolver filter it
   * out is work with a wrong row at the end of it. A row with no price at all
   * writes nothing and says zero, which for a DEZA row is the truth rather than
   * a failure.
   */
  private async writeRowPrices(entry: SourceCatalogEntry): Promise<number> {
    if (!entry.itemId) {
      return 0;
    }
    const now = new Date();
    const open = (entry.prices ?? []).filter(
      (price) => price.validUntil === null || price.validUntil > now
    );
    let written = 0;

    for (const price of open) {
      const result = await this.catalog.addPrices(
        price.priceScopeId,
        [
          {
            itemId: entry.itemId,
            price: price.price === null ? null : Number(price.price),
            currency: price.currency,
            unitPrice:
              price.unitPrice === null ? null : Number(price.unitPrice),
            unitPriceLabel: price.unitPriceLabel,
            validFrom: price.validFrom?.toISOString() ?? null,
            validUntil: price.validUntil?.toISOString() ?? null,
            observedAt: price.observedAt.toISOString(),
            details: toItemPriceDetails(price.details ?? null),
          },
        ],
        price.runId,
        entry.sourceKind
      );
      written += result.inserted;
    }
    return written;
  }

  /**
   * One extra request, for this one product. Null when it cannot be had.
   *
   * Three conditions, and all three are the same rule from different sides: the
   * id has to be one the source can be asked about. `OFFICIAL_API` says the id
   * is the chain's own rather than a hash of a printed name, `mercadona-api`
   * says the chain answers that question at all, and the row's `enabled` is the
   * per chain switch of plan 0083, which this fetch is the one in the service
   * that no spawn stands in front of.
   */
  private async fetchEnglishName(
    entry: SourceCatalogEntry
  ): Promise<string | null> {
    if (entry.sourceKind !== PriceSourceKind.OFFICIAL_API) {
      return null;
    }
    const source = await this.sources.findBySupermarket(entry.supermarketId);
    if (
      source === null ||
      !source.enabled ||
      source.adapterKey !== 'mercadona-api'
    ) {
      return null;
    }
    const warehouse = source.config?.['warehouse'];
    if (typeof warehouse !== 'string' || warehouse.length === 0) {
      return null;
    }

    const settings = this.config.getOrThrow<HarvesterConfig>('harvester');
    const client = new MercadonaClient({
      warehouse,
      userAgent: settings.userAgent,
      baseUrl: settings.mercadonaBaseUrl,
      minIntervalMs: 250,
    });
    try {
      const product = await client.fetchProduct(entry.externalId, ['es', 'en']);
      return product?.name.en ?? null;
    } catch (error) {
      // One optional request must not stop a product being created. The item is
      // saved with its Spanish name and the admin can translate it later.
      this.logger.warn(
        `Could not fetch the English name for ${entry.externalId}: ${String(error)}`
      );
      return null;
    }
  }

  private async load(id: string): Promise<SourceCatalogEntry> {
    const row = await this.entries.findOne({
      where: { id },
      relations: { prices: true },
    });
    if (!row) {
      throw new NotFoundException('Source catalog entry not found');
    }
    return row;
  }
}
