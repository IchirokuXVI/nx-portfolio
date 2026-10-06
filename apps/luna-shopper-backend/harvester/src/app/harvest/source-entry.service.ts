import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  BRAND_SPELLINGS_MAX,
  brandKey,
  HarvestRunMode,
  HarvestRunStatus,
  ItemSourceMatch,
  PriceSourceKind,
  SourceEntryStatus,
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
  type SettleItemAtChainRequest,
  type SettleItemAtChainResult,
  type SourceCatalogEntryPage,
  type SourceCatalogEntryView,
  type SourceEntryAcceptResult,
  type SourceEntryIdRequest,
} from '@portfolio/luna-shopper/contracts';
import { MercadonaClient } from '@portfolio/luna-shopper/mercadona';
import {
  CATEGORY_UNKNOWN_DETAIL,
  CategoryNotFoundException,
  clampPageSize,
  ConflictException,
  decodeCursor,
  describeError,
  encodeCursor,
  ITEM_EAN_DETAIL,
  ITEM_EAN_HOLDER_DETAIL,
  ItemEanHeldException,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { In, Not, Repository } from 'typeorm';
import type { HarvesterConfig } from '../config/app-config';
import { HarvestRun, SourceCatalogEntry, SourceEntryPrice } from '../entities';
import { CatalogClient } from './catalog-client.service';
import { CategorySlugIndex, categorySlugsFor } from './category-resolution';
import {
  buildHarvestDocument,
  type HarvestExportScope,
} from './harvest-export';
import { toSourceCatalogEntryView } from './harvest.mappers';
import { PlatformAdminService } from './platform-admin.service';
import { SourceEntryAvailabilityWriter } from './source-entry-availability';
import { acceptedName } from './source-entry-name';
import { SourceEntrySettler } from './source-entry-settle';
import { createdSize } from './source-entry-size';
import {
  bindFields,
  chainEanCounts,
  chainEanKey,
  createdEan,
  eanHeldDetail,
  eanStaysDetail,
  openPrices,
  sharesEanInChain,
  SourceEntryPriceWriter,
  taughtEan,
  type PriceWriteOutcome,
} from './source-entry-write';
import { suggestedBrandRows } from './suggested-brand-rows';
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

/**
 * The barcode a decision gives the row's product (plan 0185), and the product
 * it has to leave first when the row is moving (plan 0191).
 */
interface BarcodePlan {
  ean: string;
  /** The product the row leaves, when it holds the barcode on this row's word alone. */
  takeFrom: string | null;
}

/**
 * The product a decision takes a row off (plan 0191): the one it was bound to,
 * unless the decision binds it to that same product again.
 *
 * Only an `ACTIVE` row is bound. A `CANDIDATE` row carries a product too, as a
 * proposal, and wrote nothing on it.
 */
function leftItemOf(
  entry: SourceCatalogEntry,
  nextItemId: string | null
): string | null {
  if (entry.status !== SourceEntryStatus.ACTIVE || !entry.itemId) {
    return null;
  }
  return entry.itemId === nextItemId ? null : entry.itemId;
}

/**
 * Add to an error the product a decision took its row off, and the chain
 * (plan 0191), and answer the error to throw.
 *
 * A decision on a bound row cannot be asked again for the old product: once
 * the row is saved it names the new product, or none, and nothing remembers
 * the one it left. So an error after that save says which product that was
 * and whether it was settled, and a person can call the settle route.
 *
 * The error keeps its class and its code. Only its sentence grows.
 */
export function namingLeftProduct(
  error: unknown,
  left: { itemId: string; supermarketId: string; settled: boolean }
): unknown {
  const sentence = left.settled
    ? `The row was taken off product ${left.itemId}, and that product was ` +
      `settled at chain ${left.supermarketId} before this failed.`
    : `The row was taken off product ${left.itemId}, and that product was ` +
      `NOT settled at chain ${left.supermarketId}: it still holds what the ` +
      `row wrote. Call POST /v1/admin/harvest/items/${left.itemId}/settle ` +
      `with { "supermarketId": "${left.supermarketId}" } to finish it.`;
  if (error instanceof Error) {
    error.message = `${error.message} ${sentence}`;
    return error;
  }
  if (error !== null && typeof error === 'object') {
    // A problem object from catalog over NATS: `detail` is what the thrower
    // wrote, and `message` the sentence for its code.
    const problem = error as Record<string, unknown>;
    const field = typeof problem['detail'] === 'string' ? 'detail' : 'message';
    return {
      ...problem,
      [field]:
        typeof problem[field] === 'string'
          ? `${problem[field]} ${sentence}`
          : sentence,
    };
  }
  return new Error(`${describeError(error).message} ${sentence}`);
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
    private readonly config: ConfigService,
    private readonly availability: SourceEntryAvailabilityWriter,
    private readonly settler: SourceEntrySettler
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
   *
   * Each row also names the other bound rows of its chain that price a scope
   * it prices (plan 0191, {@link scopeSharers}).
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
    const sharers = await this.scopeSharers(req.itemId, page);
    return {
      items: page.map((row) => ({
        ...toSourceCatalogEntryView(row),
        eanSharedBy: row.ean ? (shared.get(chainEanKey(row)) ?? 1) : null,
        scopeSharedWith: sharers.get(row.id) ?? [],
      })),
      nextCursor:
        hasMore && last
          ? encodeCursor({ value: last.lastSeenAt.toISOString(), id: last.id })
          : null,
    };
  }

  /**
   * For each bound row of a page, the other bound rows of its chain and
   * source kind that hold an open price at a scope it holds one at (plan
   * 0191).
   *
   * Read over every bound row of the product and not over the page, because
   * the row a page row shares a scope with can be on another page. A product
   * has a handful of rows, so that is one small read.
   */
  private async scopeSharers(
    itemId: string,
    page: readonly SourceCatalogEntry[]
  ): Promise<Map<string, string[]>> {
    const sharers = new Map<string, string[]>();
    if (!page.some((row) => row.status === SourceEntryStatus.ACTIVE)) {
      return sharers;
    }
    const bound = await this.entries.find({
      where: { itemId, status: SourceEntryStatus.ACTIVE },
      relations: { prices: true },
      order: { decidedAt: 'ASC', id: 'ASC' },
    });
    const now = new Date();
    const scopesOf = new Map(
      bound.map((row) => [
        row.id,
        new Set(openPrices(row, now).map((price) => price.priceScopeId)),
      ])
    );
    for (const row of page) {
      const mine = scopesOf.get(row.id);
      if (!mine || mine.size === 0) {
        continue;
      }
      const others = bound.filter(
        (other) =>
          other.id !== row.id &&
          other.supermarketId === row.supermarketId &&
          other.sourceKind === row.sourceKind &&
          [...(scopesOf.get(other.id) ?? [])].some((scope) => mine.has(scope))
      );
      if (others.length > 0) {
        sharers.set(
          row.id,
          others.map((other) => other.id)
        );
      }
    }
    return sharers;
  }

  /** How many rows each (chain, EAN) of these rows has, in one query. */
  private eanCounts(
    rows: readonly SourceCatalogEntry[]
  ): Promise<Map<string, number>> {
    return chainEanCounts(this.entries, rows);
  }

  /**
   * Bind a queued row to a product the catalog already holds, then the prices.
   *
   * **Accepting a row teaches its barcode** (plan 0185). A maker prints a new
   * barcode on the same product, so a row whose real EAN no product holds
   * gives that EAN to the product it is accepted onto, and the next run binds
   * the row's siblings by themselves. When **another** product holds it, the
   * accept is refused with `item_ean_held` before anything is written: either
   * the row belongs to that product, or the barcode sits on the wrong one, and
   * a person settles which.
   *
   * **A row whose EAN another row of its chain prints does neither.** That
   * barcode names no single product (plan 0155), so the row is bound and its
   * prices are written as before the plan, with no teach and no refusal.
   *
   * The barcode is written before the prices and the availability
   * ({@link afterLeaving} says why), and under the rule they follow on this
   * route: the bind stands, every later step still runs, and the first write
   * that failed is the error the request answers with.
   *
   * **A bound row can be accepted again, onto another product** (plan 0191).
   * That is a move, and the row takes with it what it wrote on the product it
   * leaves:
   *
   * - Its barcode, when that product holds it on this row's word alone
   *   ({@link barcodeToTeach}). It is taken off the old product and taught to
   *   the new one.
   * - Its prices, offers and shop rows, which {@link SourceEntrySettler}
   *   withdraws from the old product **right after the bind is saved**
   *   ({@link afterLeaving}). It depends on the bind alone, and a retry of
   *   the decision cannot do it: the saved row no longer names the product
   *   it left. So it runs before any step that can fail, and every error
   *   after the save names the old product and the chain.
   *
   * **A second article of the chain on the product writes no price where the
   * two disagree** (plan 0191, decision 2A). The row is bound, `pricesWritten`
   * counts what was written, and `pricesWithheld` names the row it met.
   */
  async accept(
    req: AcceptSourceEntryRequest
  ): Promise<SourceEntryAcceptResult> {
    await this.admin.requireAdmin(req);
    const entry = await this.load(req.entryId);
    // Read before the bind, which overwrites it.
    const left = leftItemOf(entry, req.itemId);
    const teach = await this.barcodeToTeach(
      entry,
      { itemId: req.itemId },
      left
    );
    const bound = await this.bind(entry, req.itemId);
    const { settled, value: prices } = await this.afterLeaving(
      left,
      bound,
      teach === null ? null : () => this.teachBarcode(req.itemId, teach),
      () => this.writeRowPrices(bound)
    );
    return {
      entry: toSourceCatalogEntryView(bound),
      pricesWritten: prices.written,
      createdItem: null,
      pricesWithheld: prices.withheld,
      settled,
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
   *
   * **A create teaches and refuses like an accept** (plan 0185). The product is
   * created with the EAN the request names, or the row's when it names none.
   * When the request names another EAN, or none at all, the new product does
   * not hold the barcode its own row prints. The rule of {@link accept} then
   * applies to that barcode: another product that holds it refuses the create
   * with `item_ean_held` before anything is written, and otherwise the barcode
   * is added to the new product after the bind. A row whose EAN another row of
   * its chain prints does neither, as on an accept.
   *
   * **A create from a bound row is a move too** (plan 0191): a person finds
   * that the row is a product of its own. Everything {@link accept} says about
   * a move holds here. The one difference is the barcode the product would be
   * created with: when the product the row leaves holds it on this row's word
   * alone, the new product is created with no barcode, and the barcode is
   * taken off the old product and taught to the new one after the bind.
   * Catalog holds a barcode on one product, so it cannot be on both even for
   * the length of this call.
   */
  async createItem(
    req: CreateItemFromSourceEntryRequest
  ): Promise<SourceEntryAcceptResult> {
    await this.admin.requireAdmin(req);
    const entry = await this.load(req.entryId);
    // Read before the bind, which overwrites it.
    const left = leftItemOf(entry, null);
    // A real barcode or none (plan 0184). The row keeps what the chain
    // printed; an in-store code or an invalid one never reaches the product.
    let ean = createdEan(entry, req.ean);

    // EAN is unique in catalog, so a duplicate would be refused by the database
    // anyway. Asking first turns that into a sentence naming the existing item.
    if (ean) {
      const { item } = await this.catalog.findItemByEan(ean);
      if (
        item &&
        item.id === left &&
        ean === taughtEan(entry) &&
        !sharesEanInChain(entry, await this.eanCounts([entry]))
      ) {
        // The row's own barcode, on the product the row is leaving. Whether
        // it may move is `barcodeToTeach`'s to say, just below. Until it has
        // moved the new product cannot be created with it.
        ean = null;
      } else if (item) {
        throw new ConflictException(
          `Catalog already holds an item with EAN ${ean} (${item.id}). ` +
            'Accept this row onto that product instead of creating a second one.'
        );
      }
    }
    // The row's own barcode, when the product is not created with it (plan
    // 0185). Asked before anything is created, so a refusal writes nothing.
    const teach = await this.barcodeToTeach(entry, { createdWith: ean }, left);

    // Slugs on the way in, ids on the way to catalog (plan 0166, section 7).
    // Resolved before the English name is fetched, so a typo in an override
    // costs no request to the chain.
    // The chain's adapter is read first, because it decides how the row's
    // category is read (plan 0174, section 7).
    const source = await this.sources.findBySupermarket(entry.supermarketId);
    const categoryIds = await this.categoryIdsOf(
      categorySlugsFor(req.categorySlugs, entry.categoryPath, {
        adapterKey: source?.adapterKey,
        extra: entry.extra,
      })
    );

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

    // The row's size in a base unit, unless the request names its own (plan
    // 0183): a row of 0.25 `KILOGRAM` creates a product of 250 `GRAM`. The
    // unit the row states comes before the guess from the printed text (plan
    // 0177): `75 cl` is held as 750 `MILLILITER`, and the text alone maps to
    // nothing, which made the product 750 units.
    const size = createdSize(entry, req);
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
      unitSize: size.unitSize,
      // The row's count unless the request names one (plan 0162).
      packCount:
        req.packCount === undefined ? (entry.packCount ?? null) : req.packCount,
      // Never from the chain (plan 0038, section 5.7): `imageUrl` comes from
      // Open Food Facts or the owner, and is never rehosted from a supermarket's
      // own photography.
      imageUrl: null,
      sku: null,
      categoryIds,
      defaultUnit: size.unit,
    });

    const bound = await this.bind(entry, item.id);
    const { settled, value: prices } = await this.afterLeaving(
      left,
      bound,
      teach === null ? null : () => this.teachBarcode(item.id, teach),
      () => this.writeRowPrices(bound)
    );
    return {
      entry: toSourceCatalogEntryView(bound),
      pricesWritten: prices.written,
      createdItem: item,
      pricesWithheld: prices.withheld,
      settled,
    };
  }

  /**
   * Not a product he tracks.
   *
   * Kept as a REJECTED row rather than deleted, so the next run that observes
   * the key touches the row and asks nobody. The status is the owner's, and a
   * run does not get to overwrite a decision; plan 0082 keeps it through a
   * revert for the same reason.
   *
   * **Rejecting a bound row takes back what it wrote** (plan 0191). The
   * product it was bound to is settled at the row's chain after the save: the
   * prices this row stated go, and when no other row of the chain names the
   * product, so do its offers and the shop rows runs wrote. A failure there
   * leaves the row rejected and is the error the request answers with, and
   * the error names the product and the chain: a second reject cannot settle
   * it, because the saved row names no product.
   *
   * The barcode stays on the product. A rejected row names no product, so
   * there is nowhere for it to go, and whether the product keeps a barcode
   * nothing prints any more is a person's call.
   */
  async reject(req: SourceEntryIdRequest): Promise<SourceCatalogEntryView> {
    await this.admin.requireAdmin(req);
    const entry = await this.load(req.entryId);
    // Read before the fields below clear it.
    const left = leftItemOf(entry, null);
    entry.status = SourceEntryStatus.REJECTED;
    entry.itemId = null;
    entry.candidateEntryId = null;
    entry.matchedBy = ItemSourceMatch.MANUAL;
    entry.confidence = 1;
    entry.decidedAt = new Date();
    // name, brand and sizeFormat are deliberately untouched (D8).
    const saved = await this.entries.save(entry);
    await this.afterLeaving(left, saved, null, async () => undefined);
    return toSourceCatalogEntryView(saved);
  }

  /**
   * Settle a product at a chain, for a person (plan 0191).
   *
   * The one time repair of the rows that left a product before the plan
   * landed, and the retry of a decision whose own settle failed. `dryRun`
   * answers what a call would do and writes nothing.
   *
   * An unknown chain is refused by catalog, as `not_found`. An unknown
   * product is not: the harvester does not own products, no row names it, and
   * catalog holds nothing for it, so the answer is zeros.
   */
  async settleItem(
    req: SettleItemAtChainRequest
  ): Promise<SettleItemAtChainResult> {
    await this.admin.requireAdmin(req);
    await this.catalog.getSupermarket(req.supermarketId);
    return this.settler.settle(req.itemId, req.supermarketId, {
      dryRun: req.dryRun === true,
    });
  }

  /**
   * The steps of a decision that follow the save of the row (plan 0191): the
   * settle of the product the row left, the barcode, and `rest`, which is
   * the prices and the availability.
   *
   * **Each step runs whatever happened to the one before it**, and the first
   * error is the one the request answers with. The steps do not depend on
   * each other, and each one is owed to a different product or table.
   *
   * **The settle comes first because nothing can ask for it again.** The
   * decision reads the old product off the row before it saves. After the
   * save the row names the new product, or none, so a retry of the same
   * decision finds no product to settle. It is told the prices of the row
   * that left (`leaving`), which is how catalog knows what that row wrote.
   *
   * **The barcode comes before the prices for the same reason.** A move takes
   * the barcode off the old product and teaches it to the new one. If the
   * price write failed first and the barcode never moved, the retry would
   * find the barcode on a product that is neither the new one nor, any more,
   * the one the row is leaving, and would be refused with `item_ean_held`
   * before it wrote the price it owes.
   *
   * **Every failure after the save names the old product and the chain**
   * ({@link namingLeftProduct}), and says whether it was settled.
   *
   * A decision that takes the row off no product runs the barcode and `rest`
   * and nothing else.
   */
  private async afterLeaving<T>(
    left: string | null,
    entry: SourceCatalogEntry,
    barcode: (() => Promise<void>) | null,
    rest: () => Promise<T>
  ): Promise<{ settled: SettleItemAtChainResult | null; value: T }> {
    const failures: unknown[] = [];
    const attempt = async <R>(
      what: string,
      step: () => Promise<R>
    ): Promise<R | undefined> => {
      try {
        return await step();
      } catch (error) {
        failures.push(error);
        this.logger.error(
          `Row ${entry.id}, bound to ${entry.itemId ?? 'no product'}` +
            `${left ? ` after leaving ${left}` : ''}: ${what} failed: ` +
            describeError(error).message
        );
        return undefined;
      }
    };

    const settled =
      left === null
        ? null
        : ((await attempt('settling the product it left', () =>
            this.settler.settle(left, entry.supermarketId, {
              leaving: entry.prices ?? [],
            })
          )) ?? null);
    if (barcode !== null) {
      await attempt('moving its barcode', barcode);
    }
    const value = await attempt('writing its prices', rest);

    if (failures.length > 0) {
      throw left === null
        ? failures[0]
        : namingLeftProduct(failures[0], {
            itemId: left,
            supermarketId: entry.supermarketId,
            settled: settled !== null,
          });
    }
    return { settled, value: value as T };
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
           WHERE ${suggestedBrandRows(registered)}
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

  /**
   * The barcode this decision will give the row's product, or null when there
   * is nothing to give (plan 0185). One rule for an accept and for a create.
   *
   * The product is `itemId` for an accept. A create has no product yet, and
   * names the EAN it will be created with instead.
   *
   * Null for a row with no real barcode, for one whose barcode the product
   * already holds or is created with, and for one whose EAN another row of
   * its chain prints. Refuses with `item_ean_held` when another product holds
   * it. Asked before anything is written, so a refusal writes nothing.
   *
   * **The barcode moves with the row** (plan 0191). `left` is the product the
   * decision takes the row off. When that is the product holding the barcode,
   * the row itself may be the only reason it does: accepting the row there
   * taught it. So the barcode leaves the old product and goes to the new one,
   * unless another row still bound to the old product prints it too. That
   * row is a second reason for the barcode to be where it is, and the refusal
   * then names it. A barcode the row's own chain prints on another row was
   * never taught, so it never moves: the shared rule above answers first.
   */
  private async barcodeToTeach(
    entry: SourceCatalogEntry,
    product: { itemId: string } | { createdWith: string | null },
    left: string | null = null
  ): Promise<BarcodePlan | null> {
    const itemId = 'itemId' in product ? product.itemId : null;
    const ean = taughtEan(entry);
    if (ean === null) {
      return null;
    }
    if ('createdWith' in product && product.createdWith === ean) {
      return null;
    }
    // Shared inside its chain: no teach and no refusal, and catalog is not
    // asked. The count is the ingest's own (`ChainEanIndex`).
    if (sharesEanInChain(entry, await this.eanCounts([entry]))) {
      return null;
    }
    const { item } = await this.catalog.findItemByEan(ean);
    if (item === null) {
      return { ean, takeFrom: null };
    }
    if (item.id === itemId) {
      return null;
    }
    if (item.id === left) {
      const others = await this.othersPrinting(entry, ean, left);
      if (others.length === 0) {
        return { ean, takeFrom: left };
      }
      throw new ItemEanHeldException(
        eanStaysDetail(ean, left, itemId, others),
        {
          details: { [ITEM_EAN_DETAIL]: ean, [ITEM_EAN_HOLDER_DETAIL]: left },
        }
      );
    }
    throw new ItemEanHeldException(eanHeldDetail(ean, item.id, itemId), {
      details: { [ITEM_EAN_DETAIL]: ean, [ITEM_EAN_HOLDER_DETAIL]: item.id },
    });
  }

  /**
   * The other rows, of any chain, that are bound to `itemId` and print this
   * barcode (plan 0191). The row prints what its chain printed, so both the
   * printed text and the barcode read from it are asked for.
   */
  private async othersPrinting(
    entry: SourceCatalogEntry,
    ean: string,
    itemId: string
  ): Promise<string[]> {
    const printed = [...new Set([ean, ...(entry.ean ? [entry.ean] : [])])];
    const rows = await this.entries.find({
      where: {
        id: Not(entry.id),
        itemId,
        status: SourceEntryStatus.ACTIVE,
        ean: In(printed),
      },
      order: { id: 'ASC' },
    });
    return rows.map((row) => row.id);
  }

  /**
   * Give the product the barcode its row printed (plan 0185), after an accept
   * or a create.
   *
   * The check before the bind already found nobody holding it, so a refusal
   * here is another write that took it in between, and it is answered as the
   * conflict it is. The bind stands either way.
   *
   * **For a row that is moving, the barcode leaves the old product first**
   * (plan 0191). Catalog holds a barcode on one product, so the teach would
   * be refused while the old one has it.
   */
  private async teachBarcode(itemId: string, plan: BarcodePlan): Promise<void> {
    const { ean } = plan;
    if (plan.takeFrom !== null) {
      await this.catalog.removeItemEan(plan.takeFrom, ean);
    }
    const { refused } = await this.catalog.teachItemEans([{ itemId, ean }]);
    const [refusal] = refused;
    if (!refusal) {
      return;
    }
    if (refusal.reason === 'HELD' && refusal.heldBy) {
      throw new ItemEanHeldException(
        eanHeldDetail(ean, refusal.heldBy, itemId),
        {
          details: {
            [ITEM_EAN_DETAIL]: ean,
            [ITEM_EAN_HOLDER_DETAIL]: refusal.heldBy,
          },
        }
      );
    }
    throw new ConflictException(
      `The row is bound to ${itemId}, but its barcode ${ean} could not be ` +
        `added to the product (${refusal.reason}).`
    );
  }

  /**
   * What a bound row owes catalog, and the one step both decisions make.
   *
   * Its prices first, which is section 7's last paragraph in
   * {@link SourceEntryPriceWriter}. Then what the runs said about where the
   * product is sold (plan 0182): the stored claims for the shops that are
   * mapped, and for a row that holds no price an offer with no price in the
   * chain's default scope, because a chain that lists a product sells it. A
   * DEZA row has no price by design, so before this step existed accepting one
   * wrote nothing at all and the product was sold nowhere.
   *
   * Answers the prices written and the ones withheld (plan 0191), which is
   * what the caller reports.
   */
  private async writeRowPrices(
    entry: SourceCatalogEntry
  ): Promise<PriceWriteOutcome> {
    const outcome = await this.priceWriter.writeNamed(entry);
    await this.availability.writeForEntries([entry]);
    return outcome;
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

  /**
   * The ids of `slugs`, through one read of the tree (plan 0166, section 7).
   * A slug the tree does not hold is refused here with `category_not_found`,
   * naming every such slug, before anything is written.
   */
  private async categoryIdsOf(slugs: readonly string[]): Promise<string[]> {
    const index = new CategorySlugIndex(await this.catalog.categoryTree());
    const resolved = index.resolve(slugs);
    if (resolved.ids === null) {
      throw new CategoryNotFoundException(
        `No category has the slug ${resolved.unknown.join(', ')}.`,
        { details: { [CATEGORY_UNKNOWN_DETAIL]: resolved.unknown } }
      );
    }
    return resolved.ids;
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
