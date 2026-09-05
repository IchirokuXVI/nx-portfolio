import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  HarvestWarningCode,
  ItemSourceMatch,
  PriceSourceKind,
  SourceAliasStatus,
  type HarvestRunWarning,
  type ItemPriceBatchEntry,
  type ItemView,
  type LeafletOffer,
} from '@portfolio/luna-shopper/contracts';
import { Repository } from 'typeorm';
import { SourceAlias, SourceCatalogEntry } from '../entities';
import { CatalogClient } from './catalog-client.service';
import { readLeafletDocument } from './leaflet-document.reader';
import { aliasKeyFor, decideOffer } from './leaflet-rules';
import { resolveLeafletWindow } from './leaflet-validity';
import { ItemMatchIndex, normalizeName } from './matching';
import type { RunContext } from './run-context';

export interface LeafletImportInput {
  supermarketId: string;
  priceScopeId: string;
}

/** How many price rows go to catalog in one call (plan 0081, section 8). */
const PRICE_BATCH = 200;

/** The confidence a fuzzy proposal carries, as the discovery matcher's does. */
const FUZZY_CONFIDENCE = 0.6;

/**
 * `LEAFLET_IMPORT` (plan 0081): read an uploaded document and write the prices
 * printed in it.
 *
 * **The output is identical to the output of a crawl. Only the fetching
 * differs.** So this is a runner beside the other three rather than a write in
 * catalog: the write path, the run machinery with its progress and its lock, and
 * the review queue in the back office all already exist here, and putting the
 * import in catalog would rebuild every one of them.
 *
 * It makes no HTTP request, holds no token bucket and needs no
 * `SupermarketSource`. What it does instead, per offer and in document order, is
 * section 8's four steps: the loyalty rule, then the promotion rule, then the
 * basis rule decide what number if any to write, and then the ladder of section
 * 3 decides which product it belongs to.
 *
 * **The ladder never binds a name to a product.** Only an admin accepting a
 * queued alias creates an ACTIVE one. Backlog 0001 section 6.2 is the reason and
 * it is worth restating, because every automated path here stops one step short
 * of it: a bad fuzzy match writes a wrong price onto a real product that people
 * then shop on, which is worse than having no price.
 */
@Injectable()
export class LeafletImportRunner {
  private readonly logger = new Logger(LeafletImportRunner.name);

  constructor(
    @InjectRepository(SourceAlias)
    private readonly aliases: Repository<SourceAlias>,
    @InjectRepository(SourceCatalogEntry)
    private readonly entries: Repository<SourceCatalogEntry>,
    private readonly catalog: CatalogClient
  ) {}

  async run(context: RunContext, input: LeafletImportInput): Promise<void> {
    // Validated again here, because the harvester owns the schema version and a
    // broker message is not a trusted input (section 4). The gateway already
    // refused a malformed document; this refuses one that arrived some other way.
    const document = readLeafletDocument(context.run.input['document']);
    // The instants the spawn resolved, which already carry the admin's
    // override (section 5). Resolving them here from the document alone would
    // silently drop that override, so the stored pair is the answer and the
    // document's own days are only the fall back for a run written before it.
    const window =
      storedWindow(context.run.input) ??
      resolveLeafletWindow({
        documentStartsOn: document.validity.starts_on,
        documentEndsOn: document.validity.ends_on,
      });

    await context.setTotalPlanned(document.offers.length);
    this.logger.log(
      `Run ${context.runId}: importing ${document.offers.length} offer(s) from ` +
        `${document.source.file} for scope ${input.priceScopeId}, valid ` +
        `${window.validFrom.toISOString()} to ${window.validUntil.toISOString()}`
    );

    // The extractor's own dropped tiles, carried through so the admin sees what
    // the extractor lost beside what the import skipped (section 4).
    for (const dropped of document.warnings ?? []) {
      context.warn({
        code: HarvestWarningCode.EXTRACTOR,
        offerId: null,
        page: dropped.page ?? null,
        name: null,
        message: dropped.message,
      });
    }

    await context.setStage('MATCH', 'Resolving the printed names');
    const known = await this.loadAliases(input.supermarketId);
    const entryIndex = await this.loadEntryIndex(input.supermarketId);
    const itemIndex = await this.loadItemIndex();
    const duplicates = duplicateKeysIn(document.offers);

    const prices: ItemPriceBatchEntry[] = [];
    /** Rows this run created, so a key seen twice inserts once. */
    const created = new Map<string, SourceAlias>();
    const touched: SourceAlias[] = [];

    for (const offer of document.offers) {
      await context.report({ processed: 1 });
      const key = aliasKeyFor(offer);
      const existing = known.get(key) ?? created.get(key) ?? null;

      // Section 8 step 4: the rules first, the ladder second.
      const decision = decideOffer(offer);

      if (decision.kind === 'skip') {
        // Section 6.3. Skipped entirely: no price row, no alias, no flag. The
        // warning is what the owner asked for in exchange.
        context.warn(warningFor(decision.code, offer, decision.message));
        await context.report({ skipped: 1 });
        continue;
      }

      if (existing) {
        this.touch(existing, context.runId);
        if (!created.has(key)) {
          touched.push(existing);
        }
      }

      if (decision.kind === 'queue') {
        // Section 6.2: a conditional tile with no single unit price. The only
        // number on it is one a shopper cannot pay for one unit, so it waits
        // for a person rather than being guessed at.
        context.warn(warningFor(decision.code, offer, decision.message));
        if (!existing) {
          created.set(
            key,
            this.propose(
              offer,
              key,
              input.supermarketId,
              context.runId,
              null,
              null
            )
          );
        }
        await context.report({ skipped: 1 });
        continue;
      }

      // Section 2.1's residual case, routed to the queue by the owner: two
      // offers with one key in one document, and neither writes a price.
      if (duplicates.has(key)) {
        context.warn(
          warningFor(
            HarvestWarningCode.DUPLICATE_KEY,
            offer,
            'Two offers in this document print the same name and format, so ' +
              'neither wrote a price.'
          )
        );
        if (!existing) {
          created.set(
            key,
            this.propose(
              offer,
              key,
              input.supermarketId,
              context.runId,
              null,
              null
            )
          );
        }
        await context.report({ skipped: 1 });
        continue;
      }

      if (existing) {
        // Rungs 1 to 3.
        if (existing.status === SourceAliasStatus.ACTIVE && existing.itemId) {
          prices.push({
            itemId: existing.itemId,
            price: decision.pricing.price,
            currency: decision.pricing.currency,
            unitPrice: decision.pricing.unitPrice,
            unitPriceLabel: decision.pricing.unitPriceLabel,
            validFrom: window.validFrom.toISOString(),
            validUntil: window.validUntil.toISOString(),
            details: detailsOf(offer),
          });
          continue;
        }
        if (existing.status === SourceAliasStatus.REJECTED) {
          context.warn(
            warningFor(
              HarvestWarningCode.REJECTED_ALIAS,
              offer,
              `"${offer.product.name}" was rejected for this chain, so the ` +
                'offer was skipped and not asked about again.'
            )
          );
        } else {
          context.warn(
            warningFor(
              HarvestWarningCode.ALREADY_QUEUED,
              offer,
              `"${offer.product.name}" is already waiting in this chain's queue.`
            )
          );
        }
        await context.report({ skipped: 1 });
        continue;
      }

      // Rung 4. The catalog's own items first, then the chain's discovery
      // snapshot for a chain that has one. **Neither writes a price.**
      const candidateItem = itemIndex.match({
        externalId: key,
        name: offer.product.name,
        brand: offer.product.brand ?? null,
        ean: null,
        unitSize: offer.product.format?.quantity ?? null,
      });
      const candidateEntry = candidateItem
        ? null
        : (entryIndex.get(key) ?? null);
      context.warn(
        warningFor(
          candidateItem || candidateEntry
            ? HarvestWarningCode.CANDIDATE_MATCH
            : HarvestWarningCode.NO_MATCH,
          offer,
          candidateItem || candidateEntry
            ? `"${offer.product.name}" looks like something the catalog knows, ` +
                'so it is queued for a person: a fuzzy match never writes a price.'
            : `"${offer.product.name}" matched nothing, so it is queued for a person.`
        )
      );
      created.set(
        key,
        this.propose(
          offer,
          key,
          input.supermarketId,
          context.runId,
          candidateItem?.itemId ?? null,
          candidateEntry?.id ?? null
        )
      );
      await context.report({ skipped: 1 });
    }

    // The aliases first: a person working the queue afterwards has to find the
    // row whether or not the price write succeeded.
    await context.setStage('QUEUE', `Recording ${created.size} new name(s)`);
    await this.saveAliases([...created.values()], touched);

    await context.setStage('WRITE', `Writing ${prices.length} price(s)`);
    await this.writePrices(context, input.priceScopeId, prices);
    await context.flush();
  }

  /** A new queued row. Never ACTIVE: only a person binds a name to a product. */
  private propose(
    offer: LeafletOffer,
    aliasKey: string,
    supermarketId: string,
    runId: string,
    candidateItemId: string | null,
    candidateEntryId: string | null
  ): SourceAlias {
    const proposed = Boolean(candidateItemId ?? candidateEntryId);
    const now = new Date();
    return this.aliases.create({
      supermarketId,
      aliasKey,
      printedName: offer.product.name,
      printedFormat: offer.product.format?.raw ?? null,
      printedBrand: offer.product.brand ?? null,
      itemId: null,
      candidateItemId,
      candidateEntryId,
      status: proposed
        ? SourceAliasStatus.CANDIDATE
        : SourceAliasStatus.UNRESOLVED,
      matchedBy: ItemSourceMatch.NAME_SIZE,
      confidence: proposed ? FUZZY_CONFIDENCE : 0,
      timesSeen: 1,
      firstSeenAt: now,
      lastSeenAt: now,
      firstRunId: runId,
      lastRunId: runId,
    });
  }

  /** Every rung moves `timesSeen`, `lastSeenAt` and `lastRunId`. */
  private touch(alias: SourceAlias, runId: string): void {
    alias.timesSeen += 1;
    alias.lastSeenAt = new Date();
    alias.lastRunId = runId;
  }

  private async loadAliases(
    supermarketId: string
  ): Promise<Map<string, SourceAlias>> {
    const rows = await this.aliases.find({ where: { supermarketId } });
    return new Map(rows.map((row) => [row.aliasKey, row]));
  }

  /**
   * The chain's discovery snapshot, keyed the way the aliases are, so an entry
   * the walk found can be proposed for an admin to promote with
   * `sourceEntry.createItem`. A chain with no snapshot matches nothing, which is
   * an empty map rather than a special case.
   */
  private async loadEntryIndex(
    supermarketId: string
  ): Promise<Map<string, SourceCatalogEntry>> {
    const rows = await this.entries.find({ where: { supermarketId } });
    return new Map(
      rows.map((row) => [
        [normalizeName(row.name), normalizeName(row.sizeFormat ?? '')].join(
          '|'
        ),
        row,
      ])
    );
  }

  /**
   * The catalog's items, once per run. Catalog is owner curated and small by
   * construction, and asking per offer would be 219 NATS round trips for a
   * document that took one request to arrive.
   */
  private async loadItemIndex(): Promise<ItemMatchIndex> {
    const items: ItemView[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.catalog.searchItems(cursor);
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return new ItemMatchIndex(items);
  }

  private async saveAliases(
    inserts: SourceAlias[],
    touched: SourceAlias[]
  ): Promise<void> {
    if (inserts.length > 0) {
      await this.aliases.save(inserts, { chunk: 200 });
    }
    if (touched.length > 0) {
      await this.aliases.save(touched, { chunk: 200 });
    }
  }

  /**
   * The prices, in batches, as this run (section 8, step 5).
   *
   * The counters map onto what the batch answers: a new row is `created`,
   * because the leaflet stated a number the catalog did not hold for this
   * source, and a confirmed row is `unchanged`.
   */
  private async writePrices(
    context: RunContext,
    priceScopeId: string,
    entries: ItemPriceBatchEntry[]
  ): Promise<void> {
    for (let i = 0; i < entries.length; i += PRICE_BATCH) {
      const result = await this.catalog.addPrices(
        priceScopeId,
        entries.slice(i, i + PRICE_BATCH),
        context.runId,
        PriceSourceKind.OFFICIAL_LEAFLET
      );
      await context.report({
        created: result.inserted,
        unchanged: result.confirmed,
      });
    }
  }
}

/** The window the spawn resolved and stored on the run (section 5). */
function storedWindow(
  input: Record<string, unknown>
): { validFrom: Date; validUntil: Date } | null {
  const from = input?.['validFrom'];
  const until = input?.['validUntil'];
  if (typeof from !== 'string' || typeof until !== 'string') {
    return null;
  }
  const validFrom = new Date(from);
  const validUntil = new Date(until);
  return Number.isNaN(validFrom.getTime()) || Number.isNaN(validUntil.getTime())
    ? null
    : { validFrom, validUntil };
}

/** The keys more than one offer in this document resolves to (section 2.1). */
export function duplicateKeysIn(offers: readonly LeafletOffer[]): Set<string> {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const offer of offers) {
    const key = aliasKeyFor(offer);
    if (seen.has(key)) {
      twice.add(key);
    }
    seen.add(key);
  }
  return twice;
}

/** What the run stores beside a leaflet price (section 6.4). */
export function detailsOf(offer: LeafletOffer): ItemPriceBatchEntry['details'] {
  return {
    offerId: offer.id,
    page: offer.page ?? null,
    rawText: offer.raw_text ?? [],
    promotion: (offer.promotion as Record<string, unknown> | null) ?? null,
    loyalty: (offer.loyalty as Record<string, unknown> | undefined) ?? null,
  };
}

function warningFor(
  code: HarvestWarningCode,
  offer: LeafletOffer,
  message: string
): HarvestRunWarning {
  return {
    code,
    offerId: offer.id,
    page: offer.page ?? null,
    name: offer.product.name,
    message,
  };
}
