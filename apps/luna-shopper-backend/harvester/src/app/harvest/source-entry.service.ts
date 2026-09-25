import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  BRAND_SPELLINGS_MAX,
  brandKey,
  HarvestRunMode,
  HarvestRunStatus,
  ItemCategory,
  ItemSourceMatch,
  PriceSourceKind,
  SourceEntryStatus,
  UnitOfMeasure,
  type AcceptSourceEntryRequest,
  type BrandSpellingsRequest,
  type BrandSpellingsResult,
  type BrandSuggestionPage,
  type BrandSuggestionView,
  type CreateItemFromSourceEntryRequest,
  type ExportHarvestRunRequest,
  type HarvestRunExportResult,
  type ItemSourceEntryPage,
  type ItemView,
  type ListBrandSuggestionsRequest,
  type ListSourceEntriesByItemRequest,
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
  describeError,
  encodeCursor,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { In, Repository } from 'typeorm';
import type { HarvesterConfig } from '../config/app-config';
import { HarvestRun, SourceCatalogEntry, SourceEntryPrice } from '../entities';
import { CatalogClient } from './catalog-client.service';
import {
  buildHarvestDocument,
  type HarvestExportScope,
} from './harvest-export';
import { toSourceCatalogEntryView } from './harvest.mappers';
import { PlatformAdminService } from './platform-admin.service';
import { acceptedName } from './source-entry-name';
import { bindFields, SourceEntryPriceWriter } from './source-entry-write';
import { SupermarketSourceService } from './supermarket-source.service';

interface EntryCursor {
  value: string;
  id: string;
}

/** The keyset a suggestions page resumes from (plan 0115, section 7.2). */
interface SuggestionCursor {
  productCount: number;
  key: string;
}

/** One grouped suggestion row, as the raw query hands it back. */
interface SuggestionRow {
  key: string;
  spelling: string;
  productCount: number;
  firstSeenAt: Date | string;
  /** `jsonb_agg` answers null for a group with no chains, which cannot happen. */
  chains: { supermarketId: string; productCount: number }[] | null;
}

/** One chain's spelling of one brand, as the raw query hands it back. */
interface SpellingRow {
  supermarketId: string;
  spelling: string;
  productCount: number;
  queuedCount: number;
}

/** A grouped suggestion row on the wire. */
function toBrandSuggestionView(row: SuggestionRow): BrandSuggestionView {
  return {
    key: row.key,
    spelling: row.spelling,
    productCount: row.productCount,
    firstSeenAt: new Date(row.firstSeenAt).toISOString(),
    chains: row.chains ?? [],
  };
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
    private readonly priceWriter: SourceEntryPriceWriter,
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
      // The **property** path, not a quoted column. `take` beside a
      // `leftJoinAndSelect` makes TypeORM page through a DISTINCT subquery, and
      // it rewrites an ORDER BY into that subquery by prefixing the alias:
      // `e."lastSeenAt"` becomes `distinctAlias.e_"lastSeenAt"`, which is not a
      // column any more and fails at runtime for every request.
      .orderBy('e.lastSeenAt', 'DESC')
      .addOrderBy('e.id', 'DESC')
      .take(limit + 1);
    // Absent, and the queue is every chain's, which `ix_source_catalog_entries_last_seen`
    // already orders. The chain narrows the read rather than addressing it.
    if (req.supermarketId) {
      qb.andWhere('e."supermarketId" = :sid', { sid: req.supermarketId });
    }
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
    if (req.brandKey?.trim()) {
      const key = brandKey(req.brandKey);
      // A value that makes no key matches nothing rather than being refused, so
      // a person typing punctuation gets an empty list and not an error. On the
      // queued rows `ix_source_catalog_entries_queued_brand_key` serves this;
      // on the others it filters what the chain filter leaves, which is what an
      // admin screen asks for.
      if (key === null) {
        qb.andWhere('FALSE');
      } else {
        qb.andWhere('e."brandKey" = :brandKey', { brandKey: key });
      }
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

  /**
   * The source rows that name one product, newest observation first (plan
   * 0160), each with how many rows of its chain carry its EAN.
   *
   * Every row whose `itemId` is the product, whatever its status: an `ACTIVE`
   * row is bound, a `CANDIDATE` row proposes it, and the status says which.
   * The count is over every row of the chain, this one included, whatever
   * their status, because a barcode the chain lists twice is the finding
   * whether or not somebody rejected one of the two.
   */
  async listByItem(
    req: ListSourceEntriesByItemRequest
  ): Promise<ItemSourceEntryPage> {
    await this.admin.requireAdmin(req);
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as EntryCursor | undefined;

    const qb = this.entries
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.prices', 'p')
      .where('e."itemId" = :itemId', { itemId: req.itemId })
      // The property path, for the reason `list` gives above.
      .orderBy('e.lastSeenAt', 'DESC')
      .addOrderBy('e.id', 'DESC')
      .take(limit + 1);
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
    const shared = await this.eanCounts(page);
    return {
      items: page.map((row) => ({
        ...toSourceCatalogEntryView(row),
        eanSharedBy: row.ean
          ? (shared.get(`${row.supermarketId}|${row.ean}`) ?? 1)
          : null,
      })),
      nextCursor:
        hasMore && last
          ? encodeCursor({ value: last.lastSeenAt.toISOString(), id: last.id })
          : null,
    };
  }

  /** How many rows each (chain, EAN) of these rows has, in one query. */
  private async eanCounts(
    rows: readonly SourceCatalogEntry[]
  ): Promise<Map<string, number>> {
    const eans = [
      ...new Set(
        rows.map((row) => row.ean).filter((ean): ean is string => !!ean)
      ),
    ];
    const counts = new Map<string, number>();
    if (eans.length === 0) {
      return counts;
    }
    const found: { supermarketId: string; ean: string; count: number }[] =
      await this.entries.query(
        `
        SELECT e."supermarketId"::text AS "supermarketId",
               e."ean"                 AS "ean",
               count(*)::int           AS "count"
          FROM "source_catalog_entries" e
         WHERE e."ean" = ANY($1::varchar[])
         GROUP BY e."supermarketId", e."ean"
        `,
        [eans]
      );
    for (const row of found) {
      counts.set(`${row.supermarketId}|${row.ean}`, row.count);
    }
    return counts;
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

    const source = await this.sources.findBySupermarket(entry.supermarketId);
    const name = acceptedName(req.name, entry.name, source?.adapterKey);

    // The source's own translation, so it fills a language the operator left
    // blank and never replaces one they typed (plan 0111, section 6). An
    // operator who typed an English name has said what the product is called in
    // English, and the chain does not get to overrule them.
    if (!name.en) {
      const english = await this.fetchEnglishName(entry);
      if (english) {
        name.en = english;
      }
    }

    const item: ItemView = await this.catalog.createItem({
      // Plan 0079 reverses plan 0038 section 11: a product the source does not
      // translate gets no `en` key rather than a copy of the Spanish string. A
      // copy is indistinguishable from a translation in the row, so nothing
      // could list the products still waiting for one; an absent key is a
      // visible gap the admin lists, and a reader sees the Spanish name through
      // the fallback, which is what the copy gave them anyway. Plan 0111 says
      // the same in the other direction: an English only accept writes no `es`.
      name,
      brand: req.brand === undefined ? entry.brand : req.brand,
      ean,
      unitSize:
        req.unitSize === undefined
          ? entry.unitSize === null
            ? null
            : Number(entry.unitSize)
          : req.unitSize,
      // The row's count unless the request names one (plan 0162).
      packCount:
        req.packCount === undefined ? (entry.packCount ?? null) : req.packCount,
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

  // --- Brands (plan 0115, sections 7 and 8) ---------------------------------

  /**
   * The brand keys queued rows carry that no registered brand holds (plan 0115,
   * section 7).
   *
   * **A suggestion is a key, not a spelling.** Queued is `CANDIDATE` or
   * `UNRESOLVED`: the products still waiting for a person. An `ACTIVE` row is
   * already a product and a `REJECTED` row is one the owner said is not tracked,
   * so neither counts. A product two chains carry is two source rows and counts
   * twice, which is the number the queue shows.
   *
   * The registry lives in catalog, so `registeredKeys` arrives with the request:
   * the harvester holds no copy of it, because a copy is a second answer to what
   * is registered and it can disagree with the first.
   *
   * Two things about the SQL are the plan rather than taste:
   *
   * - **The chains are a grouped subquery**, not a second query per row. Twenty
   *   suggestions on a page would otherwise be twenty round trips for a column.
   * - **The cursor is a keyset over `(productCount, key)`**. Counts move as the
   *   queue is worked, so a row can appear on two pages; the back office dedupes
   *   by key, as the admin's own queue already does by id. What a keyset buys
   *   over an offset is that a page is never *silently* short.
   */
  async brandSuggestions(
    req: ListBrandSuggestionsRequest
  ): Promise<BrandSuggestionPage> {
    await this.admin.requireAdmin(req);
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as SuggestionCursor | undefined;

    const values: unknown[] = [];
    const bind = (value: unknown): string => `$${values.push(value)}`;
    const registered = bind(req.registeredKeys ?? []);

    const filters: string[] = [];
    const query = req.query?.trim();
    if (query) {
      const key = brandKey(query);
      // Keyed before matching, so `el pozo` finds `elpozo`. A query with no
      // letters or digits keys to nothing and narrows nothing, which is the
      // plan's "answers every suggestion" rather than an empty page.
      if (key !== null) {
        filters.push(`e."brandKey" LIKE ${bind(`%${key}%`)}`);
      }
    }

    const seek =
      cursor === undefined
        ? ''
        : (() => {
            const count = bind(cursor.productCount);
            return `WHERE (g."productCount" < ${count}
                       OR (g."productCount" = ${count} AND g."key" > ${bind(cursor.key)}))`;
          })();

    const rows: SuggestionRow[] = await this.entries.query(
      `
      SELECT g.*
        FROM (
          SELECT e."brandKey"                            AS "key",
                 mode() WITHIN GROUP (ORDER BY e."brand") AS "spelling",
                 count(*)::int                           AS "productCount",
                 min(e."firstSeenAt")                    AS "firstSeenAt",
                 (
                   SELECT jsonb_agg(chain ORDER BY chain."productCount" DESC,
                                                   chain."supermarketId" ASC)
                     FROM (
                       SELECT c."supermarketId"::text AS "supermarketId",
                              count(*)::int           AS "productCount"
                         FROM "source_catalog_entries" c
                        WHERE c."status" IN ('CANDIDATE', 'UNRESOLVED')
                          AND c."brandKey" = e."brandKey"
                        GROUP BY c."supermarketId"
                     ) chain
                 )                                      AS "chains"
            FROM "source_catalog_entries" e
           WHERE e."status" IN ('CANDIDATE', 'UNRESOLVED')
             AND e."brandKey" IS NOT NULL
             AND NOT (e."brandKey" = ANY(${registered}::text[]))
             ${filters.length ? `AND ${filters.join(' AND ')}` : ''}
           GROUP BY e."brandKey"
        ) g
        ${seek}
       ORDER BY g."productCount" DESC, g."key" ASC
       LIMIT ${bind(limit + 1)}
      `,
      values
    );

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toBrandSuggestionView),
      nextCursor:
        hasMore && last
          ? encodeCursor({
              productCount: last.productCount,
              key: last.key,
            })
          : null,
    };
  }

  /**
   * How each chain spells the named brands (plan 0115, section 8).
   *
   * Every source row carrying one of the keys **except `REJECTED`**: a product
   * the owner said is not tracked still says nothing about how the chain writes
   * the brand, and counting it would inflate the number beside a spelling
   * nobody will ever see again.
   *
   * Not paged, because one brand has a handful of spellings. It is capped
   * instead, at {@link BRAND_SPELLINGS_MAX}, so a chain with a data problem
   * cannot answer a screen with ten thousand rows.
   */
  async brandSpellings(
    req: BrandSpellingsRequest
  ): Promise<BrandSpellingsResult> {
    await this.admin.requireAdmin(req);
    const keys = req.keys ?? [];
    if (keys.length === 0) {
      return { spellings: [] };
    }

    const rows: SpellingRow[] = await this.entries.query(
      `
      SELECT e."supermarketId"::text AS "supermarketId",
             e."brand"               AS "spelling",
             count(*)::int           AS "productCount",
             count(*) FILTER (
               WHERE e."status" IN ('CANDIDATE', 'UNRESOLVED')
             )::int                  AS "queuedCount"
        FROM "source_catalog_entries" e
       WHERE e."brandKey" = ANY($1::text[])
         AND e."status" <> 'REJECTED'
         AND e."brand" IS NOT NULL
       GROUP BY e."supermarketId", e."brand"
       ORDER BY e."supermarketId" ASC, count(*) DESC, e."brand" ASC
       LIMIT $2
      `,
      [keys, BRAND_SPELLINGS_MAX]
    );

    return {
      spellings: rows.map((row) => ({
        supermarketId: row.supermarketId,
        spelling: row.spelling,
        productCount: row.productCount,
        queuedCount: row.queuedCount,
      })),
    };
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

    // **The prices are filtered to this run**, not to one scope of it (plan
    // 0103, section 5.3). `source_entry_prices.runId` is already indexed, and
    // it is the column that says which run observed a row: asking for one
    // scope instead is what made a LIDL export carry no price at all.
    const entries = await this.entries.find({
      where: {
        supermarketId: run.supermarketId,
        lastRunId: run.id,
        prices: { runId: run.id },
      },
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
          adapterKey: await this.adapterOf(run.supermarketId),
        },
        entries,
        scopes: await this.scopesOf(run.supermarketId, entries),
        producedAt: new Date(),
      }),
    };
  }

  /**
   * The scopes this run's price rows name, as catalog holds them.
   *
   * Read by id from the chain's scopes rather than one at a time: a LIDL week
   * names 59 of them, and a call each would be 59 round trips for a file.
   */
  private async scopesOf(
    supermarketId: string,
    entries: readonly SourceCatalogEntry[]
  ): Promise<HarvestExportScope[]> {
    const named = new Set(
      entries.flatMap((entry) =>
        (entry.prices ?? []).map((price) => price.priceScopeId)
      )
    );
    if (named.size === 0) {
      return [];
    }
    const held: HarvestExportScope[] = [];
    for (const scope of await this.catalog.listAllPriceScopes(supermarketId)) {
      if (named.has(scope.id)) {
        held.push({
          id: scope.id,
          externalKey: scope.externalKey,
          kind: scope.kind,
          name: scope.label?.es ?? scope.label?.en ?? null,
        });
      }
    }
    return held;
  }

  /**
   * What fetches this chain, for the `adapter_key` hint.
   *
   * A chain with no source row answers nothing, which is normal: a file import
   * of a chain nobody crawls is exactly the case plan 0081 section 1 allows.
   */
  private async adapterOf(supermarketId: string): Promise<string | null> {
    const source = await this.sources.findBySupermarket(supermarketId);
    return source?.adapterKey ?? null;
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

  /**
   * ACTIVE, bound, and MANUAL: a person decided, so the confidence is 1.
   *
   * The fields it sets are {@link bindFields}, shared with the bulk replay of
   * plan 0100 so that what "accepting a row" means to the database is stated
   * once. This one saves through the repository; the bulk route saves through
   * the entity manager of the transaction it is holding open.
   */
  private async bind(
    entry: SourceCatalogEntry,
    itemId: string
  ): Promise<SourceCatalogEntry> {
    const saved = await this.entries.save(bindFields(entry, itemId));
    saved.prices = entry.prices ?? [];
    return saved;
  }

  /** Section 7's last paragraph, in {@link SourceEntryPriceWriter}. */
  private writeRowPrices(entry: SourceCatalogEntry): Promise<number> {
    return this.priceWriter.write(entry);
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
    const warehouse = await this.anyWarehouse(entry.supermarketId);
    if (warehouse === null) {
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
      // saved with the languages it already has and the admin can add the
      // other one later.
      this.logger.warn(
        `Could not fetch the English name for ${entry.externalId}: ${String(error)}`
      );
      return null;
    }
  }

  /**
   * A warehouse of this chain's, for a read that does not care which one.
   *
   * **The warehouse is a price scope's own `externalKey`** and is no longer a
   * field on the source row (plan 0108, D2). It used to be `config.warehouse`,
   * one string for the whole chain, and deleting it rather than deprecating it
   * is the point: leaving two answers in place leaves the wrong one with no
   * error attached.
   *
   * Any of them will do here. The detail endpoint answers for every warehouse
   * that stocks the product, and an English name is the same string in all of
   * them, so this takes the first scope that carries a key rather than asking
   * an operator to choose one for a name.
   */
  private async anyWarehouse(supermarketId: string): Promise<string | null> {
    try {
      const scopes = await this.catalog.listAllPriceScopes(supermarketId);
      return scopes.find((scope) => scope.externalKey)?.externalKey ?? null;
    } catch (error) {
      this.logger.warn(
        `Could not read the scopes of ${supermarketId}: ` +
          describeError(error).message
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
