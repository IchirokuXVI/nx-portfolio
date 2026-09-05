import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  HarvestRunMode,
  HarvestRunStatus,
  ItemSourceMatch,
  PriceSourceKind,
  SourceAliasStatus,
  type AcceptSourceAliasRequest,
  type CreateItemFromSourceAliasRequest,
  type ItemPriceBatchEntry,
  type ItemView,
  type LeafletDocument,
  type LeafletOffer,
  type ListSourceAliasesRequest,
  type SourceAliasAcceptResult,
  type SourceAliasIdRequest,
  type SourceAliasPage,
  type SourceAliasView,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { In, Repository } from 'typeorm';
import { HarvestRun, SourceAlias } from '../entities';
import { CatalogClient } from './catalog-client.service';
import { toSourceAliasView } from './harvest.mappers';
import { readLeafletDocument } from './leaflet-document.reader';
import { detailsOf, duplicateKeysIn } from './leaflet-import.runner';
import { aliasKeyFor, decideOffer } from './leaflet-rules';
import { PlatformAdminService } from './platform-admin.service';

interface AliasCursor {
  value: string;
  id: string;
}

/** The two statuses that are waiting for a person: the queue (section 3). */
const QUEUED = [SourceAliasStatus.CANDIDATE, SourceAliasStatus.UNRESOLVED];

/**
 * The names a chain printed, and the three decisions an admin makes about one
 * (plan 0081, sections 2 and 3).
 *
 * **Only what happens here ever creates an ACTIVE alias.** The import proposes
 * and never binds, because a bad fuzzy match writes a wrong price onto a real
 * product that people then shop on.
 *
 * The other half of the rule is that **accepting writes the price the alias was
 * queued for**. The run that queued it is over by then, and the offer sits in
 * that run's stored document, so an accept reads every still open import for the
 * chain and writes the prices with each run's own id. Without it an admin who
 * works the queue would have to upload the document a second time to get the
 * prices he just resolved, and plan 0082 would have no run id to take them back
 * by.
 */
@Injectable()
export class SourceAliasService {
  private readonly logger = new Logger(SourceAliasService.name);

  constructor(
    @InjectRepository(SourceAlias)
    private readonly aliases: Repository<SourceAlias>,
    @InjectRepository(HarvestRun)
    private readonly runs: Repository<HarvestRun>,
    private readonly catalog: CatalogClient,
    private readonly admin: PlatformAdminService
  ) {}

  /**
   * The queue, per chain. Absent `status` means the two that are waiting for a
   * person, which is what the back office asks for.
   *
   * The offer's own price, page, raw text and confidence are **not** columns
   * here: they belong to the document the run stored, and copying them onto the
   * alias would be a second copy to go stale when a later leaflet prints the
   * same string at a different price. They are read back from the runs this page
   * names, which is one document per page rather than one per row.
   */
  async list(req: ListSourceAliasesRequest): Promise<SourceAliasPage> {
    await this.admin.requireAdmin(req);
    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as AliasCursor | undefined;

    const qb = this.aliases
      .createQueryBuilder('a')
      .where('a."supermarketId" = :sid', { sid: req.supermarketId })
      .orderBy('a."lastSeenAt"', 'DESC')
      .addOrderBy('a.id', 'DESC')
      .take(limit + 1);
    if (req.status) {
      qb.andWhere('a.status = :status', { status: req.status });
    } else {
      qb.andWhere('a.status IN (:...queued)', { queued: QUEUED });
    }
    if (req.query?.trim()) {
      qb.andWhere(
        '(a."printedName" ILIKE :q OR a."printedFormat" ILIKE :q OR a."printedBrand" ILIKE :q)',
        { q: `%${req.query.trim()}%` }
      );
    }
    if (cursor) {
      qb.andWhere('(a."lastSeenAt", a.id) < (:cv, :cid)', {
        cv: cursor.value,
        cid: cursor.id,
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const offers = await this.offersFor(page);
    return {
      items: page.map((row) => toSourceAliasView(row, offers.get(row.id))),
      nextCursor:
        hasMore && last
          ? encodeCursor({ value: last.lastSeenAt.toISOString(), id: last.id })
          : null,
    };
  }

  /** Bind a queued name to a product the catalog already holds. */
  async accept(
    req: AcceptSourceAliasRequest
  ): Promise<SourceAliasAcceptResult> {
    await this.admin.requireAdmin(req);
    const alias = await this.load(req.aliasId);
    const bound = await this.bind(alias, req.itemId);
    const pricesWritten = await this.writeQueuedPrices(bound);
    return { alias: toSourceAliasView(bound), pricesWritten, item: null };
  }

  /**
   * Create the product this name is for, and bind it, in one call.
   *
   * `name.en` may be absent since plan 0079: a leaflet product is saved with its
   * Spanish name alone and a reader in English sees it through the fallback.
   * The operator changes the name and the brand freely, and **the alias keeps
   * what the leaflet printed** whatever the item ends up called.
   */
  async createItem(
    req: CreateItemFromSourceAliasRequest
  ): Promise<SourceAliasAcceptResult> {
    await this.admin.requireAdmin(req);
    const alias = await this.load(req.aliasId);
    const name = {
      ...(req.name.es?.trim() ? { es: req.name.es.trim() } : {}),
      ...(req.name.en?.trim() ? { en: req.name.en.trim() } : {}),
    };
    if (Object.keys(name).length === 0) {
      throw new ValidationException(
        'A product needs a name in at least one language.',
        { details: { name: 'give at least one of es or en' } }
      );
    }

    const item: ItemView = await this.catalog.createItem({
      name,
      brand: req.brand ?? alias.printedBrand ?? null,
      ean: req.ean ?? null,
      unitSize: req.unitSize ?? null,
      // Never from the chain (plan 0038, section 5.7): a product photograph is
      // not ours to rehost, and a leaflet carries none anyway.
      imageUrl: null,
      sku: null,
      category: req.category,
      defaultUnit: req.defaultUnit,
    });

    const bound = await this.bind(alias, item.id);
    const pricesWritten = await this.writeQueuedPrices(bound);
    return { alias: toSourceAliasView(bound), pricesWritten, item };
  }

  /**
   * Refuse a name. Kept as a REJECTED row rather than deleted, so the next
   * leaflet that prints it skips the offer with a warning instead of queueing
   * the same string again: the status is the owner's, and a run does not get to
   * overwrite a decision. Plan 0082 keeps it through a revert for the same
   * reason.
   */
  async reject(req: SourceAliasIdRequest): Promise<SourceAliasView> {
    await this.admin.requireAdmin(req);
    const alias = await this.load(req.aliasId);
    alias.status = SourceAliasStatus.REJECTED;
    alias.itemId = null;
    alias.matchedBy = ItemSourceMatch.MANUAL;
    alias.confidence = 1;
    return toSourceAliasView(await this.aliases.save(alias));
  }

  /**
   * Drop the rows one run queued that nobody has decided on (plan 0082,
   * section 3), and answer how many went.
   *
   * **An alias a person decided on survives the run that created it.** An
   * `ACTIVE` one is a mapping other leaflets already resolve through, and
   * deleting it would make the next leaflet ask again for a product the owner
   * already named. A `REJECTED` one is the owner saying this is not a product
   * he tracks, and a run does not get to reopen that. The run's mistake was in
   * its prices, not in the strings it read, and the string the chain printed is
   * still the string the chain printed. What goes with the prices is the price
   * an accept wrote, so an accepted alias survives with nothing behind it until
   * the next import.
   *
   * A `CANDIDATE` or `UNRESOLVED` row is different: nobody decided on it, and
   * it sits in the queue only because this run put it there. A run that must
   * not introduce anything must not introduce work for a person either. The
   * next import of a corrected document recreates it if the strings are still
   * printed.
   *
   * Keyed on `firstRunId`, so an older alias this run merely saw again keeps
   * its `timesSeen` and `lastSeenAt`: those are observations of a string on a
   * page, and the string was on the page.
   *
   * Not admin gated here. It is one step of `harvest.revert`, which is gated
   * once, at its own door.
   */
  async deleteUndecidedFrom(runId: string): Promise<number> {
    const result = await this.aliases.delete({
      firstRunId: runId,
      status: In(QUEUED),
    });
    return result.affected ?? 0;
  }

  /** ACTIVE, bound, and MANUAL: a person decided, so the confidence is 1. */
  private async bind(alias: SourceAlias, itemId: string): Promise<SourceAlias> {
    alias.itemId = itemId;
    alias.status = SourceAliasStatus.ACTIVE;
    alias.matchedBy = ItemSourceMatch.MANUAL;
    alias.confidence = 1;
    // printedName, printedFormat and printedBrand are deliberately untouched.
    // The item may be renamed to anything at all and the next leaflet that
    // prints this string still resolves through this row (section 2).
    return this.aliases.save(alias);
  }

  /**
   * Section 3's last paragraph: write the prices this name was queued for.
   *
   * Every non reverted import for the chain whose window is still open is read,
   * the offers carrying this alias key are found in its stored document, and
   * their prices are written **with that run's own id**, so plan 0082 can take
   * them back with the rest of the run's rows.
   *
   * A run whose window has closed writes nothing: an expired leaflet price is
   * not a price anybody is charged, and inserting one only to have the resolver
   * filter it out is work with a wrong row at the end of it.
   */
  private async writeQueuedPrices(alias: SourceAlias): Promise<number> {
    if (!alias.itemId) {
      return 0;
    }
    const runs = await this.openImportsFor(alias.supermarketId);
    let written = 0;

    for (const run of runs) {
      const priceScopeId = run.priceScopeId;
      if (!priceScopeId) {
        continue;
      }
      let document: LeafletDocument;
      try {
        document = readLeafletDocument(readDocument(run.input));
      } catch (error) {
        // A stored document that no longer parses is this run's problem and not
        // this accept's: the other runs still have prices to contribute.
        this.logger.warn(
          `Run ${run.id} stored a document that no longer validates, so the ` +
            `accept of alias ${alias.id} skipped it: ${String(error)}`
        );
        continue;
      }

      const duplicates = duplicateKeysIn(document.offers);
      const entries = this.entriesFor(document, alias, duplicates, run);
      if (entries.length === 0) {
        continue;
      }
      const result = await this.catalog.addPrices(
        priceScopeId,
        entries,
        run.id,
        PriceSourceKind.OFFICIAL_LEAFLET
      );
      written += result.inserted;
    }
    return written;
  }

  /** The offers of one document that this alias resolves, priced by the rules. */
  private entriesFor(
    document: LeafletDocument,
    alias: SourceAlias,
    duplicates: Set<string>,
    run: HarvestRun
  ): ItemPriceBatchEntry[] {
    const window = storedWindow(run.input);
    if (!window) {
      return [];
    }
    const entries: ItemPriceBatchEntry[] = [];
    for (const offer of document.offers) {
      if (
        aliasKeyFor(offer) !== alias.aliasKey ||
        duplicates.has(alias.aliasKey)
      ) {
        continue;
      }
      const decision = decideOffer(offer);
      if (decision.kind !== 'write') {
        continue;
      }
      entries.push({
        itemId: alias.itemId as string,
        price: decision.pricing.price,
        currency: decision.pricing.currency,
        unitPrice: decision.pricing.unitPrice,
        unitPriceLabel: decision.pricing.unitPriceLabel,
        validFrom: window.validFrom,
        validUntil: window.validUntil,
        details: detailsOf(offer),
      });
    }
    return entries;
  }

  /**
   * The imports for a chain whose validity has not run out, newest first.
   *
   * A FAILED run is excluded because it wrote nothing, and a reverted one
   * because plan 0082 says its claims were wrong. The window comparison is on
   * the resolved instant the spawn stored, not on the document's local days.
   */
  private openImportsFor(supermarketId: string): Promise<HarvestRun[]> {
    return this.runs
      .createQueryBuilder('r')
      .where('r.mode = :mode', { mode: HarvestRunMode.LEAFLET_IMPORT })
      .andWhere('r."supermarketId" = :sid', { sid: supermarketId })
      .andWhere('r."revertedAt" IS NULL')
      .andWhere('r.status <> :failed', { failed: HarvestRunStatus.FAILED })
      .andWhere(`(r.input ->> 'validUntil')::timestamptz > now()`)
      .orderBy('r."requestedAt"', 'DESC')
      .getMany();
  }

  /**
   * The offer each queued row is waiting on, read from the run that queued it.
   *
   * One document per distinct run on the page, which for a queue filtered to
   * one chain is normally one.
   */
  private async offersFor(
    rows: SourceAlias[]
  ): Promise<Map<string, LeafletOffer>> {
    const runIds = [
      ...new Set(rows.map((row) => row.lastRunId).filter(Boolean)),
    ] as string[];
    const found = new Map<string, LeafletOffer>();
    if (runIds.length === 0) {
      return found;
    }
    const runs = await this.runs.find({ where: { id: In(runIds) } });
    const byRun = new Map<string, Map<string, LeafletOffer>>();
    for (const run of runs) {
      const document = readDocument(run.input);
      const offers = (document as LeafletDocument | null)?.offers;
      if (!Array.isArray(offers)) {
        continue;
      }
      const byKey = new Map<string, LeafletOffer>();
      for (const offer of offers) {
        byKey.set(aliasKeyFor(offer), offer);
      }
      byRun.set(run.id, byKey);
    }
    for (const row of rows) {
      const offer = row.lastRunId
        ? byRun.get(row.lastRunId)?.get(row.aliasKey)
        : undefined;
      if (offer) {
        found.set(row.id, offer);
      }
    }
    return found;
  }

  private async load(id: string): Promise<SourceAlias> {
    const row = await this.aliases.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Source alias not found');
    }
    return row;
  }
}

/** The leaflet inside a run's stored input, or null for a run that has none. */
function readDocument(input: Record<string, unknown>): unknown {
  return input?.['document'] ?? null;
}

/** The instants the spawn resolved, as the price rows are stamped with them. */
function storedWindow(
  input: Record<string, unknown>
): { validFrom: string; validUntil: string } | null {
  const validFrom = input?.['validFrom'];
  const validUntil = input?.['validUntil'];
  return typeof validFrom === 'string' && typeof validUntil === 'string'
    ? { validFrom, validUntil }
    : null;
}
