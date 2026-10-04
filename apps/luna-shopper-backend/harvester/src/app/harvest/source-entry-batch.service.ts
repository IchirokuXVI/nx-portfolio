import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  BULK_DECISION_MAX_OPERATIONS,
  BulkOperationErrorCode,
  SourceEntryStatus,
  type ApplySourceEntryDecisionsRequest,
  type ApplySourceEntryDecisionsResult,
  type CreateItemFromSourceEntryOperation,
  type CreateItemInput,
  type ItemView,
  type LocalizedText,
  type SourceEntryDecisionOperation,
  type SourceEntryDecisionOutcome,
  type SourceEntryPriceSkip,
} from '@portfolio/luna-shopper/contracts';
import {
  describeError,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { In, Repository, type EntityManager } from 'typeorm';
import { SourceCatalogEntry } from '../entities';
import { CatalogClient } from './catalog-client.service';
import { CategorySlugIndex, categorySlugsFor } from './category-resolution';
import { PlatformAdminService } from './platform-admin.service';
import { SourceEntryAvailabilityWriter } from './source-entry-availability';
import { acceptedName, lacksEnglish } from './source-entry-name';
import { createdSize } from './source-entry-size';
import {
  barcodesOf,
  bindFields,
  chainEanCounts,
  createdEan,
  eanHeldDetail,
  sharesEanInChain,
  SourceEntryPriceWriter,
  taughtEan,
} from './source-entry-write';
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
 * 4. **Write the prices, per row, skipping failures.** Then the availability
 *    the bound rows are owed (plan 0182), under the same rule.
 *
 * ## Step 4 is the one place this is not atomic, and that was decided
 *
 * Prices cross into catalog one scope at a time and cannot join the
 * transaction that bound the rows. A price write that fails skips that row's
 * prices, is named in the answer, and leaves the bind standing. The alternative
 * is a cross service rollback to undo a price, which is a saga for something an
 * operator can simply write again.
 *
 * **Availability follows the prices, in the same step and under the same rule**
 * (plan 0182). It crosses into catalog too, so it cannot join the bind either.
 * It is written after every price, in one pass over the whole file rather than
 * a row at a time: a row of DEZA has no price and up to ten shops, and a call
 * per row and shop for a thousand rows is longer than the route's timeout. A
 * failure leaves every bind standing and names the rows in `priceSkips`, with
 * a reason that says it was the availability.
 *
 * **The barcodes follow the availability, under the same rule** (plan 0185).
 * An accepted row whose real EAN no product holds gives it to its product, in
 * one call for the whole file. Whether another product holds a row's barcode
 * is decided in step 1, where it refuses the file before anything is written.
 * What is left for step 4 is the write itself, and a barcode that could not be
 * written is named in `priceSkips` with a reason that says it was the barcode.
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
    private readonly sources: SupermarketSourceService,
    private readonly availability: SourceEntryAvailabilityWriter
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
    const creates = operations.filter(isCreate);
    // Every row the file names. A create reads its row for the product's
    // defaults, and an accept reads it for the barcode it prints (plan 0185).
    const rows = await this.entries.find({
      where: { id: In(operations.map((operation) => operation.entryId)) },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    // What each chain prints its own text in, so a row accepted with no name
    // of its own files the printed string under the right language (plan
    // 0111, section 7), and how its category is read (plan 0174, section 7).
    // One read per chain on the file rather than one per row: a thousand row
    // file names a handful of chains.
    const adapterKeys = await this.adapterKeysOf(rows);
    // Before anything that crosses to catalog, because it reads nothing: a
    // product with no English name is refused here, on its own operation.
    const unnamed = checkNames(operations, byId, adapterKeys);
    if (unnamed.some((outcome) => outcome.error !== null)) {
      return refusedAt('VALIDATE', runId, unnamed, null);
    }
    const taken = await this.checkEans(operations, byId);
    if (taken.some((outcome) => outcome.error !== null)) {
      return refusedAt('VALIDATE', runId, taken, null);
    }
    // The barcode each accepted row prints (plan 0185): refused here when
    // another product holds it, and remembered for step 4 when nobody does.
    const { outcomes: held, teach } = await this.checkBarcodes(
      operations,
      byId
    );
    if (held.some((outcome) => outcome.error !== null)) {
      return refusedAt('VALIDATE', runId, held, null);
    }
    const { outcomes: unplaced, idsOf } = await this.checkCategories(
      operations,
      byId,
      adapterKeys
    );
    if (unplaced.some((outcome) => outcome.error !== null)) {
      return refusedAt('VALIDATE', runId, unplaced, null);
    }

    // --- Step 2: create every product ---------------------------------------
    let created: ItemView[] = [];
    if (creates.length > 0) {
      try {
        const result = await this.catalog.createItems(
          creates.map((operation) => {
            const entry = byId.get(operation.entryId) as SourceCatalogEntry;
            return itemFrom(
              operation,
              entry,
              adapterKeys.get(entry.supermarketId) ?? null,
              idsOf.get(operation.ref) as string[]
            );
          })
        );
        created = result.items;
      } catch (error) {
        // Catalog's 409 is the backstop for a barcode taken between the
        // check above and this write, and its sentence is the answer's.
        return refusedAt(
          'CREATE_ITEMS',
          runId,
          blank(operations),
          describeError(error).message
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
          : refusedAt(
              'BIND',
              runId,
              blank(operations),
              describeError(error).message
            );
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
          reason: describeError(error).message,
        });
        this.logger.warn(
          `Bound entry ${row.id} but could not write its prices: ` +
            describeError(error).message
        );
      }
    }

    // The availability the bound rows are owed (plan 0182): the stored claims
    // for the shops that are mapped, and an offer with no price for a row that
    // holds none. After the prices and under their rule: the binds stand
    // whatever happens here, and what could not be written is named.
    try {
      await this.availability.writeForEntries(bound);
    } catch (error) {
      const reason = `Availability: ${describeError(error).message}`;
      const named = new Set(priceSkips.map((skip) => skip.entryId));
      for (const outcome of outcomes) {
        if (!named.has(outcome.entryId)) {
          priceSkips.push({
            entryId: outcome.entryId,
            itemId: outcome.itemId ?? '',
            reason,
          });
        }
      }
      this.logger.warn(
        `Bound ${bound.length} entries but could not write their ` +
          `availability: ${describeError(error).message}`
      );
    }

    // The barcodes the accepted rows teach their products (plan 0185). Last,
    // and under the rule of this step: every bind stands, and a barcode that
    // could not be written is named with a reason that says so.
    if (teach.size > 0) {
      const pairs = [...teach].map(([index, ean]) => ({
        entryId: outcomes[index].entryId,
        itemId: outcomes[index].itemId ?? '',
        ean,
      }));
      const skip = (pair: (typeof pairs)[number], why: string) =>
        priceSkips.push({
          entryId: pair.entryId,
          itemId: pair.itemId,
          reason: `Barcode ${pair.ean}: ${why}`,
        });
      try {
        const { refused } = await this.catalog.teachItemEans(
          pairs.map(({ itemId, ean }) => ({ itemId, ean }))
        );
        for (const refusal of refused) {
          for (const pair of pairs) {
            if (pair.itemId === refusal.itemId && pair.ean === refusal.ean) {
              skip(
                pair,
                refusal.reason === 'HELD' && refusal.heldBy
                  ? eanHeldDetail(pair.ean, refusal.heldBy, pair.itemId)
                  : `it could not be added to the product (${refusal.reason}).`
              );
            }
          }
        }
      } catch (error) {
        const message = describeError(error).message;
        for (const pair of pairs) {
          skip(pair, message);
        }
        this.logger.warn(
          `Bound ${pairs.length} entries but could not add their barcodes: ` +
            message
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
   * Every barcode a create would give a product that catalog already holds,
   * named on the operation that carries it (plan 0158).
   *
   * The one at a time route asks the same question before it creates, and this
   * asks it for the same reason: catalog refuses a taken barcode anyway, but
   * refuses the whole batch with one sentence about "one of these products",
   * and the operator is left to find which. Asked here, the file is refused at
   * `VALIDATE` with the row, the barcode and the product that holds it.
   *
   * Outside any transaction on purpose: it is a round trip to catalog, and the
   * rows are not what it reads. **One** round trip for the whole file: a
   * request per barcode made a file of a thousand products spend longer here
   * than the gateway's route timeout, and the operator got a 504 for a file
   * that went on to land.
   */
  private async checkEans(
    operations: readonly SourceEntryDecisionOperation[],
    rows: ReadonlyMap<string, SourceCatalogEntry>
  ): Promise<SourceEntryDecisionOutcome[]> {
    const outcomes = blank(operations);
    const eanOf = new Map<number, string>();
    for (const [index, operation] of operations.entries()) {
      if (!isCreate(operation)) {
        continue;
      }
      const entry = rows.get(operation.entryId);
      // Only the barcode the product will actually hold (plan 0184). An
      // in-store or invalid code is not written, so it cannot be taken.
      const ean = entry ? createdEan(entry, operation.item.ean) : null;
      if (ean) {
        eanOf.set(index, ean);
      }
    }
    if (eanOf.size === 0) {
      return outcomes;
    }

    const { items } = await this.catalog.findItemsByEans([
      ...new Set(eanOf.values()),
    ]);
    // Keyed by every barcode of each product (plan 0185): the lookup finds a
    // product by any of them, so the one asked about may not be its first.
    const holders = new Map<string, string>();
    for (const item of items) {
      for (const held of barcodesOf(item)) {
        holders.set(held, item.id);
      }
    }
    for (const [index, ean] of eanOf) {
      const holder = holders.get(ean);
      if (holder) {
        fail(
          outcomes[index],
          BulkOperationErrorCode.ALREADY_TAKEN,
          `Catalog already holds an item with EAN ${ean} (${holder}). Accept ` +
            'this row onto that product instead of creating a second one.'
        );
      }
    }
    return outcomes;
  }

  /**
   * The barcode every `accept` teaches its product, and the accepts that are
   * refused because another product holds the row's barcode (plan 0185).
   *
   * **Part of validation, so a refusal writes nothing.** The file applies
   * completely or not at all, and the one barcode conflict a person has to
   * settle must stop it here, with the row, the barcode and the product that
   * holds it, like a taken barcode on a create ({@link checkEans}).
   *
   * Three cases for an accepted row that prints a real barcode:
   *
   * - The product it is accepted onto holds the barcode: nothing to do.
   * - Another product holds it, in catalog or by a create of this same file:
   *   refused with `EAN_HELD`.
   * - Nobody holds it: remembered, and written in step 4.
   *
   * Two accepts of one file that give one barcode to two products are the
   * second case for the later of the two. A row with an in-store code, an
   * invalid code or no code teaches nothing and is never refused here.
   *
   * **Neither is a row whose EAN another row of its chain prints.** That
   * barcode names no single product (plan 0155), so the row is left out of
   * all three cases: it is bound, and nothing is taught or refused for it. Two
   * such sibling rows accepted onto two products in one file both land.
   * "Shared" is the ingest's own count, read in one query for the whole file.
   *
   * One round trip to catalog for the whole file, outside any transaction, for
   * the reasons {@link checkEans} gives.
   */
  private async checkBarcodes(
    operations: readonly SourceEntryDecisionOperation[],
    rows: ReadonlyMap<string, SourceCatalogEntry>
  ): Promise<{
    outcomes: SourceEntryDecisionOutcome[];
    /** Operation index to the barcode its row teaches. */
    teach: Map<number, string>;
  }> {
    const outcomes = blank(operations);
    const teach = new Map<number, string>();

    // Who this file gives each barcode to: `id:<item>` or `ref:<create>`.
    const claims = new Map<string, string>();
    for (const operation of operations) {
      if (!isCreate(operation)) {
        continue;
      }
      const entry = rows.get(operation.entryId);
      const ean = entry ? createdEan(entry, operation.item.ean) : null;
      if (ean && !claims.has(ean)) {
        claims.set(ean, `ref:${operation.ref}`);
      }
    }

    const accepted = operations
      .filter((operation) => !isCreate(operation))
      .map((operation) => rows.get(operation.entryId))
      .filter(
        (entry): entry is SourceCatalogEntry =>
          entry !== undefined && taughtEan(entry) !== null
      );
    const shared = await chainEanCounts(this.entries, accepted);

    const accepts: { index: number; ean: string; target: string }[] = [];
    for (const [index, operation] of operations.entries()) {
      if (isCreate(operation)) {
        continue;
      }
      const entry = rows.get(operation.entryId);
      const ean =
        entry && !sharesEanInChain(entry, shared) ? taughtEan(entry) : null;
      if (ean) {
        accepts.push({
          index,
          ean,
          target: operation.itemId
            ? `id:${operation.itemId}`
            : `ref:${operation.itemRef}`,
        });
      }
    }
    if (accepts.length === 0) {
      return { outcomes, teach };
    }

    const { items } = await this.catalog.findItemsByEans([
      ...new Set(accepts.map((accept) => accept.ean)),
    ]);
    const holders = new Map<string, string>();
    for (const item of items) {
      for (const held of barcodesOf(item)) {
        holders.set(held, item.id);
      }
    }

    for (const accept of accepts) {
      const holder = holders.get(accept.ean);
      if (holder !== undefined) {
        if (accept.target !== `id:${holder}`) {
          fail(
            outcomes[accept.index],
            BulkOperationErrorCode.EAN_HELD,
            eanHeldDetail(accept.ean, holder, null)
          );
        }
        continue;
      }
      const claimed = claims.get(accept.ean);
      if (claimed === undefined) {
        claims.set(accept.ean, accept.target);
        teach.set(accept.index, accept.ean);
      } else if (claimed !== accept.target) {
        fail(
          outcomes[accept.index],
          BulkOperationErrorCode.EAN_HELD,
          `The row prints the barcode ${accept.ean}, and another operation ` +
            'of this file gives that barcode to another product. A barcode ' +
            'names one product.'
        );
      }
      // Claimed by the same target: the product this row is accepted onto is
      // created with the barcode, or an earlier accept already teaches it.
    }
    return { outcomes, teach };
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
          `Could not delete the unbound product ${itemId}: ` +
            describeError(error).message
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
  /**
   * The category ids of every product the file creates, keyed by `ref` (plan
   * 0166, section 7).
   *
   * The tree is read once for the whole file, and only when the file creates
   * something. A slug the tree does not hold fails its own operation at
   * VALIDATE, naming the slug, so nothing is created for a file that could not
   * place every product: an override typed by hand and a table leaf catalog
   * has not seeded are the same mistake from here.
   */
  private async checkCategories(
    operations: readonly SourceEntryDecisionOperation[],
    rows: ReadonlyMap<string, SourceCatalogEntry>,
    // The chain's adapter decides how a row's category is read (plan 0174,
    // section 7). One read per chain on the file, as for the names.
    adapterKeys: ReadonlyMap<string, string | null>
  ): Promise<{
    outcomes: SourceEntryDecisionOutcome[];
    idsOf: Map<string, string[]>;
  }> {
    const outcomes = blank(operations);
    const idsOf = new Map<string, string[]>();
    if (!operations.some(isCreate)) {
      return { outcomes, idsOf };
    }
    const index = new CategorySlugIndex(await this.catalog.categoryTree());
    for (const [position, operation] of operations.entries()) {
      if (!isCreate(operation)) {
        continue;
      }
      const row = rows.get(operation.entryId);
      const slugs = categorySlugsFor(
        operation.item.categorySlugs,
        row?.categoryPath,
        {
          adapterKey: row ? adapterKeys.get(row.supermarketId) : null,
          extra: row?.extra,
        }
      );
      const resolved = index.resolve(slugs);
      if (resolved.ids === null) {
        fail(
          outcomes[position],
          BulkOperationErrorCode.NOT_FOUND,
          `No category has the slug ${resolved.unknown.join(', ')}.`
        );
      } else {
        idsOf.set(operation.ref, resolved.ids);
      }
    }
    return { outcomes, idsOf };
  }

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
 * requests. The file carries both names instead, and {@link checkNames} has
 * already refused one that does not (plan 0184).
 *
 * **The EAN is a real barcode or null** (plan 0184), whether the file or the
 * row supplied it.
 */
function itemFrom(
  operation: CreateItemFromSourceEntryOperation,
  entry: SourceCatalogEntry,
  adapterKey: string | null,
  categoryIds: string[]
): CreateItemInput {
  const item = operation.item;
  // The row's size in a base unit, unless the operation names its own (plan
  // 0183), as on the per row route.
  const size = createdSize(entry, item);
  return {
    // Plan 0079: a product with no English name gets no `en` key rather than a
    // copy of the Spanish one, so the gap stays visible and a reader still sees
    // the Spanish string through the fallback. Plan 0111 says the same of `es`.
    name: acceptedName(item.name, entry.name, adapterKey),
    brand: item.brand === undefined ? entry.brand : item.brand,
    ean: createdEan(entry, item.ean),
    unitSize: size.unitSize,
    // The row's count unless the operation names one (plan 0162).
    packCount:
      item.packCount === undefined ? (entry.packCount ?? null) : item.packCount,
    // Never from the chain (plan 0038, section 5.7).
    imageUrl: null,
    sku: null,
    // Resolved from slugs by `checkCategories`, through one read of the tree
    // for the whole file (plan 0166, section 7).
    categoryIds,
    defaultUnit: size.unit,
  };
}

/**
 * Every `createItem` whose product would have no English name, refused on its
 * own operation with `NAME_EN_MISSING` (plan 0184).
 *
 * **This route translates nothing, and that was decided.** The one at a time
 * route fills a missing English name with one request to the chain, spaced a
 * quarter of a second from the next. A file is up to a thousand operations,
 * so the same fetch here is minutes of requests inside a call the gateway
 * times out, between a validation that has passed and a bind that has not
 * happened. It also answers for one chain only: every other chain publishes no
 * English at all. So the file states both names, and one that does not is
 * refused before anything is written, like every other thing a file gets
 * wrong.
 *
 * The name judged is the one the product would be created with:
 * {@link acceptedName}, so a file that names nothing falls back to what the
 * chain printed, in the language that chain prints in. A row with no name at
 * all is left for the create to refuse, in the words it always has.
 */
function checkNames(
  operations: readonly SourceEntryDecisionOperation[],
  rows: ReadonlyMap<string, SourceCatalogEntry>,
  adapterKeys: ReadonlyMap<string, string | null>
): SourceEntryDecisionOutcome[] {
  const outcomes = blank(operations);
  for (const [index, operation] of operations.entries()) {
    if (!isCreate(operation)) {
      continue;
    }
    const entry = rows.get(operation.entryId);
    if (!entry) {
      continue;
    }
    let name: LocalizedText;
    try {
      name = acceptedName(
        operation.item.name,
        entry.name,
        adapterKeys.get(entry.supermarketId) ?? null
      );
    } catch {
      continue;
    }
    if (lacksEnglish(name)) {
      fail(
        outcomes[index],
        BulkOperationErrorCode.NAME_EN_MISSING,
        `The product "${operation.ref}" would be created with no English ` +
          'name. This route translates nothing: state `item.name.en` beside ' +
          '`item.name.es`. A brand name, a range word and a foreign product ' +
          'name are written the same in both.'
      );
    }
  }
  return outcomes;
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
