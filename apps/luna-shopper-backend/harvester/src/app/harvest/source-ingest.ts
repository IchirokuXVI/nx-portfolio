import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
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
  FUZZY_CONFIDENCE,
  ItemMatchIndex,
  SiblingEntryIndex,
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
  name: string;
  brand: string | null;
  ean: string | null;
  unitSize: number | null;
  sizeFormat: string | null;
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
}

export interface SourceIngestInput extends SourceIngestSessionInput {
  observations: readonly SourceObservation[];
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
  /** `item_prices` rows catalog inserted. */
  pricesWritten: number;
  /** Rows catalog already held at this value and only moved the clock on. */
  pricesConfirmed: number;
}

export interface SourceIngestResult {
  outcomes: SourceEntryOutcome[];
  counters: SourceIngestCounters;
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
    observations: readonly SourceObservation[],
    byExternalId: Map<string, SourceCatalogEntry>,
    siblings: SiblingEntryIndex,
    items: ItemMatchIndex
  ): Promise<SourceIngestResult> {
    const seenAt = new Date();
    const outcomes: SourceEntryOutcome[] = [];
    const counters: SourceIngestCounters = {
      created: 0,
      updated: 0,
      unchanged: 0,
      pricesWritten: 0,
      pricesConfirmed: 0,
    };
    /** The `source_entry_prices` rows this chunk observed, one per price. */
    const observed: ObservedPrice[] = [];

    // Steps 2 and 3, per observation and in the order the runner produced them.
    for (const observation of observations) {
      const fields = fieldsOf(observation, input.sourceKind);
      const held = byExternalId.get(observation.externalId);
      // Asked before the touch writes, because the touch is what makes it false.
      const changed = held ? sourceGroupChanged(held, fields) : false;

      const outcome = held
        ? await this.touch(held, fields, context.runId, seenAt, items)
        : await this.create(
            fields,
            input.supermarketId,
            context.runId,
            seenAt,
            observation,
            items,
            siblings
          );

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
      // writing it to the default would put a Sevilla price on Madrid.
      for (const price of observation.prices) {
        const priceScopeId = this.resolveScope(
          context,
          input,
          observation,
          price
        );
        if (priceScopeId) {
          observed.push({
            price,
            priceScopeId,
            observation,
            entry: outcome.entry,
          });
        }
      }
    }

    // Step 3, grouped by resolved scope, in one statement per chunk of rows.
    await this.replaceScopePrices(context.runId, observed);

    // Step 4. Only an `ACTIVE` row is owed a price: a fuzzy match never writes
    // one, because a wrong number on a real product is worse than no number.
    // Grouped by scope, because `catalog.addPrices` writes one scope at a time.
    const owed = new Map<string, ItemPriceBatchEntry[]>();
    for (const [index, outcome] of outcomes.entries()) {
      const observation = observations[index];
      if (!outcome.itemId) {
        continue;
      }
      for (const price of observation.prices) {
        const priceScopeId = this.scopeOf(input, price);
        if (!priceScopeId) {
          continue;
        }
        const batch = owed.get(priceScopeId) ?? [];
        batch.push(priceEntryFor(outcome.itemId, observation, price));
        owed.set(priceScopeId, batch);
      }
    }

    let owedCount = 0;
    for (const [priceScopeId, entries] of owed) {
      owedCount += entries.length;
      const written = await this.writePrices(
        context,
        priceScopeId,
        input.sourceKind,
        entries
      );
      counters.pricesWritten += written.inserted;
      counters.pricesConfirmed += written.confirmed;
    }

    this.logger.log(
      `Run ${context.runId}: ${observations.length} observation(s) ` +
        `ingested (${counters.created} new, ${counters.updated} changed), ` +
        `${owedCount} price(s) owed across ${owed.size} scope(s), ` +
        `${counters.pricesWritten} written.`
    );
    return { outcomes, counters };
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
    observation: SourceObservation,
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
          `"${observation.name}" states a price for no particular group of ` +
          'shops, and this run was given no price scope to write it to.',
        offerId: observation.externalId,
        page: null,
        name: observation.name,
      });
      return null;
    }
    context.warn({
      code: HarvestWarningCode.UNKNOWN_PRICE_SCOPE,
      message:
        `"${observation.name}" states a price for "${price.scopeKey}", which ` +
        'nothing in this run declared, so there is no scope to write it to.',
      offerId: observation.externalId,
      page: null,
      name: observation.name,
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
    items: ItemMatchIndex
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
      // arrived.
      if (match && match.matchedBy === ItemSourceMatch.EAN) {
        row.itemId = match.itemId;
        row.status = SourceEntryStatus.ACTIVE;
        row.matchedBy = ItemSourceMatch.EAN;
        row.confidence = match.confidence;
        row.decidedAt = seenAt;
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
    siblings: SiblingEntryIndex
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
    // because it is the one identifier that joins across chains; a name match
    // is a proposal and writes nothing.
    const match = items.match({
      name: observation.name,
      brand: observation.brand,
      ean: observation.ean,
      unitSize: observation.unitSize,
    });
    if (match) {
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
      const sibling = siblings.match(observation.name, observation.sizeFormat);
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
      ({ price, priceScopeId, observation, entry }) => ({
        entryId: entry.id,
        priceScopeId,
        price: price.price,
        currency: price.currency,
        unitPrice: price.unitPrice,
        unitPriceLabel: price.unitPriceLabel,
        validFrom: price.validFrom,
        validUntil: price.validUntil,
        details: observation.extra,
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
   * The counters map onto what the batch answers, exactly as a refresh's did: a
   * new row is `updated`, because the source said something new, and a confirmed
   * row is `unchanged`. Nothing is `created` here, because the row a shopper
   * reads is derived and the run never sees it (plan 0080).
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
    entries: readonly ItemPriceBatchEntry[]
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
        sourceKind
      );
      inserted += result.inserted;
      confirmed += result.confirmed;
      await context.report({
        updated: result.inserted,
        unchanged: result.confirmed,
      });
    }
    return { inserted, confirmed };
  }
}

/** One price of one observation, beside the row and the scope it landed on. */
interface ObservedPrice {
  price: SourceObservationPrice;
  priceScopeId: string;
  observation: SourceObservation;
  entry: SourceCatalogEntry;
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
    ean: observation.ean,
    unitSize: observation.unitSize,
    sizeFormat: observation.sizeFormat,
    categoryPath: observation.categoryPath,
    url: observation.url,
    extra: observation.extra,
  };
}

function priceEntryFor(
  itemId: string,
  observation: SourceObservation,
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
    details: toItemPriceDetails(observation.extra),
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
  private readonly outcomes: SourceEntryOutcome[] = [];
  private readonly counters: SourceIngestCounters = {
    created: 0,
    updated: 0,
    unchanged: 0,
    pricesWritten: 0,
    pricesConfirmed: 0,
  };
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
    observations: readonly SourceObservation[]
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
      this.items
    );
    this.outcomes.push(...result.outcomes);
    this.counters.created += result.counters.created;
    this.counters.updated += result.counters.updated;
    this.counters.unchanged += result.counters.unchanged;
    this.counters.pricesWritten += result.counters.pricesWritten;
    this.counters.pricesConfirmed += result.counters.pricesConfirmed;
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
    return { outcomes: this.outcomes, counters: this.counters };
  }
}
