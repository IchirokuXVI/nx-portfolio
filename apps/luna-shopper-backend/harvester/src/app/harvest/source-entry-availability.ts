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
 * stated once: the row is bound to a product and the shop names a location.
 *
 * ## The offer with no price, at two of those moments
 *
 * A bound row that holds no price is still an offer: a chain that lists a
 * product sells it. The offer is a `supermarket_items` row with no price in
 * the chain's default scope, and it is written when a row is bound
 * ({@link writeForEntries}) and when a run ends
 * ({@link writePricelessOffersForRun}), through one method,
 * {@link offerWithNoPrice}. The end of a run is what reaches the rows that
 * were bound before the offer existed.
 *
 * **The offer creates a row and never changes one.** Catalog derives the flag
 * of a row that exists from the shops of the scope. An offer that wrote `true`
 * over it would flip a derived `false` back on every run, and the next shop
 * claim would flip it again. So the message carries `onlyIfMissing`, and
 * catalog leaves every row that exists alone.
 *
 * **Bound means `ACTIVE`, and {@link BOUND} is the one place that says so.** A
 * `CANDIDATE` row carries the product a fuzzy match proposed, and its claims
 * are **not** sent: no automated match binds a printed name to a product, and
 * catalog turns a shop's claim into an available offer, so a match nobody
 * accepted would show a product as sold by the chain with nothing to take it
 * back. Its claims wait in the table as "waiting for a binding" and are sent
 * when a person accepts the row. Before this table existed a run sent them
 * (plan 0085), because a claim not sent at the end of the run was lost. It is
 * not lost any more.
 *
 * ## Two rows of one product, and a row the chain stopped listing
 *
 * A chain can list one product twice, and both rows can be bound to it. The
 * product is stocked at a shop when **either** row says so: the false would be
 * a claim the source never made about the product. So the answer is worked out
 * per product and shop over the rows bound to the product, never per row, and
 * binding a second row cannot overwrite what the first one said.
 *
 * **Only the claims of the newest run that spoke about the product at that
 * shop are read.** A claim is a fact about one run, and a later run replaces
 * it. A row the chain stopped listing keeps its last claim for ever, because
 * no run upserts it again: a reworded DEZA listing is a new row, since the row
 * is keyed on the printed name. Reading every claim would let the old row's
 * true outvote what the newest run said, for good.
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
  /**
   * Offers with no price that catalog created in a chain's default scope. A
   * product that already had a row there counts nothing.
   */
  pricelessOffers: number;
}

/** The claims one run stated, by what became of them. */
export interface RunClaimCounts {
  /** Every claim of the run that the table holds. */
  stored: number;
  /** Claims whose row is bound (`ACTIVE`) and whose shop names a location. */
  written: number;
  /** Claims whose row is not bound yet, a `CANDIDATE` proposal included. */
  waitingForBinding: number;
  /** Claims whose row is bound and whose shop is not mapped. */
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

/**
 * What makes a row bound, for a claim to be sent: a person, or the EAN rung,
 * decided which product it is. Over `source_catalog_entries` aliased `e`.
 *
 * One predicate, used by the send and by the counts, so that changing what
 * "bound" means is changing this line.
 */
const BOUND = `(e."status" = 'ACTIVE' AND e."itemId" IS NOT NULL)`;

/** How many claims one upsert carries. */
const STORE_CHUNK = 5000;

/** How many rows go to catalog in one call. */
const SEND_BATCH = 200;

/**
 * How many offers with no price go to catalog in one call. Larger than
 * {@link SEND_BATCH}, because the end of a DEZA run sends about 11,000 of
 * them and nearly all of them already exist, so a call is one read.
 */
const OFFER_BATCH = 500;

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
   * the shops that are mapped. The offer goes first, so the claims that follow
   * it derive the flag of the row it created. The order is not what keeps the
   * derived flag safe: the offer never changes a row that exists.
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
   * A product is sent for a shop when this run is the newest one that stated a
   * claim about it there, which at the end of a run is every pair the run
   * named. The value is what this run's rows said, and a row only an earlier
   * run saw has no say.
   */
  writeForRun(runId: string, supermarketId: string): Promise<AvailabilitySent> {
    return this.send(
      `e."supermarketId" = $1::uuid`,
      [supermarketId, runId],
      `AND r."newestRunId" = $2::uuid`
    );
  }

  /** The claims one run stated, by what became of them. */
  async countsForRun(runId: string): Promise<RunClaimCounts> {
    const [row]: Record<keyof RunClaimCounts, number>[] =
      await this.claims.query(
        `
        SELECT count(*)::int AS "stored",
               count(*) FILTER (
                 WHERE ${BOUND}
                   AND l."supermarketLocationId" IS NOT NULL
               )::int AS "written",
               count(*) FILTER (
                 WHERE NOT ${BOUND}
               )::int AS "waitingForBinding",
               count(*) FILTER (
                 WHERE ${BOUND}
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
   * The offer with no price for every bound row that one run saw (plan 0182).
   *
   * A row is read when it is bound ({@link BOUND}), this run is the last one
   * that saw it, and it holds no price whose window is open, in any scope.
   * That is the rule {@link writeForEntries} applies to the rows it is given,
   * so a row bound long ago is owed what a row bound today is owed.
   *
   * One query for the chain, then {@link offerWithNoPrice}. Answers the offers
   * catalog created, which is zero on every run after the first.
   */
  async writePricelessOffersForRun(
    runId: string,
    supermarketId: string
  ): Promise<number> {
    const rows: { itemId: string }[] = await this.claims.query(
      `
      SELECT DISTINCT e."itemId"::text AS "itemId"
        FROM "source_catalog_entries" e
       WHERE ${BOUND}
         AND e."supermarketId" = $1::uuid
         AND e."lastRunId" = $2::uuid
         AND NOT EXISTS (
               SELECT 1
                 FROM "source_entry_prices" p
                WHERE p."entryId" = e."id"
                  AND (p."validUntil" IS NULL OR p."validUntil" > $3::timestamptz)
             )
       ORDER BY 1
      `,
      [supermarketId, runId, new Date()]
    );
    return this.offerWithNoPrice(
      supermarketId,
      rows.map((row) => row.itemId)
    );
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
      offers += await this.offerWithNoPrice(supermarketId, [...items]);
    }
    return offers;
  }

  /**
   * The one write of an offer with no price, for a bind and for a run.
   *
   * A chain with no default scope gets none: there is no scope to say it in.
   * Sent with `onlyIfMissing`, so catalog creates the row of a product that
   * has none and changes no row that exists. Answers the rows it created.
   */
  private async offerWithNoPrice(
    supermarketId: string,
    itemIds: readonly string[]
  ): Promise<number> {
    if (itemIds.length === 0) {
      return 0;
    }
    const chain = await this.catalog.getSupermarket(supermarketId);
    if (!chain.defaultPriceScopeId) {
      return 0;
    }
    let offers = 0;
    for (let i = 0; i < itemIds.length; i += OFFER_BATCH) {
      const { updated } = await this.catalog.setAvailability(
        chain.defaultPriceScopeId,
        itemIds
          .slice(i, i + OFFER_BATCH)
          .map((itemId) => ({ itemId, available: true })),
        { onlyIfMissing: true }
      );
      offers += updated;
    }
    return offers;
  }

  /**
   * Read the claims that are ready and send them, one call per catalog
   * location, source kind and run.
   *
   * `where` narrows which products and shops are read, over the aliases `a`,
   * `e` and `l`. `newest` narrows further by the newest run of a pair, over
   * `r`. The two conditions that make a claim ready are here and nowhere else.
   *
   * Of the ready claims of one product at one catalog location, only those of
   * the newest run are kept, and the product is stocked when any of those says
   * so. Every claim of one run carries one `observedAt`, so the newest claim
   * names the newest run.
   */
  private async send(
    where: string,
    parameters: unknown[],
    newest = ''
  ): Promise<AvailabilitySent> {
    const ready: ReadyClaim[] = await this.claims.query(
      `
      WITH r AS (
        SELECT l."supermarketLocationId" AS "supermarketLocationId",
               l."externalId"            AS "shopCode",
               e."itemId"                AS "itemId",
               e."sourceKind"            AS "sourceKind",
               a."available"             AS "available",
               a."observedAt"            AS "observedAt",
               a."runId"                 AS "runId",
               first_value(a."runId") OVER (
                 PARTITION BY l."supermarketLocationId", e."itemId",
                              e."sourceKind"
                 ORDER BY a."observedAt" DESC, a."id" ASC
               )                         AS "newestRunId"
          FROM "source_entry_availability" a
          JOIN "source_catalog_entries" e ON e."id" = a."entryId"
          JOIN "source_locations" l ON l."id" = a."sourceLocationId"
         WHERE ${BOUND}
           AND l."supermarketLocationId" IS NOT NULL
           AND ${where}
      )
      SELECT r."supermarketLocationId"::text AS "supermarketLocationId",
             min(r."shopCode")               AS "shopCode",
             r."itemId"::text                AS "itemId",
             r."sourceKind"::text            AS "sourceKind",
             bool_or(r."available")          AS "available",
             max(r."observedAt")             AS "observedAt",
             r."newestRunId"::text           AS "runId"
        FROM r
       WHERE r."runId" IS NOT DISTINCT FROM r."newestRunId"
         ${newest}
       GROUP BY r."supermarketLocationId", r."itemId", r."sourceKind",
                r."newestRunId"
       ORDER BY r."supermarketLocationId", r."sourceKind", r."itemId"
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
