import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
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
 * One product as a source described it (plan 0086, section 5).
 *
 * Every column of 3.1's first group the source can fill, and a price block only
 * when the source stated a price a shopper pays for one unit. A walk's detail
 * call, a DEZA listing row and a line of an uploaded file all become this, and
 * from here on nothing knows which of the three it was.
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
  price: {
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
  } | null;
}

export interface SourceIngestInput {
  supermarketId: string;
  /**
   * The scope the run was started for, and null for a source that states no
   * price at all. A run with no scope writes no `source_entry_prices` row and
   * calls catalog with no price, which is the DEZA crawl exactly.
   */
  priceScopeId: string | null;
  sourceKind: PriceSourceKind;
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

  async ingest(
    context: RunContext,
    input: SourceIngestInput
  ): Promise<SourceIngestResult> {
    // Step 1. The chain's rows and the catalog item index, once. Asking catalog
    // per product would be 4,232 NATS round trips on top of 4,232 HTTP ones.
    const rows = await this.entries.find({
      where: { supermarketId: input.supermarketId },
    });
    const byExternalId = new Map(rows.map((row) => [row.externalId, row]));
    const siblings = new SiblingEntryIndex(rows);
    const items = new ItemMatchIndex(await loadCatalogItems(this.catalog));

    const seenAt = new Date();
    const outcomes: SourceEntryOutcome[] = [];
    const counters: SourceIngestCounters = {
      created: 0,
      updated: 0,
      unchanged: 0,
      pricesWritten: 0,
      pricesConfirmed: 0,
    };
    /** The `source_entry_prices` rows this run observed, one per observation. */
    const observed: ObservedPrice[] = [];

    // Steps 2 and 3, per observation and in the order the runner produced them.
    for (const observation of input.observations) {
      const fields = fieldsOf(observation, input.sourceKind);
      const held = byExternalId.get(observation.externalId);
      // Asked before the touch writes, because the touch is what makes it false.
      const changed = held ? sourceGroupChanged(held, fields) : false;

      const outcome = held
        ? await this.touch(held, fields, context.runId, seenAt)
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
      const price = observation.price;
      if (price) {
        observed.push({ price, observation, entry: outcome.entry });
      }
    }

    // Step 3, in one statement per chunk rather than one per observation.
    await this.replaceScopePrices(input.priceScopeId, context.runId, observed);

    // Step 4. Only an `ACTIVE` row is owed a price: a fuzzy match never writes
    // one, because a wrong number on a real product is worse than no number.
    const owed = outcomes
      .map((outcome, index) => ({
        outcome,
        observation: input.observations[index],
      }))
      .filter(({ outcome, observation }) => outcome.itemId && observation.price)
      .map(({ outcome, observation }) =>
        priceEntryFor(outcome.itemId as string, observation)
      );
    const written = await this.writePrices(
      context,
      input.priceScopeId,
      input.sourceKind,
      owed
    );
    counters.pricesWritten = written.inserted;
    counters.pricesConfirmed = written.confirmed;

    this.logger.log(
      `Run ${context.runId}: ${input.observations.length} observation(s) ` +
        `ingested (${counters.created} new, ${counters.updated} changed), ` +
        `${owed.length} price(s) owed, ${counters.pricesWritten} written.`
    );
    return { outcomes, counters };
  }

  /**
   * Rung 1. The row exists, so it is touched and its status is not re-derived,
   * whatever it is.
   *
   * This is also what makes **resuming free** (plan 0038, section 6.3): an
   * aborted run leaves rows with a fresh `lastSeenAt`, so a re-run skips what it
   * already has by reading that timestamp. There is no checkpoint to replay,
   * only a snapshot that is already the answer.
   */
  private async touch(
    row: SourceCatalogEntry,
    fields: SourceEntryFields,
    runId: string,
    seenAt: Date
  ): Promise<SourceEntryOutcome> {
    applySourceGroup(row, fields);
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
    priceScopeId: string | null,
    runId: string,
    observed: readonly ObservedPrice[]
  ): Promise<void> {
    if (!priceScopeId || observed.length === 0) {
      return;
    }
    // Plain values rather than entity instances: an upsert takes the columns
    // it writes, and a created entity carries the `entry` relation too, which
    // has no place in an `INSERT ... ON CONFLICT`.
    const rows = observed.map(
      ({ price, observation, entry }) => ({
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
    priceScopeId: string | null,
    sourceKind: PriceSourceKind,
    entries: ItemPriceBatchEntry[]
  ): Promise<{ inserted: number; confirmed: number }> {
    if (!priceScopeId || entries.length === 0) {
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

/** One observation that carried a price, beside the row it landed on. */
interface ObservedPrice {
  price: NonNullable<SourceObservation['price']>;
  observation: SourceObservation;
  entry: SourceCatalogEntry;
}

/** The item an observation resolves to, which only an `ACTIVE` row states. */
function activeItemOf(row: SourceCatalogEntry): string | null {
  return row.status === SourceEntryStatus.ACTIVE ? row.itemId : null;
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
  observation: SourceObservation
): ItemPriceBatchEntry {
  const price = observation.price;
  return {
    itemId,
    price: price?.price ?? null,
    currency: price?.currency ?? null,
    unitPrice: price?.unitPrice ?? null,
    unitPriceLabel: price?.unitPriceLabel ?? null,
    validFrom: price?.validFrom?.toISOString() ?? null,
    validUntil: price?.validUntil?.toISOString() ?? null,
    observedAt: observation.observedAt.toISOString(),
    details: toItemPriceDetails(observation.extra),
  };
}
