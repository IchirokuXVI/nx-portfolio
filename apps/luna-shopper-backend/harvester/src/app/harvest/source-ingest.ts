import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  brandKey,
  HarvestRunWrites,
  HarvestWarningCode,
  ItemSourceMatch,
  PriceSourceKind,
  SourceEntryStatus,
  type ItemPriceBatchEntry,
} from '@portfolio/luna-shopper/contracts';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { SourceCatalogEntry, SourceEntryPrice } from '../entities';
import { CatalogClient } from './catalog-client.service';
import { toItemPriceDetails } from './harvest.mappers';
import {
  ChainEanIndex,
  FUZZY_CONFIDENCE,
  ItemMatchIndex,
  SiblingEntryIndex,
  type MatchResult,
} from './matching';
import type { RunContext } from './run-context';
import {
  applySourceGroup,
  loadCatalogItems,
  sourceGroupChanged,
  type SourceEntryFields,
} from './source-snapshot';

/** How many price rows go to catalog in one call (plan 0086, section 5, step 4). */
const PRICE_BATCH = 200;

/** How many `source_entry_prices` rows are written in one statement. */
const PRICE_ROW_CHUNK = 200;

/**
 * One price of one product, for the group of shops that pays it (plan 0103,
 * section 3.1).
 *
 * **A price names its own scope**, so a product can carry a different number for
 * each region a chain prints one for, and the run makes one pass rather than one
 * pass per scope. `scopeKey` is the source's own key, resolved against
 * `PriceScope.externalKey` by whoever opened the session.
 */
export interface SourceObservationPrice {
  /**
   * The scope this price is for, as the source names it. Null means the run's
   * default scope, which is what the operator chose at the spawn.
   */
  scopeKey: string | null;
  /**
   * Null when the source stated only a comparison figure, a per kilogram
   * price with no pack price. The ingest then writes the unit price and no
   * till price, which is plan 0081 section 6.1's one surviving decision.
   */
  price: number | null;
  currency: string;
  unitPrice: number | null;
  unitPriceLabel: string | null;
  validFrom: Date | null;
  validUntil: Date | null;
}

/**
 * One product as a source described it (plan 0086, section 5).
 *
 * Every column of 3.1's first group the source can fill, and the prices the
 * source stated for it. A walk's detail call, a DEZA listing row and a line of
 * an uploaded file all become this, and from here on nothing knows which of the
 * three it was.
 */
export interface SourceObservation {
  externalId: string;
  /**
   * Absent or true: the source was read whole, and every identity field below
   * is what it said (plan 0119, section 6). The other half of the union is
   * {@link PartialSourceObservation}.
   */
  detailFetched?: true;
  name: string;
  brand: string | null;
  ean: string | null;
  unitSize: number | null;
  sizeFormat: string | null;
  /**
   * How many units the pack holds, as the source's own adapter read it (plan
   * 0162). Null is a statement that the product is not a pack. Absent is a
   * source that reads no counts at all, the leaflet import, and leaves the
   * stored count alone.
   */
  packCount?: number | null;
  categoryPath: string[];
  url: string | null;
  observedAt: Date;
  extra: Record<string, unknown> | null;
  /**
   * Every price the source stated for this product, one per scope it named.
   *
   * An empty array is a product the source named and priced nowhere, which is
   * every DEZA product and 21 of a LIDL week. It is not the same as a price of
   * zero and it clears nothing an earlier run wrote.
   */
  prices: readonly SourceObservationPrice[];
}

/**
 * A product the source listed and whose detail was not fetched, because the
 * harvester already knew it (plan 0119, section 6).
 *
 * **It carries no identity field at all**, rather than nulls for the ones it
 * did not read. A null in an observation is a statement, and the verbatim write
 * of a full observation would blank a stored EAN with it. What the stored row
 * says stays what the last full read wrote; this moves only the seen fields
 * and the prices.
 */
export interface PartialSourceObservation {
  externalId: string;
  detailFetched: false;
  observedAt: Date;
  /** Every price the listing stated for this product, as a full one carries. */
  prices: readonly SourceObservationPrice[];
}

/** A product as a runner reports it: read whole, or from the listing alone. */
export type ReportedObservation = SourceObservation | PartialSourceObservation;

/** What a session writes for, decided once and held across every chunk. */
export interface SourceIngestSessionInput {
  supermarketId: string;
  /**
   * The scope a price that names none is written to, and null when the run was
   * given none. A price with neither is a warning and no row (plan 0103,
   * section 3.2).
   */
  defaultPriceScopeId: string | null;
  sourceKind: PriceSourceKind;
  /**
   * The scope a source's own key resolves to, or null when nothing declared it.
   *
   * Supplied by the orchestrator, which resolves and creates scopes through
   * `PriceScopeResolver` (plan 0103, section 2.3). The ingest never creates a
   * scope and never asks catalog for one: a scope is created only from a
   * declaration, and a declaration is a runner's to make.
   */
  scopeIdFor?: (scopeKey: string) => string | null;
  /**
   * The scopes that also receive what the run writes at a scope, by its id
   * (plan 0118, section 4). Absent, or an empty answer, means no copy.
   *
   * Resolved by the executor before the run starts. A copy happens here, where a
   * resolved scope id becomes a write, so a runner never learns about one.
   */
  copiesOf?: (priceScopeId: string) => readonly string[];
  /**
   * What the run writes of what it read (plan 0119, section 7). Absent means
   * both. Without prices, no `source_entry_prices` row is written and nothing
   * reaches `addPrices`, copies included; the products are ingested either way.
   * Availability is the sink's to skip, not this.
   */
  writes?: HarvestRunWrites;
}

export interface SourceIngestInput extends SourceIngestSessionInput {
  observations: readonly ReportedObservation[];
}

/** Which rung of section 4 answered, and what it answered with. */
export interface SourceEntryOutcome {
  entry: SourceCatalogEntry;
  created: boolean;
  rung: 1 | 2 | 3 | 4 | 5;
  /** The item this observation resolves to, set only when the row is ACTIVE. */
  itemId: string | null;
}

export interface SourceIngestCounters {
  created: number;
  updated: number;
  unchanged: number;
  /**
   * `source_entry_prices` rows this run wrote: one per price the source stated
   * that resolved to a scope, whatever the row's status.
   *
   * Separate from {@link pricesWritten}, and the difference is why both exist.
   * This one counts what the chain said, on the chain's own rows. That one
   * counts what reached catalog, which only an `ACTIVE` row earns. A LIDL walk
   * of 188 products nobody has matched yet writes 8,154 of these and none of
   * those, and a report naming only the second reads as a run that fetched
   * prices and lost them.
   */
  pricesRecorded: number;
  /** `item_prices` rows catalog inserted. */
  pricesWritten: number;
  /** Rows catalog already held at this value and only moved the clock on. */
  pricesConfirmed: number;
  /**
   * Items two entries of this chain priced at one scope in one batch, for which
   * nothing was sent (plan 0155).
   *
   * One per item and scope, whatever the number of entries. Catalog keeps one
   * current price per item, scope and kind, so sending both made the one
   * written last the one a shopper saw. No rule picks one of them: a person
   * does, in the queue.
   */
  pricesConflicted: number;
}

/**
 * What the copies of a run wrote (plan 0118, section 7).
 *
 * Kept apart from {@link SourceIngestCounters}, whose price numbers keep their
 * meaning for walked scopes, so they stay comparable between runs with copies
 * and runs without.
 */
export interface SourceIngestCopies {
  /** Every scope that received at least one price read at it. */
  pricedScopes: Set<string>;
  /** Per scope copied from, the price rows sent to catalog for its targets. */
  pricesCopied: Map<string, number>;
}

export interface SourceIngestResult {
  outcomes: SourceEntryOutcome[];
  counters: SourceIngestCounters;
  copies: SourceIngestCopies;
}

/**
 * The second half of every run, whatever the first half was (plan 0086, D5).
 *
 * A Mercadona walk fetches 4,232 products over eighteen minutes and a file
 * import reads 219 offers out of an upload, and from that point on both hold the
 * same thing: a list of products as a chain described them. What happens next
 * must not depend on which first step it was, so it happens here and nowhere
 * else: the rows, the ladder, the price each scope stated, the prices the
 * `ACTIVE` rows are owed, and an outcome per observation.
 *
 * **A run rewrites the source group and never the decision group.** Rung 1
 * touches a row whatever its status is: an `ACTIVE` row is owed a price, a
 * `REJECTED` one writes nothing and is not asked again, and a `CANDIDATE` or
 * `UNRESOLVED` one is already waiting for a person. Only an EAN or a person ever
 * makes a row `ACTIVE`.
 *
 * **Rung 1 is silent.** The leaflet import used to warn per offer for a rejected
 * or an already queued name; a walk touches four thousand unresolved rows and a
 * warning for each is a `warnings` column nobody reads. Section 5 leaves it to
 * the runner to turn outcomes into warnings, and only the file import does,
 * because a person reads a file's list of a few hundred rows.
 */
@Injectable()
export class SourceIngest {
  private readonly logger = new Logger(SourceIngest.name);

  constructor(
    @InjectRepository(SourceCatalogEntry)
    private readonly entries: Repository<SourceCatalogEntry>,
    @InjectRepository(SourceEntryPrice)
    private readonly prices: Repository<SourceEntryPrice>,
    private readonly catalog: CatalogClient
  ) {}

  /**
   * Open a session over one chain, for a run that pushes as it fetches.
   *
   * **The three indexes are loaded once and held**, which is why a session
   * exists at all (plan 0103, section 2.3). A sink that flushes in chunks and
   * called {@link ingest} per chunk would reload the chain's rows and the
   * catalog item index for every one of them, and would lose the sibling index a
   * previous chunk added to: rung 4 matches a new row against the chain's other
   * rows, so two chunks of one run would stop seeing each other's products.
   */
  async open(
    context: RunContext,
    input: SourceIngestSessionInput
  ): Promise<SourceIngestSession> {
    // The chain's rows and the catalog item index, once. Asking catalog per
    // product would be 4,232 NATS round trips on top of 4,232 HTTP ones.
    const rows = await this.entries.find({
      where: { supermarketId: input.supermarketId },
    });
    return new SourceIngestSession(
      this,
      context,
      input,
      rows,
      new ItemMatchIndex(await loadCatalogItems(this.catalog))
    );
  }

  /**
   * One call over a list already in hand: open, push once, close.
   *
   * The file import reads a whole document before it writes anything, so it has
   * nothing to stream and this is the honest shape for it.
   */
  async ingest(
    context: RunContext,
    input: SourceIngestInput
  ): Promise<SourceIngestResult> {
    const session = await this.open(context, input);
    await session.push(input.observations);
    return session.close();
  }

  /** @internal The write half, driven by a session. */
  async writeChunk(
    context: RunContext,
    input: SourceIngestSessionInput,
    reported: readonly ReportedObservation[],
    byExternalId: Map<string, SourceCatalogEntry>,
    siblings: SiblingEntryIndex,
    items: ItemMatchIndex,
    eans: ChainEanIndex
  ): Promise<SourceIngestResult> {
    const seenAt = new Date();
    const outcomes: SourceEntryOutcome[] = [];
    const counters = emptyCounters();
    const copies = emptyCopies();
    /** The `source_entry_prices` rows this chunk observed, one per price. */
    const observed: ObservedPrice[] = [];
    /** Where each observation's prices landed, by its index, copies included. */
    const placedByIndex: PlacedPrice[][] = [];
    const writesPrices = input.writes !== HarvestRunWrites.AVAILABILITY;
    /**
     * The observations that produced an outcome, index aligned with `outcomes`.
     * A skipped partial observation produces none, so step 4 reads from here
     * rather than from what was reported.
     */
    const observations: ReportedObservation[] = [];

    // Every EAN this chunk states, counted before the ladder runs (plan 0155).
    // A full observation writes its EAN onto its row verbatim, a null included,
    // so the count is what the rows hold once the chunk is written, and the
    // first of five cuts sharing an EAN does not bind before the other four.
    const chunkEans = new Set<string>();
    for (const observation of reported) {
      if (observation.detailFetched !== false) {
        eans.note(observation.externalId, observation.ean);
        if (observation.ean) {
          chunkEans.add(observation.ean);
        }
      }
    }

    // Steps 2 and 3, per observation and in the order the runner produced them.
    for (const observation of reported) {
      const held = byExternalId.get(observation.externalId);
      let outcome: SourceEntryOutcome;
      let changed = false;
      if (observation.detailFetched === false) {
        // A partial observation reads no identity field, so it can neither
        // create a row nor change one (plan 0119, section 6).
        if (!held) {
          this.skipUnknownPartial(context, observation);
          await context.report({ processed: 1 });
          continue;
        }
        outcome = await this.see(held, context.runId, seenAt);
      } else {
        const fields = fieldsOf(observation, input.sourceKind);
        // Asked before the touch writes, because the touch is what makes it false.
        changed = held ? sourceGroupChanged(held, fields) : false;
        outcome = held
          ? await this.touch(held, fields, context.runId, seenAt, items, eans)
          : await this.create(
              fields,
              input.supermarketId,
              context.runId,
              seenAt,
              observation,
              items,
              siblings,
              eans
            );
      }
      observations.push(observation);

      if (outcome.created) {
        counters.created += 1;
        byExternalId.set(outcome.entry.externalId, outcome.entry);
        siblings.add(outcome.entry);
        await context.report({ processed: 1, created: 1 });
      } else if (changed) {
        counters.updated += 1;
        await context.report({ processed: 1, updated: 1 });
      } else {
        counters.unchanged += 1;
        await context.report({ processed: 1, unchanged: 1 });
      }

      outcomes.push(outcome);
      // Every price the source stated, each resolved to the scope it names.
      // A price nothing can place is a warning and no row (plan 0103, D4):
      // writing it to the default would put a Sevilla price on Madrid. A run
      // that writes no prices places none, and has nothing to warn about.
      const placed: PlacedPrice[] = [];
      for (const price of writesPrices ? observation.prices : []) {
        const priceScopeId = this.resolveScope(
          context,
          input,
          outcome.entry.name,
          observation.externalId,
          price
        );
        if (priceScopeId) {
          placed.push({ price, priceScopeId, copiedFromScopeId: null });
        }
      }
      placed.push(...copiesFor(placed, input.copiesOf));
      placedByIndex.push(placed);
      for (const place of placed) {
        observed.push({ ...place, observation, entry: outcome.entry });
      }
    }

    // A row bound by its EAN before a second row of the chain carried the same
    // EAN is unbound now, whether it was loaded or bound by an earlier chunk,
    // and is owed nothing from this chunk (plan 0155).
    const unbound = await this.unbindSharedEans(
      context.runId,
      chunkEans,
      eans,
      byExternalId
    );
    for (const outcome of outcomes) {
      if (unbound.has(outcome.entry.externalId)) {
        outcome.itemId = null;
      }
    }

    // Step 3, grouped by resolved scope, in one statement per chunk of rows.
    await this.replaceScopePrices(context.runId, observed);
    // One row per price read at its scope. Counted here rather than inside the
    // write, because a price that resolved to no scope was already dropped with
    // a warning above and was never a row. A copy is not counted: the number
    // stays what the chain stated, comparable with a run that copies nothing.
    for (const place of observed) {
      if (place.copiedFromScopeId === null) {
        counters.pricesRecorded += 1;
        copies.pricedScopes.add(place.priceScopeId);
      }
    }

    // Step 4. Only an `ACTIVE` row is owed a price: a fuzzy match never writes
    // one, because a wrong number on a real product is worse than no number.
    // Grouped by scope, because `catalog.addPrices` writes one scope at a time,
    // and by where the price was read, because a batch states that once.
    // Within a batch, by item: catalog keeps one current price per item, scope
    // and kind, so two entries of one item would each overwrite the other.
    const owed = new Map<string, OwedBatch>();
    for (const [index, outcome] of outcomes.entries()) {
      const observation = observations[index];
      if (!outcome.itemId) {
        continue;
      }
      for (const place of placedByIndex[index]) {
        const key = `${place.priceScopeId}|${place.copiedFromScopeId ?? ''}`;
        const batch = owed.get(key) ?? {
          priceScopeId: place.priceScopeId,
          copiedFromScopeId: place.copiedFromScopeId,
          byItem: new Map(),
        };
        const entry = priceEntryFor(
          outcome.itemId,
          observation,
          outcome.entry,
          place.price
        );
        const held = batch.byItem.get(outcome.itemId);
        if (held) {
          // The same row twice in one chunk is one row, and its later
          // observation is the one it holds. Another row is a conflict.
          held.entryIds.add(outcome.entry.id);
          held.entry = entry;
        } else {
          batch.byItem.set(outcome.itemId, {
            entryIds: new Set([outcome.entry.id]),
            entry,
          });
        }
        owed.set(key, batch);
      }
    }

    let owedCount = 0;
    for (const batch of owed.values()) {
      const entries = this.withoutConflicts(context.runId, batch);
      if (batch.copiedFromScopeId === null) {
        counters.pricesConflicted += batch.byItem.size - entries.length;
      }
      const written = await this.writePrices(
        context,
        batch.priceScopeId,
        input.sourceKind,
        entries,
        batch.copiedFromScopeId
      );
      if (batch.copiedFromScopeId === null) {
        owedCount += entries.length;
        counters.pricesWritten += written.inserted;
        counters.pricesConfirmed += written.confirmed;
      } else {
        copies.pricesCopied.set(
          batch.copiedFromScopeId,
          (copies.pricesCopied.get(batch.copiedFromScopeId) ?? 0) +
            entries.length
        );
      }
    }

    this.logger.log(
      `Run ${context.runId}: ${reported.length} observation(s) ` +
        `ingested (${counters.created} new, ${counters.updated} changed), ` +
        `${counters.pricesRecorded} price(s) recorded on the source rows, ` +
        `${owedCount} price(s) owed across ${owed.size} scope(s), ` +
        `${counters.pricesWritten} written to catalog, ` +
        `${counters.pricesConflicted} withheld as conflicts.`
    );
    return { outcomes, counters, copies };
  }

  /**
   * The prices of one batch, less every item two entries priced (plan 0155).
   *
   * **Refuse, do not choose.** Keeping either price would be a rule that picks
   * one cut's price for a product several cuts share, and the answer to that
   * is a person's: accept one entry, or create the cuts as products.
   */
  private withoutConflicts(
    runId: string,
    batch: OwedBatch
  ): ItemPriceBatchEntry[] {
    const entries: ItemPriceBatchEntry[] = [];
    for (const [itemId, owed] of batch.byItem) {
      if (owed.entryIds.size > 1) {
        this.logger.warn(
          `Run ${runId}: entries ${[...owed.entryIds].join(', ')} all price ` +
            `item ${itemId} at scope ${batch.priceScopeId}` +
            (batch.copiedFromScopeId === null
              ? ''
              : ` (copied from ${batch.copiedFromScopeId})`) +
            ', so none of their prices was sent.'
        );
        continue;
      }
      entries.push(owed.entry);
    }
    return entries;
  }

  /**
   * Unbind every row bound by an EAN that more than one row of the chain now
   * carries, among the EANs this chunk stated (plan 0155).
   *
   * Only a row the EAN rung bound is touched. A row a person accepted is a
   * decision, and a run does not reopen one. Nothing is deleted: a price the
   * row wrote before stays in catalog until it expires.
   *
   * Answers the `externalId`s it unbound.
   */
  private async unbindSharedEans(
    runId: string,
    chunkEans: ReadonlySet<string>,
    eans: ChainEanIndex,
    byExternalId: ReadonlyMap<string, SourceCatalogEntry>
  ): Promise<Set<string>> {
    const unbound = new Set<string>();
    for (const ean of chunkEans) {
      if (!eans.shared(ean)) {
        continue;
      }
      for (const externalId of eans.holdersOf(ean)) {
        const row = byExternalId.get(externalId);
        if (
          !row ||
          row.status !== SourceEntryStatus.ACTIVE ||
          row.matchedBy !== ItemSourceMatch.EAN
        ) {
          continue;
        }
        proposeSharedEan(row, row.itemId);
        await this.entries.save(row);
        unbound.add(externalId);
      }
    }
    if (unbound.size > 0) {
      this.logger.warn(
        `Run ${runId}: ${unbound.size} row(s) bound by an EAN another row of ` +
          'the chain also carries went back to the queue: ' +
          `${[...unbound].join(', ')}.`
      );
    }
    return unbound;
  }

  /**
   * The scope a price belongs to, or null with a warning naming the product.
   *
   * Two ways to have nowhere to go, and they are two different faults, so they
   * are two warnings: a key nothing declared is the producer's, and no key with
   * no default is the operator's, who started the run without a price scope.
   */
  private resolveScope(
    context: RunContext,
    input: SourceIngestSessionInput,
    name: string,
    externalId: string,
    price: SourceObservationPrice
  ): string | null {
    const resolved = this.scopeOf(input, price);
    if (resolved) {
      return resolved;
    }
    if (price.scopeKey === null) {
      context.warn({
        code: HarvestWarningCode.NO_PRICE_SCOPE,
        message:
          `"${name}" states a price for no particular group of ` +
          'shops, and this run was given no price scope to write it to.',
        offerId: externalId,
        page: null,
        name,
      });
      return null;
    }
    context.warn({
      code: HarvestWarningCode.UNKNOWN_PRICE_SCOPE,
      message:
        `"${name}" states a price for "${price.scopeKey}", which ` +
        'nothing in this run declared, so there is no scope to write it to.',
      offerId: externalId,
      page: null,
      name,
    });
    return null;
  }

  /** The scope id a price resolves to, with no warning and no side effect. */
  private scopeOf(
    input: SourceIngestSessionInput,
    price: SourceObservationPrice
  ): string | null {
    return price.scopeKey === null
      ? input.defaultPriceScopeId
      : (input.scopeIdFor?.(price.scopeKey) ?? null);
  }

  /**
   * Rung 1 for a partial observation: the row was seen, and nothing else about
   * it moved (plan 0119, section 6).
   *
   * {@link applySourceGroup} is not called, so the stored name, brand and EAN
   * stay what the last full read wrote, and no status is re-derived: only a new
   * EAN may do that, and this read fetched none.
   */
  private async see(
    row: SourceCatalogEntry,
    runId: string,
    seenAt: Date
  ): Promise<SourceEntryOutcome> {
    row.timesSeen += 1;
    row.lastSeenAt = seenAt;
    row.lastRunId = runId;
    const saved = await this.entries.save(row);
    return {
      entry: saved,
      created: false,
      rung: 1,
      itemId: activeItemOf(saved),
    };
  }

  /**
   * A partial observation for a product the chain holds no row for.
   *
   * It can only happen when a row is deleted between the executor loading what
   * the chain knows and the ingest reaching the product. A row created from it
   * would have no name and no EAN, which is worse than waiting a week for the
   * next run to fetch the detail.
   */
  private skipUnknownPartial(
    context: RunContext,
    observation: PartialSourceObservation
  ): void {
    context.warn({
      code: HarvestWarningCode.DETAIL_SKIPPED_UNKNOWN,
      message:
        `The product ${observation.externalId} was read from the listing ` +
        'alone, because it was known when the run started, but the chain ' +
        'holds no row for it now. Nothing was written, and the next run ' +
        'fetches its detail.',
      offerId: observation.externalId,
      page: null,
      name: null,
    });
  }

  /**
   * Rung 1. The row exists, so it is touched and its status is not re-derived.
   *
   * This is also what makes **resuming free** (plan 0038, section 6.3): an
   * aborted run leaves rows with a fresh `lastSeenAt`, so a re-run skips what it
   * already has by reading that timestamp. There is no checkpoint to replay,
   * only a snapshot that is already the answer.
   *
   * **The one thing that does re-derive a status is a new EAN**, and only on a
   * row nobody has decided. That is not an exception to the ladder, it is the
   * ladder: only an EAN or a person ever makes a row `ACTIVE` (plan 0086), and
   * a row that had no EAN could not reach rung 2 when it was created. Carrefour
   * is why it matters. Its listing card carries no EAN and its product page
   * does, so an entire chain sits in the queue until a backfill run reads those
   * pages, and before plan 0103 that run wrote the EAN and promoted the row
   * itself, holding a repository to do it.
   */
  private async touch(
    row: SourceCatalogEntry,
    fields: SourceEntryFields,
    runId: string,
    seenAt: Date,
    items: ItemMatchIndex,
    eans: ChainEanIndex
  ): Promise<SourceEntryOutcome> {
    const learnedEan = fields.ean !== null && row.ean !== fields.ean;
    applySourceGroup(row, fields);
    row.timesSeen += 1;
    row.lastSeenAt = seenAt;
    row.lastRunId = runId;

    let rung: 1 | 2 = 1;
    if (learnedEan && undecided(row)) {
      const match = items.match({
        ean: fields.ean,
        name: fields.name,
        brand: fields.brand,
        unitSize: fields.unitSize === null ? null : Number(fields.unitSize),
      });
      // Only the EAN rung promotes. A name match here would be a fuzzy proposal
      // made at the very moment the identifier that makes fuzziness unnecessary
      // arrived. An EAN another row of the chain carries only proposes.
      if (match && match.matchedBy === ItemSourceMatch.EAN) {
        if (eans.shared(fields.ean)) {
          proposeSharedEan(row, match.itemId);
        } else {
          row.itemId = match.itemId;
          row.status = SourceEntryStatus.ACTIVE;
          row.matchedBy = ItemSourceMatch.EAN;
          row.confidence = match.confidence;
          row.decidedAt = seenAt;
        }
        rung = 2;
      }
    }

    const saved = await this.entries.save(row);
    return {
      entry: saved,
      created: false,
      rung,
      itemId: activeItemOf(saved),
    };
  }

  /** Rungs 2 to 5, in order, stopping at the first one that answers. */
  private async create(
    fields: SourceEntryFields,
    supermarketId: string,
    runId: string,
    seenAt: Date,
    observation: SourceObservation,
    items: ItemMatchIndex,
    siblings: SiblingEntryIndex,
    eans: ChainEanIndex
  ): Promise<SourceEntryOutcome> {
    const draft = this.entries.create({
      supermarketId,
      ...fields,
      timesSeen: 1,
      firstSeenAt: seenAt,
      lastSeenAt: seenAt,
      firstRunId: runId,
      lastRunId: runId,
      itemId: null,
      candidateEntryId: null,
      status: SourceEntryStatus.UNRESOLVED,
      matchedBy: null,
      confidence: 0,
      decidedAt: null,
    });
    let rung: 1 | 2 | 3 | 4 | 5 = 5;

    // Rungs 2 and 3: the catalog's own items. An EAN is trusted immediately,
    // because it is the one identifier that joins across chains, unless
    // another row of this chain carries it too; a name match is a proposal
    // and writes nothing.
    const match = items.match({
      name: observation.name,
      brand: observation.brand,
      ean: observation.ean,
      unitSize: observation.unitSize,
    });
    if (match && isSharedEan(match, observation.ean, eans)) {
      proposeSharedEan(draft, match.itemId);
      rung = 2;
    } else if (match) {
      draft.itemId = match.itemId;
      draft.status = match.status;
      draft.matchedBy = match.matchedBy;
      draft.confidence = match.confidence;
      draft.decidedAt =
        match.status === SourceEntryStatus.ACTIVE ? seenAt : null;
      rung = match.matchedBy === ItemSourceMatch.EAN ? 2 : 3;
    } else {
      // Rung 4: a sibling row of this chain under the same name and size. For a
      // leaflet that is the Mercadona product the walk found, and for a DEZA
      // leaflet the web listing.
      const sibling = siblings.match(
        observation.name,
        observation.sizeFormat,
        observation.unitSize
      );
      if (sibling) {
        draft.itemId = sibling.itemId;
        draft.candidateEntryId = sibling.entryId;
        draft.status = SourceEntryStatus.CANDIDATE;
        draft.matchedBy = ItemSourceMatch.NAME_SIZE;
        draft.confidence = FUZZY_CONFIDENCE;
        rung = 4;
      }
    }

    const saved = await this.entries.save(draft);
    return { entry: saved, created: true, rung, itemId: activeItemOf(saved) };
  }

  /**
   * Step 3: the latest price each scope stated (plan 0086, D3).
   *
   * A chain has several leaflets at once because each is for a region, and two
   * of them print the same product. The decision about that product is one, for
   * the chain; the prices are one per scope. So an observation carrying a price
   * **replaces** this scope's row and leaves every other scope's alone, and an
   * observation carrying none writes nothing here rather than clearing what an
   * earlier run said.
   */
  private async replaceScopePrices(
    runId: string,
    observed: readonly ObservedPrice[]
  ): Promise<void> {
    if (observed.length === 0) {
      return;
    }
    // Plain values rather than entity instances: an upsert takes the columns
    // it writes, and a created entity carries the `entry` relation too, which
    // has no place in an `INSERT ... ON CONFLICT`.
    const rows = observed.map(
      ({ price, priceScopeId, copiedFromScopeId, observation, entry }) => ({
        entryId: entry.id,
        priceScopeId,
        // Written on every row, null included, so a scope walked directly
        // after an earlier copy loses the copy's provenance with its values.
        copiedFromScopeId,
        price: price.price,
        currency: price.currency,
        unitPrice: price.unitPrice,
        unitPriceLabel: price.unitPriceLabel,
        validFrom: price.validFrom,
        validUntil: price.validUntil,
        details: extraOf(observation, entry),
        observedAt: observation.observedAt,
        runId,
      })
    );
    for (let i = 0; i < rows.length; i += PRICE_ROW_CHUNK) {
      // The cast is `details`, and only `details`. TypeORM maps a partial entity
      // field by field into the shape its query builder accepts, and a free
      // `jsonb` bag has no such shape: `Record<string, unknown>` comes out as a
      // deep partial of itself, which nothing satisfies. Every other column here
      // is checked.
      await this.prices.upsert(
        rows.slice(
          i,
          i + PRICE_ROW_CHUNK
        ) as QueryDeepPartialEntity<SourceEntryPrice>[],
        { conflictPaths: ['entryId', 'priceScopeId'] }
      );
    }
  }

  /**
   * Step 4: the prices the `ACTIVE` rows are owed, in batches, as this run.
   *
   * A new row is `updated`, because the source said something new. A confirmed
   * row moves no progress counter: `unchanged` counts products the ladder left
   * alone, and adding confirmed prices to it read 6,324 for a walk of 4,246
   * products (plan 0158). Confirmed prices are reported as `pricesConfirmed`.
   * Nothing is `created` here, because the row a shopper reads is derived and
   * the run never sees it (plan 0080).
   *
   * `details` is a **translation** of the observation's `extra` rather than a
   * pass through: `extra` is free and catalog's `item_price_details` is not, so
   * the five keys that table holds are taken where the producer used those names
   * and everything else stays on the row, where the queue shows it. Nothing on
   * either side reads it to decide anything (plan 0086, D6).
   */
  private async writePrices(
    context: RunContext,
    priceScopeId: string,
    sourceKind: PriceSourceKind,
    entries: readonly ItemPriceBatchEntry[],
    copiedFromScopeId: string | null
  ): Promise<{ inserted: number; confirmed: number }> {
    if (entries.length === 0) {
      return { inserted: 0, confirmed: 0 };
    }
    let inserted = 0;
    let confirmed = 0;
    for (let i = 0; i < entries.length; i += PRICE_BATCH) {
      const result = await this.catalog.addPrices(
        priceScopeId,
        entries.slice(i, i + PRICE_BATCH),
        context.runId,
        sourceKind,
        copiedFromScopeId
      );
      inserted += result.inserted;
      confirmed += result.confirmed;
      // A copy moves no progress counter, for the reason `pricesRecorded`
      // leaves it out: the run's numbers describe what the chain stated.
      if (copiedFromScopeId === null) {
        await context.report({ updated: result.inserted });
      }
    }
    return { inserted, confirmed };
  }
}

/** One price and the scope it is written to, read there or copied from another. */
interface PlacedPrice {
  price: SourceObservationPrice;
  priceScopeId: string;
  /** The scope the price was read at, or null when it was read at `priceScopeId`. */
  copiedFromScopeId: string | null;
}

/** One price of one observation, beside the row and the scope it landed on. */
interface ObservedPrice extends PlacedPrice {
  observation: ReportedObservation;
  entry: SourceCatalogEntry;
}

/** The price one item is owed in a batch, and every entry that stated one. */
interface OwedPrice {
  entryIds: Set<string>;
  entry: ItemPriceBatchEntry;
}

/** The prices owed to one scope, all read at the same place, by item. */
interface OwedBatch {
  priceScopeId: string;
  copiedFromScopeId: string | null;
  byItem: Map<string, OwedPrice>;
}

function emptyCounters(): SourceIngestCounters {
  return {
    created: 0,
    updated: 0,
    unchanged: 0,
    pricesRecorded: 0,
    pricesWritten: 0,
    pricesConfirmed: 0,
    pricesConflicted: 0,
  };
}

function emptyCopies(): SourceIngestCopies {
  return { pricedScopes: new Set(), pricesCopied: new Map() };
}

/** Rung 2 answered, with an EAN another row of this chain carries too. */
function isSharedEan(
  match: MatchResult,
  ean: string | null,
  eans: ChainEanIndex
): boolean {
  return match.matchedBy === ItemSourceMatch.EAN && eans.shared(ean);
}

/**
 * The item a shared EAN names, proposed rather than bound (plan 0155).
 *
 * A `CANDIDATE`, so it writes no price until a person accepts it, and
 * undecided, so accepting it is a decision a person makes. The item stays on
 * the row as the proposal, which is the product the queue shows beside it.
 */
function proposeSharedEan(
  row: SourceCatalogEntry,
  itemId: string | null
): void {
  row.itemId = itemId;
  row.candidateEntryId = null;
  row.status = SourceEntryStatus.CANDIDATE;
  row.matchedBy = ItemSourceMatch.SHARED_EAN;
  row.confidence = FUZZY_CONFIDENCE;
  row.decidedAt = null;
}

/**
 * The copies one observation's prices owe (plan 0118, section 5).
 *
 * **A copy never lands on a scope the observation priced itself.** The spawn
 * already refuses a target the run walks, but a chain that names its own
 * regions can still state a price for a target this week, and that price is
 * the chain's own statement, so it wins. Without this, one upsert would name
 * the same (entry, scope) twice and Postgres would refuse the statement.
 */
function copiesFor(
  placed: readonly PlacedPrice[],
  copiesOf: ((priceScopeId: string) => readonly string[]) | undefined
): PlacedPrice[] {
  if (!copiesOf) {
    return [];
  }
  const read = new Set(placed.map((place) => place.priceScopeId));
  const copies: PlacedPrice[] = [];
  for (const place of placed) {
    for (const target of copiesOf(place.priceScopeId)) {
      if (read.has(target)) {
        continue;
      }
      read.add(target);
      copies.push({
        price: place.price,
        priceScopeId: target,
        copiedFromScopeId: place.priceScopeId,
      });
    }
  }
  return copies;
}

/** The item an observation resolves to, which only an `ACTIVE` row states. */
function activeItemOf(row: SourceCatalogEntry): string | null {
  return row.status === SourceEntryStatus.ACTIVE ? row.itemId : null;
}

/**
 * A row nobody has decided, which is the only kind a new EAN may promote.
 *
 * A `REJECTED` row is the owner saying this is not a product he tracks, and an
 * `ACTIVE` one is already answered. Neither is re-derived by a run.
 */
function undecided(row: SourceCatalogEntry): boolean {
  return (
    row.decidedAt === null &&
    (row.status === SourceEntryStatus.UNRESOLVED ||
      row.status === SourceEntryStatus.CANDIDATE)
  );
}

function fieldsOf(
  observation: SourceObservation,
  sourceKind: PriceSourceKind
): SourceEntryFields {
  return {
    externalId: observation.externalId,
    sourceKind,
    name: observation.name,
    brand: observation.brand,
    // Derived here rather than at the call sites, so every observation that
    // reaches a row carries the key (plan 0115, section 6).
    brandKey: brandKey(observation.brand),
    ean: observation.ean,
    unitSize: observation.unitSize,
    sizeFormat: observation.sizeFormat,
    packCount: observation.packCount,
    categoryPath: observation.categoryPath,
    url: observation.url,
    extra: observation.extra,
  };
}

/**
 * The free bag a price row carries: the observation's, or for a partial one the
 * stored row's, which is what the last full read said.
 */
function extraOf(
  observation: ReportedObservation,
  entry: SourceCatalogEntry
): Record<string, unknown> | null {
  return observation.detailFetched === false ? entry.extra : observation.extra;
}

function priceEntryFor(
  itemId: string,
  observation: ReportedObservation,
  entry: SourceCatalogEntry,
  price: SourceObservationPrice
): ItemPriceBatchEntry {
  return {
    itemId,
    price: price.price,
    currency: price.currency,
    unitPrice: price.unitPrice,
    unitPriceLabel: price.unitPriceLabel,
    validFrom: price.validFrom?.toISOString() ?? null,
    validUntil: price.validUntil?.toISOString() ?? null,
    observedAt: observation.observedAt.toISOString(),
    details: toItemPriceDetails(extraOf(observation, entry)),
  };
}

/**
 * One run's ingest, open across every chunk it pushes (plan 0103, section 2.3).
 *
 * It holds the three things that must not be rebuilt per chunk: the chain's rows
 * by external id, the sibling index rung 4 matches against, and the catalog item
 * index rungs 2 and 3 match against. A run that pushed in chunks without this
 * would reload all three per chunk, and rung 4 would stop seeing the rows an
 * earlier chunk of the same run created.
 *
 * The counters and outcomes accumulate, so {@link close} answers for the whole
 * run exactly as a single {@link SourceIngest.ingest} call would.
 */
export class SourceIngestSession {
  private readonly byExternalId: Map<string, SourceCatalogEntry>;
  private readonly siblings: SiblingEntryIndex;
  private readonly eans: ChainEanIndex;
  private readonly outcomes: SourceEntryOutcome[] = [];
  private readonly counters = emptyCounters();
  private readonly copies = emptyCopies();
  private closed = false;

  constructor(
    private readonly ingest: SourceIngest,
    private readonly context: RunContext,
    private readonly input: SourceIngestSessionInput,
    rows: readonly SourceCatalogEntry[],
    private readonly items: ItemMatchIndex
  ) {
    this.byExternalId = new Map(rows.map((row) => [row.externalId, row]));
    this.siblings = new SiblingEntryIndex(rows);
    this.eans = new ChainEanIndex(rows);
  }

  /**
   * Write one chunk, and answer what the ladder made of it.
   *
   * The outcomes are answered per chunk as well as accumulated, because
   * availability is stated per catalog item and only the ladder knows which item
   * a row resolved to. A caller that wants the whole run's outcomes takes them
   * from {@link close} instead.
   */
  async push(
    observations: readonly ReportedObservation[]
  ): Promise<SourceEntryOutcome[]> {
    if (this.closed) {
      throw new Error(
        'This ingest session is closed. A run opens one, pushes into it and ' +
          'closes it once.'
      );
    }
    if (observations.length === 0) {
      return [];
    }
    const result = await this.ingest.writeChunk(
      this.context,
      this.input,
      observations,
      this.byExternalId,
      this.siblings,
      this.items,
      this.eans
    );
    this.outcomes.push(...result.outcomes);
    this.counters.created += result.counters.created;
    this.counters.updated += result.counters.updated;
    this.counters.unchanged += result.counters.unchanged;
    this.counters.pricesRecorded += result.counters.pricesRecorded;
    this.counters.pricesWritten += result.counters.pricesWritten;
    this.counters.pricesConfirmed += result.counters.pricesConfirmed;
    this.counters.pricesConflicted += result.counters.pricesConflicted;
    for (const scopeId of result.copies.pricedScopes) {
      this.copies.pricedScopes.add(scopeId);
    }
    for (const [from, count] of result.copies.pricesCopied) {
      this.copies.pricesCopied.set(
        from,
        (this.copies.pricesCopied.get(from) ?? 0) + count
      );
    }
    return result.outcomes;
  }

  /**
   * Everything this run ingested, in the order it was pushed.
   *
   * There is nothing to flush: a chunk is written when it is pushed, so an
   * aborted run keeps what it already wrote. Closing only stops further pushes
   * and answers the totals.
   */
  async close(): Promise<SourceIngestResult> {
    this.closed = true;
    return {
      outcomes: this.outcomes,
      counters: this.counters,
      copies: this.copies,
    };
  }
}
