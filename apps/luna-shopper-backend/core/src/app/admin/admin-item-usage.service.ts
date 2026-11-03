import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  ITEM_USAGE_MAX_IDS,
  type AdminItemUsageRequest,
  type AdminItemUsageResult,
} from '@portfolio/luna-shopper/contracts';
import { isUuid, ValidationException } from '@portfolio/luna-shopper/platform';
import { DataSource } from 'typeorm';
import { CorePlatformAdminService } from './platform-admin.service';

/**
 * How many lines name a catalog product (plan 0239, section 4).
 *
 * Catalog asks it, with the operator's credential, before it deletes a
 * product: core names products with no foreign key, so a line that holds a
 * deleted product loses it and nobody is told. It counts across every
 * household and answers no identity, as the postal code usage does.
 */
@Injectable()
export class AdminItemUsageService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly admin: CorePlatformAdminService
  ) {}

  /**
   * One entry per product asked about, the ones nothing names included. A
   * line counts once whether it holds the product in its set, as its
   * favourite, or both, and a deleted line counts too: a restore brings its
   * products back.
   */
  async usage(req: AdminItemUsageRequest): Promise<AdminItemUsageResult> {
    await this.admin.requireAdmin(req);
    const itemIds = [...new Set(req.itemIds ?? [])];
    if (itemIds.length > ITEM_USAGE_MAX_IDS) {
      throw new ValidationException(
        `A usage question names at most ${ITEM_USAGE_MAX_IDS} products, and ` +
          `this one names ${itemIds.length}.`
      );
    }
    // An id that is not a uuid names no line, and casting it would fail the
    // whole statement rather than answer zero for it.
    const valid = itemIds.filter((id) => isUuid(id));
    const rows: { itemId: string; listLineCount: number }[] =
      valid.length === 0
        ? []
        : await this.dataSource.query(
            `SELECT n."itemId" AS "itemId",
                    count(DISTINCT n."lineId")::int AS "listLineCount"
               FROM (
                 SELECT i."itemId", i."lineId"
                   FROM "list_line_items" i
                  WHERE i."itemId" = ANY($1::uuid[])
                 UNION ALL
                 SELECT l."favoriteItemId", l."id"
                   FROM "list_lines" l
                  WHERE l."favoriteItemId" = ANY($1::uuid[])
               ) n
              GROUP BY n."itemId"`,
            [valid]
          );
    const byItem = new Map(rows.map((row) => [row.itemId, row.listLineCount]));
    return {
      usage: itemIds.map((itemId) => ({
        itemId,
        listLineCount: byItem.get(itemId) ?? 0,
      })),
    };
  }
}
