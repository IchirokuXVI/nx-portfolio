import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { PriceSourceKind } from '@portfolio/luna-shopper/contracts';
import { Repository } from 'typeorm';
import {
  SourceEntryAvailability,
  type SourceCatalogEntry,
  type SourceLocation,
} from '../entities';
import { CatalogClient } from './catalog-client.service';
import { openPrices } from './source-entry-write';

/**
 * What a source said about which of its shops carries which of its products,
 * stored, and sent to catalog once both sides are decided (plan 0182).
 *
 * ## Why it is stored
 *
 * A claim names a row of the source and a shop of the source. Catalog can only
 * be told about it once the row is bound to a product and the shop is mapped to
 * a location, and those are two decisions a person makes whenever they get to
 * them. A run used to send what was ready at its end and drop the rest, and on
 * the first run of a chain nothing is ready.
 *
 * ## The three moments a claim is sent, through one query
 *
 * - **A row is bound** (`accept`, `createItem`, the bulk route):
 *   {@link writeForEntries}.
 * - **A shop is mapped**: {@link writeForLocation}.
 * - **A run ends**: {@link writeForRun}.
 *
 * All three read the table through {@link send}, so what "ready" means is
 * stated once: the row names a product and the shop names a location.
 *
 * **A row that names a product, whatever its status.** A `CANDIDATE` row
 * carries the product a fuzzy match proposed, and its claims are sent, which is
 * what a run did before this table existed (plan 0085): DEZA publishes no EAN,
 * so an `ACTIVE` row there is only ever one a person accepted, and reading
 * `ACTIVE` alone would silence every run until the queue was drained. A price
 * is different, and stays `ACTIVE` only.
 *
 * ## Two rows of one product
 *
 * A chain can list one product twice, and both rows can be bound to it. The
 * product is stocked at a shop when **either** row says so: the false would be
 * a claim the source never made about the product. So the answer is worked out
 * per product and shop over every row bound to the product, never per row, and
 * binding a second row cannot overwrite what the first one said.
 *
 * ## It never deletes
 *
 * `available: false` is written as a row saying false. Nothing here removes a
 * product from a shop.
 */

/** One claim as a run states it, both sides already resolved to their rows. */
export interface StoredClaim {
  entryId: string;
  sourceLocationId: string;
  available: boolean;
}

/** What one pass over the stored claims sent to catalog. */
export interface AvailabilitySent {
  /** Rows catalog created or changed. A value it already held counts nothing. */
  written: number;
  /** Catalog locations that were sent at least one claim. */
  shops: number;
  /** Rows a person typed, which catalog left alone and reported. */
  conflicts: Record<string, unknown>[];
  /** Products given an offer with no price in their chain's default scope. */
  pricelessOffers: number;
}

/** The claims one run stated, by what became of them. */
export interface RunClaimCounts {
  /** Every claim of the run that the table holds. */
  stored: number;
  /** Claims whose row names a product and whose shop names a location. */
  written: number;
  /** Claims whose row names no product yet. */
  waitingForBinding: number;
  /** Claims whose row names a product and whose shop is not mapped. */
  waitingForShop: number;
}

/** One product at one catalog location, as {@link SourceEntryAvailabilityWriter.send} reads it. */
interface ReadyClaim {
  supermarketLocationId: string;
  shopCode: string;
  itemId: string;
  sourceKind: PriceSourceKind;
  available: boolean;
  observedAt: Date;
  runId: string | null;
}

/** How many claims one upsert carries. */
const STORE_CHUNK = 5000;

/** How many rows go to catalog in one call. */
const SEND_BATCH = 200;

@Injectable()
export class SourceEntryAvailabilityWriter {
  constructor(
    @InjectRepository(SourceEntryAvailability)
    private readonly claims: Repository<SourceEntryAvailability>,
    private readonly catalog: CatalogClient
  ) {}

  /**
   * Keep every claim of a run, bound or not, mapped or not.
   *
   * One row per row of the source and shop of the source: a claim the table
   * already holds is replaced, so a second run flips `available` and adds
   * nothing. The last claim wins on a pair a run states twice, which a listing
   * that files one product under two sections can produce.
   */
  async store(
    claims: readonly StoredClaim[],
    runId: string | null,
    observedAt: Date
  ): Promise<number> {
    const unique = new Map<string, StoredClaim>();
    for (const claim of claims) {
      unique.set(`${claim.entryId}|${claim.sourceLocationId}`, claim);
    }
    const rows = [...unique.values()];
    for (let i = 0; i < rows.length; i += STORE_CHUNK) {
      const chunk = rows.slice(i, i + STORE_CHUNK);
      await this.claims.query(
        `
        INSERT INTO "source_entry_availability"
               ("entryId", "sourceLocationId", "available", "observedAt", "runId")
        SELECT c."entryId", c."sourceLocationId", c."available",
               $4::timestamptz, $5::uuid
          FROM unnest($1::uuid[], $2::uuid[], $3::boolean[])
               AS c("entryId", "sourceLocationId", "available")
        ON CONFLICT ("entryId", "sourceLocationId") DO UPDATE
           SET "available"  = EXCLUDED."available",
               "observedAt" = EXCLUDED."observedAt",
               "runId"      = EXCLUDED."runId",
               "updatedAt"  = now()
        `,
        [
          chunk.map((claim) => claim.entryId),
          chunk.map((claim) => claim.sourceLocationId),
          chunk.map((claim) => claim.available),
          observedAt,
          runId,
        ]
      );
    }
    return rows.length;
  }

  /**
   * What binding rows owes catalog besides their prices.
   *
   * **A bound row with no price is still an offer.** A chain that lists a
   * product sells it, so a row that holds no price at all gives its product a
   * `supermarket_items` row with no price in the chain's default scope, through
   * catalog's own availability write. A row that holds a price writes that
   * price, as it always did, and nothing here. A chain with no default scope
   * gets no row: there is no scope to say it in.
   *
   * Then the stored claims of every product these rows are now bound to, for
   * the shops that are mapped. The offer goes first, because catalog derives a
   * scope's flag from its shops when a shop's claim lands and that answer is
   * the better one.
   *
   * Takes several rows because the bulk route binds a thousand at once, and a
   * call per row is a thousand round trips for one file.
   */
  async writeForEntries(
    entries: readonly SourceCatalogEntry[]
  ): Promise<AvailabilitySent> {
    const bound = entries.filter((entry) => entry.itemId);
    if (bound.length === 0) {
      return nothingSent();
    }
    const pricelessOffers = await this.writePricelessOffers(bound);
    const sent = await this.send(
      `e."itemId" = ANY($1::uuid[]) AND e."supermarketId" = ANY($2::uuid[])`,
      [
        [...new Set(bound.map((entry) => entry.itemId as string))],
        [...new Set(bound.map((entry) => entry.supermarketId))],
      ]
    );
    return { ...sent, pricelessOffers };
  }

  /** The stored claims of one shop, once a person says which location it is. */
  writeForLocation(location: SourceLocation): Promise<AvailabilitySent> {
    if (!location.supermarketLocationId) {
      return Promise.resolve(nothingSent());
    }
    return this.send(`l."id" = $1::uuid`, [location.id]);
  }

  /**
   * What a run stated, for the rows and shops that are ready as it ends.
   *
   * A product is sent when this run stated a claim about it at that shop. The
   * value is still worked out over every row bound to the product, so a row an
   * earlier run saw at the shop is not contradicted by this run's other row.
   */
  writeForRun(runId: string, supermarketId: string): Promise<AvailabilitySent> {
    return this.send(
      `e."supermarketId" = $1::uuid`,
      [supermarketId, runId],
      `HAVING bool_or(a."runId" = $2::uuid)`
    );
  }

  /** The claims one run stated, by what became of them. */
  async countsForRun(runId: string): Promise<RunClaimCounts> {
    const [row]: Record<keyof RunClaimCounts, number>[] =
      await this.claims.query(
        `
        SELECT count(*)::int AS "stored",
               count(*) FILTER (
                 WHERE e."itemId" IS NOT NULL
                   AND l."supermarketLocationId" IS NOT NULL
               )::int AS "written",
               count(*) FILTER (
                 WHERE e."itemId" IS NULL
               )::int AS "waitingForBinding",
               count(*) FILTER (
                 WHERE e."itemId" IS NOT NULL
                   AND l."supermarketLocationId" IS NULL
               )::int AS "waitingForShop"
          FROM "source_entry_availability" a
          JOIN "source_catalog_entries" e ON e."id" = a."entryId"
          JOIN "source_locations" l ON l."id" = a."sourceLocationId"
         WHERE a."runId" = $1::uuid
        `,
        [runId]
      );
    return row;
  }

  /**
   * An offer with no price, in the chain's default scope, for every product
   * whose row holds no price at all.
   */
  private async writePricelessOffers(
    bound: readonly SourceCatalogEntry[]
  ): Promise<number> {
    const now = new Date();
    const byChain = new Map<string, Set<string>>();
    for (const entry of bound) {
      if (openPrices(entry, now).length > 0) {
        continue;
      }
      const items = byChain.get(entry.supermarketId) ?? new Set<string>();
      items.add(entry.itemId as string);
      byChain.set(entry.supermarketId, items);
    }

    let offers = 0;
    for (const [supermarketId, items] of byChain) {
      const chain = await this.catalog.getSupermarket(supermarketId);
      if (!chain.defaultPriceScopeId) {
        continue;
      }
      const entries = [...items].map((itemId) => ({ itemId, available: true }));
      for (let i = 0; i < entries.length; i += SEND_BATCH) {
        await this.catalog.setAvailability(
          chain.defaultPriceScopeId,
          entries.slice(i, i + SEND_BATCH)
        );
      }
      offers += entries.length;
    }
    return offers;
  }

  /**
   * Read the claims that are ready and send them, one call per catalog
   * location, source kind and run.
   *
   * `where` narrows which products and shops are read. The two conditions that
   * make a claim ready are here and nowhere else.
   */
  private async send(
    where: string,
    parameters: unknown[],
    having = ''
  ): Promise<AvailabilitySent> {
    const ready: ReadyClaim[] = await this.claims.query(
      `
      SELECT l."supermarketLocationId"::text AS "supermarketLocationId",
             min(l."externalId")             AS "shopCode",
             e."itemId"::text                AS "itemId",
             e."sourceKind"::text            AS "sourceKind",
             bool_or(a."available")          AS "available",
             max(a."observedAt")             AS "observedAt",
             (array_agg(a."runId" ORDER BY a."observedAt" DESC, a."id" ASC))[1]::text
                                             AS "runId"
        FROM "source_entry_availability" a
        JOIN "source_catalog_entries" e ON e."id" = a."entryId"
        JOIN "source_locations" l ON l."id" = a."sourceLocationId"
       WHERE e."itemId" IS NOT NULL
         AND l."supermarketLocationId" IS NOT NULL
         AND ${where}
       GROUP BY l."supermarketLocationId", e."itemId", e."sourceKind"
       ${having}
       ORDER BY l."supermarketLocationId", e."sourceKind", e."itemId"
      `,
      parameters
    );

    const calls = new Map<string, ReadyClaim[]>();
    for (const claim of ready) {
      const key = [
        claim.supermarketLocationId,
        claim.sourceKind,
        claim.runId ?? '',
      ].join('|');
      const held = calls.get(key) ?? [];
      held.push(claim);
      calls.set(key, held);
    }

    const sent = nothingSent();
    const shops = new Set<string>();
    for (const group of calls.values()) {
      const [first] = group;
      shops.add(first.supermarketLocationId);
      const observedAt = new Date(
        Math.max(...group.map((claim) => new Date(claim.observedAt).getTime()))
      );
      for (let i = 0; i < group.length; i += SEND_BATCH) {
        const result = await this.catalog.setLocationAvailability(
          first.supermarketLocationId,
          group.slice(i, i + SEND_BATCH).map((claim) => ({
            itemId: claim.itemId,
            available: claim.available,
          })),
          first.runId,
          first.sourceKind,
          observedAt
        );
        sent.written += result.written;
        for (const conflict of result.conflicts) {
          sent.conflicts.push({ shop: first.shopCode, ...conflict });
        }
      }
    }
    sent.shops = shops.size;
    return sent;
  }
}

function nothingSent(): AvailabilitySent {
  return { written: 0, shops: 0, conflicts: [], pricelessOffers: 0 };
}
