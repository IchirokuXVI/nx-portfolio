import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  SourceEntryStatus,
  type PriceSourceKind,
  type SupermarketItemAvailabilityEntry,
} from '@portfolio/luna-shopper/contracts';
import { describeError } from '@portfolio/luna-shopper/platform';
import type { EntityManager, Repository } from 'typeorm';
import { SourceEntryScopePresence } from '../entities';
import { CatalogClient } from './catalog-client.service';
import {
  isGone,
  itemStateOf,
  stateOf,
  statementOf,
  type DelistingReport,
  type DelistingScopeReport,
  type DelistingThreshold,
  type NotWholeListing,
  type PairRow,
  type PairState,
} from './delisting';
import type { WholeListing } from './run-report.sink';

/** How many availability rows go to catalog in one call, as the sink sends. */
const AVAILABILITY_BATCH = 200;

/** The highest count a `smallint` holds, so a miss count never overflows. */
const MISSED_WALKS_MAX = 32000;

/** What one counted run hands the counter. */
export interface DelistingInput {
  runId: string;
  supermarketId: string;
  /** The run's own kind, which decides which rows a listing resolves to. */
  sourceKind: PriceSourceKind;
  /** The whole listings of the run, resolved to their scopes. */
  whole: readonly WholeListing[];
  notWhole: readonly NotWholeListing[];
  threshold: DelistingThreshold;
  /** The scopes that also receive what the run writes at a scope (plan 0118). */
  copiesOf?: (priceScopeId: string) => readonly string[];
}

/**
 * The delisting counter (plan 0220, section 4): whole walks in a row that did
 * not list a product, per scope, and what catalog is told about them.
 *
 * **It is the only writer of `source_entry_scope_presence` and of
 * `source_catalog_entries.delistedAt`.** A runner declares a whole listing
 * and never reads either; the executor calls {@link count} once per run that
 * ended `COMPLETED`.
 *
 * **Set based, per scope, in one transaction.** Every step of section 4.2 is
 * one statement over arrays, never one per product, so a walk of fifty DIA
 * stores with no change writes nothing but the seed.
 *
 * **It deletes nothing.** A gone product keeps every price, claim and row.
 * Catalog stays the only writer of its tables: gone, out of stock and back go
 * through `supermarketItem.setAvailability`.
 */
@Injectable()
export class DelistingService {
  private readonly logger = new Logger(DelistingService.name);

  constructor(
    @InjectRepository(SourceEntryScopePresence)
    private readonly presence: Repository<SourceEntryScopePresence>,
    private readonly catalog: CatalogClient
  ) {}

  /**
   * Count one run, then send catalog what changed (sections 4.2 to 6.1).
   *
   * `now` is a parameter so a spec can walk the clock. An error is the
   * caller's to log and report: the counts of a scope are one transaction, so
   * a scope that failed counted nothing and the next counted run counts it.
   */
  async count(
    input: DelistingInput,
    now: Date = new Date()
  ): Promise<DelistingReport> {
    const report: DelistingReport = {
      counted: true,
      notCountedBecause: null,
      threshold: {
        walks: input.threshold.walks,
        days: input.threshold.days,
        fromDefaults: input.threshold.fromDefaults,
      },
      thresholdIgnored: input.threshold.ignored,
      scopes: [],
      notWhole: [...input.notWhole],
      entriesDelisted: 0,
      entriesBack: 0,
      catalogSent: 0,
      catalogFailed: 0,
      catalogKeptSold: 0,
      error: null,
    };

    const changed = new Set<string>();
    for (const listing of input.whole) {
      const counted = await this.presence.manager.transaction((manager) =>
        this.countScope(manager, input, listing, now)
      );
      report.scopes.push(counted.report);
      for (const entryId of counted.changed) {
        changed.add(entryId);
      }
    }

    const entries = await this.recomputeEntries([...changed], now);
    report.entriesDelisted = entries.delisted;
    report.entriesBack = entries.back;

    for (const listing of input.whole) {
      const sent = await this.sendPending(
        listing.scopeId,
        input.supermarketId,
        input.copiesOf
      );
      report.catalogSent += sent.sent;
      report.catalogFailed += sent.failed;
      report.catalogKeptSold += sent.keptSold;
    }
    return report;
  }

  /** Steps 1 to 5 of section 4.2 for one scope, inside its transaction. */
  private async countScope(
    manager: EntityManager,
    input: DelistingInput,
    listing: WholeListing,
    now: Date
  ): Promise<{ report: DelistingScopeReport; changed: string[] }> {
    const scopeId = listing.scopeId;

    // 1. Resolve. A listed id with no row (a new product whose detail answered
    // 404) is skipped.
    const resolvedRows: { id: string }[] = await manager.query(
      `
      SELECT e."id"::text AS "id"
        FROM "source_catalog_entries" e
       WHERE e."supermarketId" = $1::uuid
         AND e."sourceKind" = $2
         AND e."externalId" = ANY($3::varchar[])
      `,
      [input.supermarketId, input.sourceKind, [...listing.listed]]
    );
    const resolved = resolvedRows.map((row) => row.id);

    // 2. Seed. A product this scope once read a price for, before the counter
    // existed, starts at no miss. Only a price the scope read itself: a copy
    // writes rows at its targets, and a copy target never listed the product.
    const seededRows: { id: string }[] = await manager.query(
      `
      INSERT INTO "source_entry_scope_presence" ("entryId", "priceScopeId")
      SELECT DISTINCT p."entryId", $2::uuid
        FROM "source_entry_prices" p
        JOIN "source_catalog_entries" e ON e."id" = p."entryId"
       WHERE p."priceScopeId" = $2::uuid
         AND p."sourceKind" = $3
         AND p."copiedFromScopeId" IS NULL
         AND e."supermarketId" = $1::uuid
         AND e."sourceKind" = $3
         AND NOT (p."entryId" = ANY($4::uuid[]))
      ON CONFLICT ("entryId", "priceScopeId") DO NOTHING
      RETURNING "id"
      `,
      [input.supermarketId, scopeId, input.sourceKind, resolved]
    );

    // 3. Listed. A pair the walk listed exists, and one that was missed or
    // gone starts again at no miss. Catalog is told, because the first miss
    // told it the product was out of stock.
    await manager.query(
      `
      INSERT INTO "source_entry_scope_presence" ("entryId", "priceScopeId")
      SELECT unnest($1::uuid[]), $2::uuid
      ON CONFLICT ("entryId", "priceScopeId") DO NOTHING
      `,
      [resolved, scopeId]
    );
    const backRows = rowsOf<{ entryId: string; wasGone: boolean }>(
      await manager.query(
        `
        WITH b AS (
          SELECT s."id", (s."goneAt" IS NOT NULL) AS "wasGone"
            FROM "source_entry_scope_presence" s
           WHERE s."priceScopeId" = $2::uuid
             AND s."entryId" = ANY($1::uuid[])
             AND (s."missedWalks" > 0 OR s."goneAt" IS NOT NULL)
           FOR UPDATE
        )
        UPDATE "source_entry_scope_presence" s
           SET "missedWalks" = 0,
               "firstMissedAt" = NULL,
               "goneAt" = NULL,
               "lastCountedRunId" = $3::uuid,
               "pendingCatalog" = true,
               "updatedAt" = now()
          FROM b
         WHERE s."id" = b."id"
        RETURNING s."entryId"::text AS "entryId", b."wasGone" AS "wasGone"
        `,
        [resolved, scopeId, input.runId]
      )
    );

    // 4. Missed. Once per run: a retry of the same run adds nothing.
    const missedRows = rowsOf<{ first: boolean }>(
      await manager.query(
        `
      WITH m AS (
        SELECT s."id", (s."missedWalks" = 0 AND s."goneAt" IS NULL) AS "first"
          FROM "source_entry_scope_presence" s
          JOIN "source_catalog_entries" e ON e."id" = s."entryId"
         WHERE s."priceScopeId" = $2::uuid
           AND e."supermarketId" = $1::uuid
           AND NOT (s."entryId" = ANY($3::uuid[]))
           AND s."lastCountedRunId" IS DISTINCT FROM $4::uuid
         FOR UPDATE OF s
      )
      UPDATE "source_entry_scope_presence" s
         SET "missedWalks" = LEAST(s."missedWalks" + 1, ${MISSED_WALKS_MAX}),
             "firstMissedAt" = coalesce(s."firstMissedAt", $5::timestamptz),
             "lastCountedRunId" = $4::uuid,
             "pendingCatalog" = s."pendingCatalog" OR m."first",
             "updatedAt" = now()
        FROM m
       WHERE s."id" = m."id"
      RETURNING m."first" AS "first"
      `,
        [input.supermarketId, scopeId, resolved, input.runId, now]
      )
    );

    // 5. Gone. The rule is `isGone`, applied here to the rows that could meet
    // it, so the threshold has one definition.
    const candidates: {
      id: string;
      entryId: string;
      missedWalks: number;
      firstMissedAt: Date | null;
    }[] = await manager.query(
      `
      SELECT s."id"::text AS "id", s."entryId"::text AS "entryId",
             s."missedWalks"::int AS "missedWalks", s."firstMissedAt"
        FROM "source_entry_scope_presence" s
        JOIN "source_catalog_entries" e ON e."id" = s."entryId"
       WHERE s."priceScopeId" = $2::uuid
         AND e."supermarketId" = $1::uuid
         AND s."goneAt" IS NULL
         AND s."missedWalks" >= $3
      `,
      [input.supermarketId, scopeId, input.threshold.walks]
    );
    const gone = candidates.filter((row) =>
      isGone(
        row.missedWalks,
        row.firstMissedAt === null ? null : new Date(row.firstMissedAt),
        now,
        input.threshold
      )
    );
    if (gone.length > 0) {
      await manager.query(
        `
        UPDATE "source_entry_scope_presence"
           SET "goneAt" = $2::timestamptz,
               "pendingCatalog" = true,
               "updatedAt" = now()
         WHERE "id" = ANY($1::uuid[])
        `,
        [gone.map((row) => row.id), now]
      );
    }

    return {
      report: {
        scopeId,
        key: listing.key,
        listed: listing.listed.length,
        seeded: seededRows.length,
        missed: missedRows.length,
        newlyOutOfStock: missedRows.filter((row) => row.first).length,
        newlyGone: gone.length,
        cameBack: backRows.filter((row) => row.wasGone).length,
      },
      changed: [
        ...backRows.map((row) => row.entryId),
        ...gone.map((row) => row.entryId),
      ],
    };
  }

  /**
   * Section 4.3: the row of the chain is gone when every presence row of it
   * is, and back as soon as one is not. Only the entries a count changed are
   * read.
   */
  private async recomputeEntries(
    entryIds: readonly string[],
    now: Date
  ): Promise<{ delisted: number; back: number }> {
    if (entryIds.length === 0) {
      return { delisted: 0, back: 0 };
    }
    const delisted = await this.presence.query(
      `
      UPDATE "source_catalog_entries" e
         SET "delistedAt" = $2::timestamptz
       WHERE e."id" = ANY($1::uuid[])
         AND e."delistedAt" IS NULL
         AND EXISTS (
               SELECT 1 FROM "source_entry_scope_presence" s
                WHERE s."entryId" = e."id"
             )
         AND NOT EXISTS (
               SELECT 1 FROM "source_entry_scope_presence" s
                WHERE s."entryId" = e."id" AND s."goneAt" IS NULL
             )
      RETURNING e."id"
      `,
      [[...entryIds], now]
    );
    const back = await this.presence.query(
      `
      UPDATE "source_catalog_entries" e
         SET "delistedAt" = NULL
       WHERE e."id" = ANY($1::uuid[])
         AND e."delistedAt" IS NOT NULL
         AND EXISTS (
               SELECT 1 FROM "source_entry_scope_presence" s
                WHERE s."entryId" = e."id" AND s."goneAt" IS NULL
             )
      RETURNING e."id"
      `,
      [[...entryIds]]
    );
    return {
      delisted: rowsOf(delisted).length,
      back: rowsOf(back).length,
    };
  }

  /**
   * Section 6.1: every pair of this scope that catalog has not acknowledged,
   * as one statement per product, at the scope and at each of its copies.
   *
   * The statement is the product's state over every `ACTIVE` row of the
   * chain bound to it that has a presence row here (section 6.2). A pending
   * pair whose product is in another state is acknowledged with no call: a
   * row still listed keeps the product sold, and a row not gone keeps it from
   * being gone. A pair whose row is not `ACTIVE` is acknowledged with no call,
   * because catalog holds no product for it. A batch catalog refused keeps its
   * pairs pending, and the next counted run of the chain sends them again.
   */
  async sendPending(
    scopeId: string,
    supermarketId: string,
    copiesOf?: (priceScopeId: string) => readonly string[]
  ): Promise<{ sent: number; failed: number; keptSold: number }> {
    const result = { sent: 0, failed: 0, keptSold: 0 };
    const pending: {
      id: string;
      itemId: string | null;
      status: SourceEntryStatus;
      missedWalks: number;
      goneAt: Date | null;
    }[] = await this.presence.query(
      `
      SELECT s."id"::text AS "id", e."itemId"::text AS "itemId", e."status",
             s."missedWalks"::int AS "missedWalks", s."goneAt"
        FROM "source_entry_scope_presence" s
        JOIN "source_catalog_entries" e ON e."id" = s."entryId"
       WHERE s."priceScopeId" = $1::uuid
         AND e."supermarketId" = $2::uuid
         AND s."pendingCatalog"
      `,
      [scopeId, supermarketId]
    );
    if (pending.length === 0) {
      return result;
    }

    const active = pending.filter(
      (row) => row.status === SourceEntryStatus.ACTIVE && row.itemId !== null
    );
    const silent = pending
      .filter((row) => !active.includes(row))
      .map((row) => row.id);

    const itemIds = [...new Set(active.map((row) => row.itemId as string))];
    const rows: (PairRow & { itemId: string })[] =
      itemIds.length === 0
        ? []
        : await this.presence.query(
            `
            SELECT e."itemId"::text AS "itemId",
                   s."missedWalks"::int AS "missedWalks", s."goneAt"
              FROM "source_entry_scope_presence" s
              JOIN "source_catalog_entries" e ON e."id" = s."entryId"
             WHERE s."priceScopeId" = $1::uuid
               AND e."supermarketId" = $2::uuid
               AND e."status" = 'ACTIVE'
               AND e."itemId" = ANY($3::uuid[])
            `,
            [scopeId, supermarketId, itemIds]
          );
    const byItem = new Map<string, PairRow[]>();
    for (const row of rows) {
      const held = byItem.get(row.itemId) ?? [];
      held.push({ missedWalks: row.missedWalks, goneAt: row.goneAt });
      byItem.set(row.itemId, held);
    }

    const statements = new Map<
      string,
      { entry: SupermarketItemAvailabilityEntry; pairIds: string[] }
    >();
    for (const row of active) {
      const itemId = row.itemId as string;
      const state: PairState = itemStateOf(byItem.get(itemId) ?? [row]);
      if (stateOf(row) !== state) {
        silent.push(row.id);
        continue;
      }
      const held = statements.get(itemId) ?? {
        entry: statementOf(itemId, state),
        pairIds: [],
      };
      held.pairIds.push(row.id);
      statements.set(itemId, held);
    }
    // A product whose pending pairs all disagree with its state is not sent,
    // and a product with one that agrees is sent once with every such pair.
    const sendable = [...statements.values()];

    await this.acknowledge(silent);
    const targets = [scopeId, ...(copiesOf?.(scopeId) ?? [])];
    for (let i = 0; i < sendable.length; i += AVAILABILITY_BATCH) {
      const batch = sendable.slice(i, i + AVAILABILITY_BATCH);
      try {
        for (const target of targets) {
          const answer = await this.catalog.setAvailability(
            target,
            batch.map((statement) => statement.entry)
          );
          // Counted at the walked scope only, as `availabilityWritten` is.
          if (target === scopeId) {
            result.keptSold += answer.keptSold ?? 0;
          }
        }
        await this.acknowledge(batch.flatMap((statement) => statement.pairIds));
        result.sent += batch.length;
      } catch (error) {
        result.failed += batch.length;
        this.logger.warn(
          `Scope ${scopeId}: ${batch.length} delisting statement(s) were not ` +
            `sent and stay pending: ${describeError(error).message}`
        );
      }
    }
    return result;
  }

  /** Clear `pendingCatalog` on these pairs. */
  private async acknowledge(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.presence.query(
      `
      UPDATE "source_entry_scope_presence"
         SET "pendingCatalog" = false, "updatedAt" = now()
       WHERE "id" = ANY($1::uuid[])
      `,
      [[...ids]]
    );
  }
}

/**
 * The rows a statement with `RETURNING` answered. `query()` hands back the
 * rows for an `INSERT`, and the pair of the rows and the count for an
 * `UPDATE`, a `WITH ... UPDATE` included.
 */
function rowsOf<T>(answer: unknown): T[] {
  if (!Array.isArray(answer)) {
    return [];
  }
  if (
    answer.length === 2 &&
    Array.isArray(answer[0]) &&
    typeof answer[1] === 'number'
  ) {
    return answer[0] as T[];
  }
  return answer as T[];
}
