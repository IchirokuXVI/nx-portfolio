import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  CATALOG_EVENTS,
  ITEM_USAGE_MAX_IDS,
  SourceEntryStatus,
  type ItemMergedEvent,
  type SourceEntryItemUsageRequest,
  type SourceEntryItemUsageResult,
} from '@portfolio/luna-shopper/contracts';
import { isUuid, ValidationException } from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import { SourceCatalogEntry } from '../entities';
import { PlatformAdminService } from './platform-admin.service';

/**
 * The harvester's half of a product merge (plan 0239, sections 1.1 and 3).
 *
 * Two jobs, both about the one column of the harvester that names a catalog
 * product, `source_catalog_entries.itemId`:
 *
 * - {@link usage} answers catalog, before it merges or deletes a product, how
 *   many rows name each product and which chains hold an `ACTIVE` row of it.
 * - {@link onItemMerged} moves the rows of a merged product onto its survivor,
 *   so the next harvest of the chain binds to the survivor by itself.
 */
@Injectable()
export class ItemMergeService {
  private readonly logger = new Logger(ItemMergeService.name);

  constructor(
    @InjectRepository(SourceCatalogEntry)
    private readonly entries: Repository<SourceCatalogEntry>,
    private readonly admin: PlatformAdminService
  ) {}

  /**
   * Counts and chains, never the rows. One entry per product asked about,
   * the ones nothing names included, because a missing entry and a zero would
   * read the same.
   */
  async usage(
    req: SourceEntryItemUsageRequest
  ): Promise<SourceEntryItemUsageResult> {
    await this.admin.requireAdmin(req);
    const itemIds = [...new Set(req.itemIds ?? [])];
    if (itemIds.length > ITEM_USAGE_MAX_IDS) {
      throw new ValidationException(
        `A usage question names at most ${ITEM_USAGE_MAX_IDS} products, and ` +
          `this one names ${itemIds.length}.`
      );
    }
    // An id that is not a uuid names no row, and casting it would fail the
    // whole statement rather than answer zero for it.
    const valid = itemIds.filter((id) => isUuid(id));
    const rows: {
      itemId: string;
      rowCount: number;
      activeSupermarketIds: string[] | null;
    }[] =
      valid.length === 0
        ? []
        : await this.entries.query(
            `SELECT e."itemId" AS "itemId",
                    count(*)::int AS "rowCount",
                    array_agg(DISTINCT e."supermarketId"::text
                              ORDER BY e."supermarketId"::text)
                      FILTER (WHERE e."status" = $2) AS "activeSupermarketIds"
               FROM "source_catalog_entries" e
              WHERE e."itemId" = ANY($1::uuid[])
              GROUP BY e."itemId"`,
            [valid, SourceEntryStatus.ACTIVE]
          );
    const byItem = new Map(rows.map((row) => [row.itemId, row]));
    return {
      usage: itemIds.map((itemId) => ({
        itemId,
        rowCount: byItem.get(itemId)?.rowCount ?? 0,
        activeSupermarketIds: byItem.get(itemId)?.activeSupermarketIds ?? [],
      })),
    };
  }

  /**
   * Move every row that names the merged product onto the survivor.
   *
   * **Idempotent by construction, and the one consumer of a catalog event
   * that does not run through `runOnce`.** The harvester has no
   * `processed_events` table, and adding one is a schema change plan 0239
   * does not make. One statement over one column does not need it: a second
   * delivery finds no row that still names the merged product, and changes
   * nothing. Whatever the status of a row, it moves: an `ACTIVE` row binds
   * the survivor, and a `CANDIDATE` row proposes it.
   *
   * It never throws at the broker. A failure is logged, and the rows still
   * name the merged product, which every catalog read answers with the
   * survivor, so nothing a shopper sees is wrong while it waits.
   */
  async onItemMerged(event: ItemMergedEvent): Promise<void> {
    if (!isUuid(event?.itemId) || !isUuid(event?.intoItemId)) {
      this.logger.warn(
        `Ignored a malformed ${CATALOG_EVENTS.itemMerged} event: ` +
          JSON.stringify(event)
      );
      return;
    }
    try {
      const [, moved] = (await this.entries.query(
        `UPDATE "source_catalog_entries"
            SET "itemId" = $2, "updatedAt" = now()
          WHERE "itemId" = $1`,
        [event.itemId, event.intoItemId]
      )) as [unknown[], number];
      this.logger.log(
        `Moved ${moved} source rows from item ${event.itemId} to ` +
          `${event.intoItemId} (event ${event.eventId}).`
      );
    } catch (err) {
      this.logger.error(
        `Could not move the source rows of merged item ${event.itemId}: ` +
          `${(err as Error).message}`
      );
    }
  }
}
