import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  BULK_DECISION_MAX_OPERATIONS,
  BulkOperationErrorCode,
  ItemCategory,
  SourceEntryStatus,
  UnitOfMeasure,
  type ApplySourceEntryDecisionsRequest,
  type ApplySourceEntryDecisionsResult,
  type CreateItemFromSourceEntryOperation,
  type CreateItemInput,
  type ItemView,
  type SourceEntryDecisionOperation,
  type SourceEntryDecisionOutcome,
  type SourceEntryPriceSkip,
} from '@portfolio/luna-shopper/contracts';
import {
  mapSizeFormat,
  resolveCategory,
} from '@portfolio/luna-shopper/mercadona';
import { ValidationException } from '@portfolio/luna-shopper/platform';
import { In, Repository, type EntityManager } from 'typeorm';
import { SourceCatalogEntry } from '../entities';
import { CatalogClient } from './catalog-client.service';
import { PlatformAdminService } from './platform-admin.service';
import { acceptedName } from './source-entry-name';
import { bindFields, SourceEntryPriceWriter } from './source-entry-write';
import { SupermarketSourceService } from './supermarket-source.service';

/** The two statuses a decision may be made about (plan 0086, D7). */
const QUEUED: readonly SourceEntryStatus[] = [
  SourceEntryStatus.CANDIDATE,
  SourceEntryStatus.UNRESOLVED,
];

/**
 * A whole decisions file, applied in one call (plan 0100).
 *
 * ## What this is for
 *
 * The curation toolchain decides a queue offline and applies the file
 * afterwards, with no model in the replay. Replaying it through the one at a
 * time routes is one request per row, so a file that goes wrong at row 300
 * leaves the queue half worked and the operator with no way to say which half.
 * This takes the whole file, checks every row before it writes anything, and
 * refuses the file rather than landing part of it.
 *
 * ## The four steps, and why they are four
 *
 * 1. **Validate everything, write nothing.** One transaction locks the named
 *    rows and checks every `expect`. A mismatch ends the request here, with an
 *    error per operation and zero writes anywhere.
 * 2. **Create every product**, in one `item.createMany` call, atomic on the
 *    catalog side, answering a real id for every `ref`.
 * 3. **Bind every row**, in one transaction, re-checking the `expect`s against
 *    rows it has locked again. The re-check is not paranoia: step 2 is a round
 *    trip to another service, and step 1's lock was released before it.
 * 4. **Write the prices, per row, skipping failures.**
 *
 * ## Step 4 is the one place this is not atomic, and that was decided
 *
 * Prices cross into catalog one scope at a time and cannot join the
 * transaction that bound the rows. A price write that fails skips that row's
 * prices, is named in the answer, and leaves the bind standing. The alternative
 * is a cross service rollback to undo a price, which is a saga for something an
 * operator can simply write again.
 *
 * ## A failed step 3 leaves orphans, and says so
 *
 * The products step 2 created are bound by nothing if step 3 fails, so they are
 * deleted best effort and whatever could not be deleted is named in the answer.
 * A cleanup that quietly fails would leave the catalog holding products nothing
 * points at and no record that it happened.
 *
 * ## It refuses by answering, not by throwing
 *
 * A file of a thousand rows refused for one bad `expect` needs to say which row
 * and which check. An exception carries one message, so the refusal is an
 * ordinary answer with `applied: false` and the per operation reasons on it.
 * Only what the whole request got wrong before any of that, an empty file or
 * one over the cap, throws.
 */
@Injectable()
export class SourceEntryBatchService {
  private readonly logger = new Logger(SourceEntryBatchService.name);

  constructor(
    @InjectRepository(SourceCatalogEntry)
    private readonly entries: Repository<SourceCatalogEntry>,
    private readonly catalog: CatalogClient,
    private readonly prices: SourceEntryPriceWriter,
    private readonly admin: PlatformAdminService,
    private readonly sources: SupermarketSourceService
  ) {}

  async applyDecisions(
    req: ApplySourceEntryDecisionsRequest
  ): Promise<ApplySourceEntryDecisionsResult> {
    await this.admin.requireAdmin(req);
    // Provenance, echoed back so a report can be filed under the session that
    // decided the file. Nothing here reads it for anything else.
    const runId = req.runId ?? null;
    const operations = req.operations ?? [];
    if (operations.length === 0) {
      throw new ValidationException(
        'A decisions file needs at least one operation.'
      );
    }
    if (operations.length > BULK_DECISION_MAX_OPERATIONS) {
      throw new ValidationException(
        `A decisions file carries at most ${BULK_DECISION_MAX_OPERATIONS} ` +
          `operations, and this one carries ${operations.length}. It is ` +
          'refused whole rather than chunked: two chunks are two transactions, ' +
          'so the first can land while the second fails, which is the half ' +
          'worked queue this route exists to prevent.'
      );
    }

    // Everything the file gets wrong on its own: a reference nothing creates,
    // a row named twice, an operation naming both alternatives or neither.
    const shape = checkShape(operations);
    if (shape.some((outcome) => outcome.error !== null)) {
      return refusedAt('VALIDATE', runId, shape, null);
    }

    // --- Step 1: validate against the rows, write nothing --------------------
    const checked = await this.entries.manager.transaction((manager) =>
      this.checkRows(manager, operations)
    );
    if (checked.some((outcome) => outcome.error !== null)) {
      return refusedAt('VALIDATE', runId, checked, null);
    }

    // --- Step 2: create every product ---------------------------------------
    const creates = operations.filter(isCreate);
    let created: ItemView[] = [];
    if (creates.length > 0) {
      const rows = await this.entries.find({
        where: { id: In(creates.map((operation) => operation.entryId)) },
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      // What each chain prints its own text in, so a row accepted with no name
      // of its own files the printed string under the right language (plan
      // 0111, section 7). One read per chain on the file rather than one per
      // row: a thousand row file names a handful of chains.
      const adapterKeys = await this.adapterKeysOf(rows);
      try {
        const result = await this.catalog.createItems(
          creates.map((operation) => {
            const entry = byId.get(operation.entryId) as SourceCatalogEntry;
            return itemFrom(
              operation,
              entry,
              adapterKeys.get(entry.supermarketId) ?? null
            );
          })
        );
        created = result.items;
      } catch (error) {
        return refusedAt(
          'CREATE_ITEMS',
          runId,
          blank(operations),
          reason(error)
        );
      }
      if (created.length !== creates.length) {
        // Catalog answers one view per input, in order. Anything else and the
        // refs cannot be matched to ids, so nothing may be bound.
        const orphaned = await this.deleteBestEffort(
          created.map((item) => item.id)
        );
        return {
          ...refusedAt(
            'CREATE_ITEMS',
            runId,
            blank(operations),
            `Catalog created ${created.length} products for ${creates.length} ` +
              'requests, so no reference can be matched to an id.'
          ),
          orphanedItemIds: orphaned,
        };
      }
    }
    const byRef = new Map<string, string>();
    creates.forEach((operation, index) => {
      byRef.set(operation.ref, created[index].id);
    });

    // --- Step 3: bind every row ---------------------------------------------
    const outcomes = blank(operations);
    try {
      await this.entries.manager.transaction(async (manager) => {
        const rechecked = await this.checkRows(manager, operations);
        if (rechecked.some((outcome) => outcome.error !== null)) {
          throw new BatchRefused(rechecked, null);
        }
        const rows = await this.lockRows(manager, operations);
        const now = new Date();
        for (const [index, operation] of operations.entries()) {
          const itemId =
            operation.op === 'createItem'
              ? (byRef.get(operation.ref) as string)
              : (operation.itemId ??
                (byRef.get(operation.itemRef as string) as string));
          const row = rows.get(operation.entryId) as SourceCatalogEntry;
          await manager.save(SourceCatalogEntry, bindFields(row, itemId, now));
          outcomes[index].itemId = itemId;
          outcomes[index].applied = true;
        }
      });
    } catch (error) {
      const orphaned = await this.deleteBestEffort(
        created.map((item) => item.id)
      );
      const refusal =
        error instanceof BatchRefused
          ? refusedAt('BIND', runId, error.outcomes, null)
          : refusedAt('BIND', runId, blank(operations), reason(error));
      return { ...refusal, orphanedItemIds: orphaned };
    }

    // --- Step 4: prices, per row, skipping failures --------------------------
    // Re-read with the prices attached: step 3 locked its rows with FOR UPDATE,
    // which Postgres refuses over the outer join a relation would add.
    const bound = await this.entries.find({
      where: { id: In(operations.map((operation) => operation.entryId)) },
      relations: { prices: true },
    });
    const withPrices = new Map(bound.map((row) => [row.id, row]));
    const priceSkips: SourceEntryPriceSkip[] = [];
    for (const [index, operation] of operations.entries()) {
      const row = withPrices.get(operation.entryId);
      if (!row) {
        continue;
      }
      try {
        outcomes[index].pricesWritten = await this.prices.write(row);
      } catch (error) {
        // The bind stands. Naming the row is what lets the operator write the
        // prices again without replaying a decision that already landed.
        priceSkips.push({
          entryId: row.id,
          itemId: outcomes[index].itemId ?? '',
          reason: reason(error),
        });
        this.logger.warn(
          `Bound entry ${row.id} but could not write its prices: ${reason(error)}`
        );
      }
    }

    return {
      runId: req.runId ?? null,
      applied: true,
      failedStep: null,
      error: null,
      results: outcomes,
      priceSkips,
      orphanedItemIds: [],
    };
  }

  /**
   * Check every operation against the row it names, inside a transaction that
   * has locked those rows.
   *
   * Run twice: once as step 1, and again inside step 3's transaction, because
   * step 1's lock is gone by the time catalog has answered.
   */
  private async checkRows(
    manager: EntityManager,
    operations: readonly SourceEntryDecisionOperation[]
  ): Promise<SourceEntryDecisionOutcome[]> {
    const outcomes = blank(operations);
    const rows = await this.lockRows(manager, operations);

    operations.forEach((operation, index) => {
      const row = rows.get(operation.entryId);
      if (!row) {
        fail(
          outcomes[index],
          BulkOperationErrorCode.NOT_FOUND,
          `Source entry ${operation.entryId} does not exist.`
        );
        return;
      }
      if (!QUEUED.includes(row.status)) {
        fail(
          outcomes[index],
          BulkOperationErrorCode.NOT_PENDING,
          `Source entry ${operation.entryId} is ${row.status}, so it is no ` +
            'longer waiting for a decision.'
        );
        return;
      }
      if (row.status !== operation.expect.status) {
        fail(
          outcomes[index],
          BulkOperationErrorCode.EXPECT_MISMATCH,
          `Source entry ${operation.entryId} is ${row.status}, and the ` +
            `decision was made when it was ${operation.expect.status}.`
        );
        return;
      }
      const seen = row.lastSeenAt.toISOString();
      if (seen !== operation.expect.lastSeenAt) {
        fail(
          outcomes[index],
          BulkOperationErrorCode.EXPECT_MISMATCH,
          `Source entry ${operation.entryId} was observed again at ${seen}, ` +
            `after the decision was made about it as of ` +
            `${operation.expect.lastSeenAt}.`
        );
      }
    });

    return outcomes;
  }

  /**
   * The named rows, locked for the length of the transaction.
   *
   * **No relations**, which is not an oversight: Postgres refuses `FOR UPDATE`
   * over the nullable side of an outer join, and a joined `prices` is exactly
   * that. Step 4 re-reads the rows with their prices once the lock is gone.
   */
  private async lockRows(
    manager: EntityManager,
    operations: readonly SourceEntryDecisionOperation[]
  ): Promise<Map<string, SourceCatalogEntry>> {
    const ids = [...new Set(operations.map((operation) => operation.entryId))];
    const rows = await manager.find(SourceCatalogEntry, {
      where: { id: In(ids) },
      lock: { mode: 'pessimistic_write' },
    });
    return new Map(rows.map((row) => [row.id, row]));
  }

  /**
   * Delete the products a failed bind left unbound, and answer the ones that
   * would not go.
   *
   * Best effort by design: the request has already failed, and a cleanup that
   * throws would replace a report the operator can act on with an error about
   * the cleanup.
   */
  private async deleteBestEffort(
    itemIds: readonly string[]
  ): Promise<string[]> {
    const orphaned: string[] = [];
    for (const itemId of itemIds) {
      try {
        await this.catalog.deleteItem(itemId);
      } catch (error) {
        orphaned.push(itemId);
        this.logger.error(
          `Could not delete the unbound product ${itemId}: ${reason(error)}`
        );
      }
    }
    return orphaned;
  }

  /**
   * The adapter key of every chain the named rows belong to.
   *
   * A chain with no source row answers nothing, which `adapterCapabilities`
   * then reads as "I know nothing" and the accept turns into a refusal rather
   * than a guessed language.
   */
  private async adapterKeysOf(
    rows: readonly SourceCatalogEntry[]
  ): Promise<Map<string, string | null>> {
    const keys = new Map<string, string | null>();
    for (const supermarketId of new Set(rows.map((row) => row.supermarketId))) {
      const source = await this.sources.findBySupermarket(supermarketId);
      keys.set(supermarketId, source?.adapterKey ?? null);
    }
    return keys;
  }
}

/**
 * The product a `createItem` operation asks for, over the row's own defaults.
 *
 * Every field the file omits falls back to what the row holds, exactly as the
 * one at a time route does, and the name is built by the same function for the
 * same reason (plan 0111, section 6): the two routes drifted once already, and
 * the batch route's copy quietly required Spanish without ever saying so.
 * **The English name is not fetched**, which is the one way the two differ:
 * that route pays one request to the chain for the one product an operator is
 * looking at, and a thousand of them inside one call would be a thousand
 * requests. The file already carries the name it decided.
 */
function itemFrom(
  operation: CreateItemFromSourceEntryOperation,
  entry: SourceCatalogEntry,
  adapterKey: string | null
): CreateItemInput {
  const item = operation.item;
  return {
    // Plan 0079: a product with no English name gets no `en` key rather than a
    // copy of the Spanish one, so the gap stays visible and a reader still sees
    // the Spanish string through the fallback. Plan 0111 says the same of `es`.
    name: acceptedName(item.name, entry.name, adapterKey),
    brand: item.brand === undefined ? entry.brand : item.brand,
    ean: item.ean === undefined ? entry.ean : item.ean,
    unitSize:
      item.unitSize === undefined
        ? entry.unitSize === null
          ? null
          : Number(entry.unitSize)
        : item.unitSize,
    // Never from the chain (plan 0038, section 5.7).
    imageUrl: null,
    sku: null,
    category:
      (item.category as ItemCategory | undefined) ??
      resolveCategory((entry.categoryPath ?? []).map((name) => ({ name }))),
    defaultUnit:
      (item.defaultUnit as UnitOfMeasure | undefined) ??
      mapSizeFormat(entry.sizeFormat) ??
      UnitOfMeasure.UNIT,
  };
}

/** Everything the file gets wrong on its own, with no database read. */
function checkShape(
  operations: readonly SourceEntryDecisionOperation[]
): SourceEntryDecisionOutcome[] {
  const outcomes = blank(operations);
  const entryIds = new Set<string>();
  const refs = new Set<string>();

  operations.forEach((operation, index) => {
    const outcome = outcomes[index];
    if (entryIds.has(operation.entryId)) {
      fail(
        outcome,
        BulkOperationErrorCode.DUPLICATE_SUBJECT,
        `Source entry ${operation.entryId} is decided twice.`
      );
      return;
    }
    entryIds.add(operation.entryId);

    if (operation.op === 'createItem') {
      // The gateway's one DTO covers both kinds, so the fields a createItem
      // needs are optional there and required here. Without the check, a file
      // missing either would reach `itemFrom` and throw on a property of
      // undefined, which says nothing about which row was wrong.
      if (!operation.ref || !operation.item) {
        fail(
          outcome,
          BulkOperationErrorCode.MALFORMED_OPERATION,
          'A createItem names a ref and carries an item.'
        );
        return;
      }
      if (refs.has(operation.ref)) {
        fail(
          outcome,
          BulkOperationErrorCode.DUPLICATE_SUBJECT,
          `Two operations create a product named "${operation.ref}".`
        );
        return;
      }
      refs.add(operation.ref);
      return;
    }

    const named =
      Number(Boolean(operation.itemId)) + Number(Boolean(operation.itemRef));
    if (named !== 1) {
      fail(
        outcome,
        BulkOperationErrorCode.MALFORMED_OPERATION,
        'An accept names exactly one of itemId and itemRef.'
      );
    }
  });

  // A reference is only checkable once every create has been seen.
  operations.forEach((operation, index) => {
    if (
      operation.op === 'accept' &&
      operation.itemRef !== undefined &&
      outcomes[index].error === null &&
      !refs.has(operation.itemRef)
    ) {
      fail(
        outcomes[index],
        BulkOperationErrorCode.UNKNOWN_REFERENCE,
        `No product of this file is named "${operation.itemRef}".`
      );
    }
  });

  return outcomes;
}

function blank(
  operations: readonly SourceEntryDecisionOperation[]
): SourceEntryDecisionOutcome[] {
  return operations.map((operation) => ({
    op: operation.op,
    entryId: operation.entryId,
    ref: operation.op === 'createItem' ? operation.ref : null,
    applied: false,
    itemId: null,
    pricesWritten: 0,
    error: null,
  }));
}

function fail(
  outcome: SourceEntryDecisionOutcome,
  code: BulkOperationErrorCode,
  detail: string
): void {
  outcome.applied = false;
  outcome.itemId = null;
  outcome.error = { code, detail };
}

/** Nothing landed, so no outcome may claim it did. */
function refusedAt(
  step: ApplySourceEntryDecisionsResult['failedStep'],
  runId: string | null,
  outcomes: SourceEntryDecisionOutcome[],
  error: string | null
): ApplySourceEntryDecisionsResult {
  return {
    runId,
    applied: false,
    failedStep: step,
    error,
    results: outcomes.map((outcome) => ({
      ...outcome,
      applied: false,
      itemId: null,
      pricesWritten: 0,
    })),
    priceSkips: [],
    orphanedItemIds: [],
  };
}

function isCreate(
  operation: SourceEntryDecisionOperation
): operation is CreateItemFromSourceEntryOperation {
  return operation.op === 'createItem';
}

function reason(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** The outcomes on their way out of a transaction that must not commit. */
class BatchRefused extends Error {
  constructor(
    readonly outcomes: SourceEntryDecisionOutcome[],
    readonly summary: string | null
  ) {
    super('The decisions file was refused.');
    this.name = 'BatchRefused';
  }
}
