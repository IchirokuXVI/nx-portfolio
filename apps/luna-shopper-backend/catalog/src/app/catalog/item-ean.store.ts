import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type DataSource, type EntityManager } from 'typeorm';
import { ItemEan } from '../entities';

/**
 * The rows of `item_eans` (plan 0185), and the only thing that reads or
 * writes them.
 *
 * It holds no rule about what a barcode is and none about `items.ean`.
 * `ItemService` decides both, and calls this from inside the transaction that
 * writes the product, so a product and its barcodes change together. The
 * writes therefore take the caller's `EntityManager`. The reads that a write
 * makes about another product's barcode take it too, so they see what the
 * same transaction has already written.
 *
 * The trail in `catalog_audit` keys on a uuid and this table keys on the
 * barcode, so a barcode added or removed is not a row of the trail, as a
 * product's categories are not. A change of the product's first barcode is
 * still recorded, on `items`.
 */
@Injectable()
export class ItemEanStore {
  constructor(
    @InjectRepository(ItemEan) private readonly rows: Repository<ItemEan>
  ) {}

  /**
   * Every barcode of each of these products, oldest first, in one query. A
   * product with none is absent from the map.
   */
  async eansOf(
    itemIds: readonly string[],
    manager?: EntityManager
  ): Promise<Map<string, string[]>> {
    const byItem = new Map<string, string[]>();
    const ids = [...new Set(itemIds)];
    if (ids.length === 0) {
      return byItem;
    }
    const rows = (await (manager ?? this.rows.manager).query(
      `SELECT ie."itemId", ie."ean"
         FROM "item_eans" ie
        WHERE ie."itemId" = ANY($1::uuid[])
        ORDER BY ie."itemId", ie."createdAt", ie."ean"`,
      [ids]
    )) as { itemId: string; ean: string }[];
    for (const row of rows) {
      const held = byItem.get(row.itemId);
      if (held) {
        held.push(row.ean);
      } else {
        byItem.set(row.itemId, [row.ean]);
      }
    }
    return byItem;
  }

  /**
   * The product that holds each of these barcodes, in one query. A barcode no
   * product holds is absent from the map.
   */
  async holdersOf(
    eans: readonly string[],
    manager?: EntityManager
  ): Promise<Map<string, string>> {
    const holders = new Map<string, string>();
    const codes = [...new Set(eans)];
    if (codes.length === 0) {
      return holders;
    }
    const rows = (await (manager ?? this.rows.manager).query(
      `SELECT ie."ean", ie."itemId"
         FROM "item_eans" ie
        WHERE ie."ean" = ANY($1::varchar[])`,
      [codes]
    )) as { itemId: string; ean: string }[];
    for (const row of rows) {
      holders.set(row.ean, row.itemId);
    }
    return holders;
  }

  /** The product that holds this barcode, or null. */
  async holder(manager: EntityManager, ean: string): Promise<string | null> {
    return (await this.holdersOf([ean], manager)).get(ean) ?? null;
  }

  /**
   * Give a product a barcode. A barcode another product holds fails on the
   * primary key, which the caller reads as a conflict.
   */
  async insert(
    manager: EntityManager,
    itemId: string,
    ean: string
  ): Promise<void> {
    await manager.query(
      `INSERT INTO "item_eans" ("ean", "itemId") VALUES ($1, $2)`,
      [ean, itemId]
    );
  }

  /** Take a barcode off a product. Answers whether the product held it. */
  async remove(
    manager: EntityManager,
    itemId: string,
    ean: string
  ): Promise<boolean> {
    // `DELETE ... RETURNING` answers `[rows, rowCount]` through `query()`.
    const [rows] = (await manager.query(
      `DELETE FROM "item_eans"
        WHERE "itemId" = $1 AND "ean" = $2
    RETURNING "ean"`,
      [itemId, ean]
    )) as [{ ean: string }[], number];
    return rows.length > 0;
  }
}

/**
 * The store over one data source, for a spec that builds its services by hand
 * against real Postgres.
 */
export function itemEanStoreOf(dataSource: DataSource): ItemEanStore {
  return new ItemEanStore(dataSource.getRepository(ItemEan));
}
