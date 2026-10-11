import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  ITEM_LINKED_IMAGE_BATCH_MAX,
  ITEM_LINKED_IMAGE_URL_MAX_LENGTH,
  type DisableAllLinkedImagesRequest,
  type DisableAllLinkedImagesResult,
  type ItemLinkedImageLink,
  type ItemLinkedImageRejection,
  type ItemLinkedImagesView,
  type LinkItemImagesRequest,
  type LinkItemImagesResult,
  type ListItemLinkedImagesRequest,
  type UnlinkItemImagesRequest,
  type UnlinkItemImagesResult,
} from '@portfolio/luna-shopper/contracts';
import {
  isUuid,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { DataSource, type EntityManager } from 'typeorm';
import { Supermarket } from '../entities';
import { CatalogAuditService } from './catalog-audit.service';
import { PlatformAdminService } from './platform-admin.service';

/**
 * The links to the photos chains print, and what a shopper is given of them
 * (plan 0198).
 *
 * ## Two questions, kept apart
 *
 * **What is saved** is `item_linked_images`: one row for each source row that
 * is bound to a product and states a photo. The harvester writes it through
 * {@link linkBatch} and {@link unlink}, whatever the switch of the chain says
 * and whether or not the product has a photo of its own.
 *
 * **What is given** is `items.linkedImages`: the links of a product whose
 * chain is turned on. {@link refreshLinkedImages} computes it, in the
 * transaction of every write that can change the answer. `toItemView` reads
 * that column and nothing else, so no read of a product can answer an address
 * of a chain that is off, and no read has to know the rule.
 *
 * ## No server opens an address
 *
 * Nothing here requests a photo, to check it or to measure it. An address is
 * a string from the moment the adapter read it until a browser loads it.
 */
@Injectable()
export class ItemLinkedImageService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly admin: PlatformAdminService,
    private readonly audit: CatalogAuditService
  ) {}

  /**
   * Save the link of each named source row (plan 0198, section 3).
   *
   * An upsert on the source row. A row that names another product than its
   * link does moves the link, and both products are refreshed. An entry that
   * cannot be saved is named in `rejected` and does not fail the batch: the
   * rows beside it are other products.
   *
   * It is the harvester's message, sent as its service actor, and an
   * operator's token passes the same gate.
   */
  async linkBatch(req: LinkItemImagesRequest): Promise<LinkItemImagesResult> {
    await this.admin.requireAdmin(req);
    const entries = req.entries ?? [];
    requireBatch(entries.length, 'link');

    const rejected: ItemLinkedImageRejection[] = [];
    // The last statement of a row is the one it holds, as in an ingest chunk.
    const bySource = new Map<string, ItemLinkedImageLink>();
    for (const entry of entries) {
      if (!isUuid(entry.sourceEntryId)) {
        throw new ValidationException(
          `"${entry.sourceEntryId}" is not a source row id.`
        );
      }
      const reason = refusalOf(entry);
      if (reason) {
        bySource.delete(entry.sourceEntryId);
        rejected.push({ sourceEntryId: entry.sourceEntryId, reason });
      } else {
        bySource.set(entry.sourceEntryId, entry);
      }
    }

    return this.dataSource.transaction(async (manager) => {
      await lockLinkedImageSwitches(manager, 'shared');

      const known = await existing(manager, [...bySource.values()]);
      for (const entry of [...bySource.values()]) {
        const reason = !known.items.has(entry.itemId)
          ? 'ITEM_NOT_FOUND'
          : !known.supermarkets.has(entry.supermarketId)
            ? 'SUPERMARKET_NOT_FOUND'
            : null;
        if (reason) {
          bySource.delete(entry.sourceEntryId);
          rejected.push({ sourceEntryId: entry.sourceEntryId, reason });
        }
      }

      // One order for every writer, so two batches that name one row wait
      // for each other and never deadlock.
      const accepted = [...bySource.values()].sort((a, b) =>
        a.sourceEntryId.localeCompare(b.sourceEntryId)
      );
      const result: LinkItemImagesResult = {
        linked: 0,
        moved: 0,
        unchanged: 0,
        rejected,
      };
      if (accepted.length === 0) {
        return result;
      }

      const held = new Map(
        (
          (await manager.query(
            `SELECT l."sourceEntryId", l."itemId", l."supermarketId", l."url"
               FROM "item_linked_images" l
              WHERE l."sourceEntryId" = ANY($1::uuid[])
              ORDER BY l."sourceEntryId"
                FOR UPDATE`,
            [accepted.map((entry) => entry.sourceEntryId)]
          )) as HeldLink[]
        ).map((row) => [row.sourceEntryId, row])
      );

      const touched = new Set<string>();
      for (const entry of accepted) {
        const before = held.get(entry.sourceEntryId);
        if (!before) {
          result.linked += 1;
          touched.add(entry.itemId);
        } else if (before.itemId !== entry.itemId) {
          result.moved += 1;
          touched.add(before.itemId);
          touched.add(entry.itemId);
        } else if (
          before.url !== entry.url ||
          before.supermarketId !== entry.supermarketId
        ) {
          result.linked += 1;
          touched.add(entry.itemId);
        } else {
          result.unchanged += 1;
        }
      }

      // `firstLinkedAt` is what orders the photos of a product, so it is kept
      // while the row stays on its product and starts again when it moves.
      await manager.query(
        `INSERT INTO "item_linked_images" AS l
                ("sourceEntryId", "itemId", "supermarketId", "url", "runId")
         SELECT v."sourceEntryId", v."itemId", v."supermarketId", v."url", v."runId"
           FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::varchar[], $5::uuid[])
                AS v("sourceEntryId", "itemId", "supermarketId", "url", "runId")
          ORDER BY v."sourceEntryId"
             ON CONFLICT ("sourceEntryId") DO UPDATE
            SET "itemId"        = EXCLUDED."itemId",
                "supermarketId" = EXCLUDED."supermarketId",
                "url"           = EXCLUDED."url",
                "runId"         = EXCLUDED."runId",
                "lastSeenAt"    = now(),
                "firstLinkedAt" = CASE
                                    WHEN l."itemId" = EXCLUDED."itemId"
                                    THEN l."firstLinkedAt"
                                    ELSE now()
                                  END`,
        [
          accepted.map((entry) => entry.sourceEntryId),
          accepted.map((entry) => entry.itemId),
          accepted.map((entry) => entry.supermarketId),
          accepted.map((entry) => entry.url),
          accepted.map((entry) =>
            entry.runId && isUuid(entry.runId) ? entry.runId : null
          ),
        ]
      );

      await refreshLinkedImages(manager, { itemIds: [...touched] });
      return result;
    });
  }

  /**
   * Remove the links of these source rows, and refresh their products.
   *
   * A row that holds no link is not an error and is not counted: the
   * harvester sends this for every row that left a product, whether or not
   * the row ever stated a photo.
   */
  async unlink(req: UnlinkItemImagesRequest): Promise<UnlinkItemImagesResult> {
    await this.admin.requireAdmin(req);
    const ids = [...new Set(req.sourceEntryIds ?? [])];
    requireBatch(ids.length, 'unlink');
    const rows = ids.filter((id) => isUuid(id));
    if (rows.length === 0) {
      return { unlinked: 0 };
    }

    return this.dataSource.transaction(async (manager) => {
      await lockLinkedImageSwitches(manager, 'shared');
      // `DELETE ... RETURNING` answers `[rows, rowCount]` through `query()`.
      const [gone] = (await manager.query(
        `DELETE FROM "item_linked_images"
          WHERE "sourceEntryId" = ANY($1::uuid[])
      RETURNING "itemId"`,
        [rows]
      )) as [{ itemId: string }[], number];
      await refreshLinkedImages(manager, {
        itemIds: [...new Set(gone.map((row) => row.itemId))],
      });
      return { unlinked: gone.length };
    });
  }

  /**
   * Stop every chain photo, in one request (plan 0198, section 4).
   *
   * Every chain is turned off and every product loses its chain photos, in
   * one transaction. The link rows stay. Each chain that was on is recorded
   * in the trail, so the log says who stopped what and when.
   *
   * It empties every product and not only those of the chains that were on,
   * so it is also the repair for a list that disagrees with its switches.
   */
  async disableAll(
    req: DisableAllLinkedImagesRequest
  ): Promise<DisableAllLinkedImagesResult> {
    const actor = await this.admin.requireAdmin(req);
    return this.audit.write(actor, async (tx) => {
      await lockLinkedImageSwitches(tx.manager, 'exclusive');
      const on = await tx.manager.find(Supermarket, {
        where: { linkedImagesEnabled: true },
        order: { id: 'ASC' },
      });
      await tx.manager.query(
        `UPDATE "supermarkets"
            SET "linkedImagesEnabled" = false, "updatedAt" = now()
          WHERE "linkedImagesEnabled"`
      );
      for (const row of on) {
        const before = { ...row };
        row.linkedImagesEnabled = false;
        await tx.recordUpdate(Supermarket, before, row);
      }
      // `UPDATE ... RETURNING` answers `[rows, rowCount]` through `query()`.
      const [emptied] = (await tx.manager.query(
        `UPDATE "items"
            SET "linkedImages" = '[]'::jsonb
          WHERE "linkedImages" <> '[]'::jsonb
      RETURNING "id"`
      )) as [{ id: string }[], number];
      return { supermarkets: on.length, items: emptied.length };
    });
  }

  /**
   * Every link of one product, of chains that are off too (plan 0198, section
   * 3.2), in the order a shopper would be given them.
   *
   * For an admin only. It is the one read that answers the address of a chain
   * that is off, so that a person can see what is saved before a chain is
   * turned on.
   */
  async listByItem(
    req: ListItemLinkedImagesRequest
  ): Promise<ItemLinkedImagesView> {
    await this.admin.requireAdmin(req);
    const found = isUuid(req.itemId)
      ? ((await this.dataSource.query(
          `SELECT 1 FROM "items" i WHERE i."id" = $1`,
          [req.itemId]
        )) as unknown[])
      : [];
    if (found.length === 0) {
      throw new NotFoundException(`Item ${req.itemId} not found`);
    }
    const rows = (await this.dataSource.query(
      `SELECT l."sourceEntryId",
              l."supermarketId",
              l."url",
              s."linkedImagesEnabled" AS "enabled",
              l."firstLinkedAt",
              l."lastSeenAt"
         FROM "item_linked_images" l
         JOIN "supermarkets" s ON s."id" = l."supermarketId"
        WHERE l."itemId" = $1
        ORDER BY l."firstLinkedAt", l."sourceEntryId"`,
      [req.itemId]
    )) as {
      sourceEntryId: string;
      supermarketId: string;
      url: string;
      enabled: boolean;
      firstLinkedAt: Date;
      lastSeenAt: Date;
    }[];
    return {
      images: rows.map((row) => ({
        sourceEntryId: row.sourceEntryId,
        supermarketId: row.supermarketId,
        url: row.url,
        enabled: row.enabled,
        firstLinkedAt: new Date(row.firstLinkedAt).toISOString(),
        lastSeenAt: new Date(row.lastSeenAt).toISOString(),
      })),
    };
  }
}

/** A link as it was before a batch wrote over it. */
interface HeldLink {
  sourceEntryId: string;
  itemId: string;
  supermarketId: string;
  url: string;
}

/** The products whose list is computed again. */
export type LinkedImageRefreshTarget =
  | { itemIds: readonly string[] }
  /** Every product that holds a link of this chain. */
  | { supermarketId: string };

/**
 * Hold the switches still for the length of a transaction (plan 0198).
 *
 * A write that saves or removes links reads the switches to compute what a
 * product shows, and a write that moves a switch rewrites what the products
 * of that chain show. Under `READ COMMITTED` the two can pass each other: a
 * batch that read "on" a moment before a stop committed would write the
 * photos of a stopped chain back onto its products.
 *
 * So the writes that move a switch take this lock `exclusive`, and the
 * writes that only read the switches take it `shared`. Link batches of two
 * runs still pass side by side. Call it first in the transaction, before any
 * row is locked, so no two writers can wait for each other.
 */
export async function lockLinkedImageSwitches(
  manager: EntityManager,
  mode: 'shared' | 'exclusive'
): Promise<void> {
  await manager.query(
    mode === 'exclusive'
      ? `SELECT pg_advisory_xact_lock(hashtext('catalog.item_linked_images'))`
      : `SELECT pg_advisory_xact_lock_shared(hashtext('catalog.item_linked_images'))`
  );
}

/** The products that hold a link of one chain, read before the chain is deleted. */
export async function itemIdsLinkedTo(
  manager: EntityManager,
  supermarketId: string
): Promise<string[]> {
  const rows = (await manager.query(
    `SELECT DISTINCT l."itemId"
       FROM "item_linked_images" l
      WHERE l."supermarketId" = $1`,
    [supermarketId]
  )) as { itemId: string }[];
  return rows.map((row) => row.itemId);
}

/**
 * Compute `items.linkedImages` again, in one statement (plan 0198, section
 * 3.1), and answer how many products changed.
 *
 * The list of a product is its links whose chain has `linkedImagesEnabled`,
 * as `[{ url, supermarketId }]`, the oldest `firstLinkedAt` first and the
 * lower `sourceEntryId` on a tie, with one entry for an address that two rows
 * state. The order is stable, so the first photo of a product does not change
 * from one read to the next because a run finished.
 *
 * It runs on the caller's `manager`, inside the transaction of the write that
 * changed the answer, and after {@link lockLinkedImageSwitches}. The products
 * are locked in id order before they are written, so two batches that share
 * products do not deadlock. A product whose list did not change is not
 * written.
 *
 * A plain `UPDATE`, outside the audit trail: the column is derived
 * (`WRITE_BOOKKEEPING` in `catalog-audit.service.ts`).
 */
export async function refreshLinkedImages(
  manager: EntityManager,
  target: LinkedImageRefreshTarget
): Promise<number> {
  const byItems = 'itemIds' in target;
  if (byItems && target.itemIds.length === 0) {
    return 0;
  }
  const which = byItems
    ? `i."id" = ANY($1::uuid[])`
    : `i."id" IN (
         SELECT l."itemId"
           FROM "item_linked_images" l
          WHERE l."supermarketId" = $1
       )`;
  // `UPDATE ... RETURNING` answers `[rows, rowCount]` through `query()`.
  const [changed] = (await manager.query(
    `WITH target AS (
       SELECT i."id"
         FROM "items" i
        WHERE ${which}
        ORDER BY i."id"
          FOR UPDATE
     ),
     shown AS (
       SELECT t."id",
              coalesce((
                SELECT jsonb_agg(
                         jsonb_build_object(
                           'url', d."url",
                           'supermarketId', d."supermarketId"
                         )
                         ORDER BY d."firstLinkedAt", d."sourceEntryId"
                       )
                  FROM (
                    SELECT DISTINCT ON (l."url")
                           l."url",
                           l."supermarketId",
                           l."firstLinkedAt",
                           l."sourceEntryId"
                      FROM "item_linked_images" l
                      JOIN "supermarkets" s ON s."id" = l."supermarketId"
                     WHERE l."itemId" = t."id"
                       AND s."linkedImagesEnabled"
                     ORDER BY l."url", l."firstLinkedAt", l."sourceEntryId"
                  ) d
              ), '[]'::jsonb) AS "images"
         FROM target t
     )
     UPDATE "items" i
        SET "linkedImages" = shown."images"
       FROM shown
      WHERE i."id" = shown."id"
        AND i."linkedImages" IS DISTINCT FROM shown."images"
  RETURNING i."id"`,
    [byItems ? [...new Set(target.itemIds)] : target.supermarketId]
  )) as [{ id: string }[], number];
  return changed.length;
}

function requireBatch(count: number, what: string): void {
  if (count > ITEM_LINKED_IMAGE_BATCH_MAX) {
    throw new ValidationException(
      `One ${what} message names at most ${ITEM_LINKED_IMAGE_BATCH_MAX} ` +
        `source rows, and this one names ${count}.`
    );
  }
}

/**
 * Why an entry cannot be saved, read from the entry alone. The address is the
 * only thing a client will load, so it is the only thing judged here: `https`
 * and no longer than the column.
 */
function refusalOf(
  entry: ItemLinkedImageLink
): ItemLinkedImageRejection['reason'] | null {
  if (typeof entry.url !== 'string' || !entry.url.startsWith('https://')) {
    return 'NOT_HTTPS';
  }
  if (entry.url.length > ITEM_LINKED_IMAGE_URL_MAX_LENGTH) {
    return 'TOO_LONG';
  }
  if (!isUuid(entry.itemId)) {
    return 'ITEM_NOT_FOUND';
  }
  if (!isUuid(entry.supermarketId)) {
    return 'SUPERMARKET_NOT_FOUND';
  }
  return null;
}

/** Which of the products and chains a batch names catalog holds. */
async function existing(
  manager: EntityManager,
  entries: readonly ItemLinkedImageLink[]
): Promise<{ items: Set<string>; supermarkets: Set<string> }> {
  if (entries.length === 0) {
    return { items: new Set(), supermarkets: new Set() };
  }
  const items = (await manager.query(
    `SELECT i."id" FROM "items" i WHERE i."id" = ANY($1::uuid[])`,
    [[...new Set(entries.map((entry) => entry.itemId))]]
  )) as { id: string }[];
  const supermarkets = (await manager.query(
    `SELECT s."id" FROM "supermarkets" s WHERE s."id" = ANY($1::uuid[])`,
    [[...new Set(entries.map((entry) => entry.supermarketId))]]
  )) as { id: string }[];
  return {
    items: new Set(items.map((row) => row.id)),
    supermarkets: new Set(supermarkets.map((row) => row.id)),
  };
}
