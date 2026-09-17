import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  brandKey,
  type BrandIdRequest,
  type BrandKeysRequest,
  type BrandKeysResult,
  type BrandPage,
  type BrandView,
  type CreateBrandRequest,
  type CreateBrandResult,
  type ListBrandsRequest,
  type UpdateBrandRequest,
  type UpdateBrandResult,
} from '@portfolio/luna-shopper/contracts';
import {
  BRAND_KEY_HOLDER_DETAIL,
  BrandKeyTakenException,
  BrandLabelEmptyException,
  clampPageSize,
  decodeCursor,
  encodeCursor,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import { QueryFailedError, Repository, type EntityManager } from 'typeorm';
import { Brand, Item } from '../entities';
import { CatalogAuditService } from './catalog-audit.service';
import { toBrandView, type BrandCounts } from './catalog.mappers';
import { PlatformAdminService } from './platform-admin.service';

const PG_UNIQUE_VIOLATION = '23505';

/** A brand row with the page's counts and its canonical brand's label attached. */
interface BrandRow {
  id: string;
  key: string;
  label: string;
  privateLabelSupermarketId: string | null;
  canonicalBrandId: string | null;
  canonicalLabel: string | null;
  createdAt: Date;
  updatedAt: Date;
  itemCount: number;
  linkCount: number;
}

/**
 * Where the reader stopped, under whichever order it was reading.
 *
 * The order travels in the cursor, as every other catalog cursor does, so a
 * caller that resends a different `order` mid walk keeps the page it was on
 * rather than silently jumping into a different sequence.
 */
type BrandCursor = {
  order: 'label' | 'itemCount';
  /** The label, or the item count as a string. */
  value: string;
  id: string;
};

/**
 * The registry of brands a person fills (plan 0115).
 *
 * Three things about this service are the plan rather than an implementation
 * detail:
 *
 * - **The key follows the label.** `key` is never a field of a request. It is
 *   `brandKey(label)`, recomputed on every write, so editing `Hacenado` to
 *   `Hacendado` is the only way its key becomes `hacendado`.
 * - **Registering a brand claims the products already carrying its key**, and a
 *   rename rewrites `items.brand` on everything linked to it. That copy is
 *   deliberate: the search trigger and the trigram index read `items.brand`, so
 *   keeping the label there means neither of them changes.
 * - **Items linked under an old key stay linked.** They were this brand, and a
 *   corrected spelling does not change that.
 *
 * There is no delete (section 9), and nothing here creates a row on its own: a
 * person creates every one.
 */
@Injectable()
export class BrandService {
  constructor(
    @InjectRepository(Brand) private readonly brands: Repository<Brand>,
    private readonly admin: PlatformAdminService,
    private readonly audit: CatalogAuditService
  ) {}

  /**
   * Register a brand, and claim the products already carrying its key.
   *
   * One transaction, so a brand that exists always has its items, and the row
   * count of that claim is the `linkedItems` the back office reads out.
   *
   * The 409 is raised from the unique index rather than from a lookup before
   * it, because a lookup before it is a race. The holder is then read **after**
   * the transaction aborted, through this service's own repository, since
   * nothing can be queried inside a transaction Postgres has already given up
   * on.
   */
  async create(req: CreateBrandRequest): Promise<CreateBrandResult> {
    const actor = await this.admin.requireAdmin(req);
    const label = (req.label ?? '').trim();
    const key = this.requireKey(label);

    try {
      return await this.audit.write(actor, async (tx) => {
        const saved = await tx.create(
          Brand,
          this.brands.create({
            key,
            label,
            privateLabelSupermarketId: req.privateLabelSupermarketId ?? null,
          })
        );
        const linkedItems = await this.linkUnlinkedItems(tx.manager, saved);
        const counts = await this.countsOf(tx.manager, saved);
        return { ...toBrandView(saved, counts), linkedItems };
      });
    } catch (error) {
      throw await this.asKeyTaken(error, key);
    }
  }

  /**
   * Rename a brand, or move it under a chain.
   *
   * Steps 2 to 4 of section 5.4, in one transaction: the row, then every item
   * linked to it, then the items that the new key has just made matchable.
   */
  async update(req: UpdateBrandRequest): Promise<UpdateBrandResult> {
    const actor = await this.admin.requireAdmin(req);
    const row = await this.load(req.brandId);
    const before = { ...row };
    const keyBefore = row.key;

    if (req.label !== undefined) {
      const label = req.label.trim();
      row.key = this.requireKey(label);
      row.label = label;
    }
    if (req.privateLabelSupermarketId !== undefined) {
      row.privateLabelSupermarketId = req.privateLabelSupermarketId;
    }

    try {
      return await this.audit.write(actor, async (tx) => {
        const saved = await tx.update(Brand, before, row);
        if (req.label !== undefined) {
          await tx.manager
            .createQueryBuilder()
            .update(Item)
            .set({ brand: saved.label, brandKey: saved.key })
            .where('"brandId" = :id', { id: saved.id })
            .execute();
          if (saved.key !== keyBefore) {
            await this.linkUnlinkedItems(tx.manager, saved);
          }
        }
        const counts = await this.countsOf(tx.manager, saved);
        return { ...toBrandView(saved, counts), movedItems: 0 };
      });
    } catch (error) {
      throw await this.asKeyTaken(error, row.key);
    }
  }

  async get(req: BrandIdRequest): Promise<BrandView> {
    const row = await this.load(req.brandId);
    return toBrandView(row, await this.countsOf(this.brands.manager, row));
  }

  /**
   * The registry, paged (plan 0115, section 5.2).
   *
   * `itemCount` comes from **one grouped derived table** rather than a
   * correlated count per row, which is the difference between one scan of
   * `items` and one per brand on the page.
   *
   * The cursor is a keyset under both orders, and both break their tie on the
   * id, because the curation tool reads the whole registry by following
   * `nextCursor` and a page that repeated or skipped a row would change what it
   * decided without saying so.
   */
  async list(req: ListBrandsRequest): Promise<BrandPage> {
    const limit = clampPageSize(req.limit);
    const order = req.order === 'itemCount' ? 'itemCount' : 'label';
    const cursor = decodeCursor<BrandCursor>(req.cursor);
    const values: unknown[] = [];
    const bind = (value: unknown): string => `$${values.push(value)}`;

    const where: string[] = [];
    const query = req.query?.trim();
    if (query) {
      const key = brandKey(query);
      // A query with no letters or digits keys to nothing, so it can only be
      // matched against the label. Anything else is matched against both.
      const clauses = [`b."label" ILIKE ${bind(`%${query}%`)}`];
      if (key !== null) {
        clauses.push(`b."key" LIKE ${bind(`%${key}%`)}`);
      }
      where.push(`(${clauses.join(' OR ')})`);
    }
    if (req.privateLabelSupermarketId) {
      // The canonical brand's chain counts for its spellings too: a linked
      // brand owns no chain of its own, so filtering on `b` alone would hide
      // every spelling of a private label (plan 0124, section 6).
      const chain = bind(req.privateLabelSupermarketId);
      where.push(
        `(b."privateLabelSupermarketId" = ${chain} OR c."privateLabelSupermarketId" = ${chain})`
      );
    }
    if (req.canonicalBrandId) {
      where.push(`b."canonicalBrandId" = ${bind(req.canonicalBrandId)}`);
    }

    const seek: string[] = [];
    if (cursor && cursor.order === order) {
      if (order === 'label') {
        seek.push(
          `(x."label", x."id") > (${bind(cursor.value)}, ${bind(cursor.id)})`
        );
      } else {
        // Descending on the count, ascending on the id, which is what the
        // ORDER BY below says and therefore what a keyset has to mirror.
        const count = bind(Number(cursor.value));
        seek.push(
          `(x."itemCount" < ${count} OR (x."itemCount" = ${count} AND x."id" > ${bind(cursor.id)}))`
        );
      }
    }

    const orderBy =
      order === 'label'
        ? 'x."label" ASC, x."id" ASC'
        : 'x."itemCount" DESC, x."id" ASC';

    const rows: BrandRow[] = await this.brands.query(
      `
      SELECT * FROM (
        SELECT b."id",
               b."key",
               b."label",
               b."privateLabelSupermarketId",
               b."canonicalBrandId",
               c."label" AS "canonicalLabel",
               b."createdAt",
               b."updatedAt",
               COALESCE(counts."itemCount", 0)::int AS "itemCount",
               COALESCE(links."linkCount", 0)::int AS "linkCount"
          FROM "brands" b
          LEFT JOIN "brands" c ON c."id" = b."canonicalBrandId"
          LEFT JOIN (
            SELECT "brandId", count(*)::int AS "itemCount"
              FROM "items"
             WHERE "brandId" IS NOT NULL
             GROUP BY "brandId"
          ) counts ON counts."brandId" = b."id"
          LEFT JOIN (
            SELECT "canonicalBrandId", count(*)::int AS "linkCount"
              FROM "brands"
             WHERE "canonicalBrandId" IS NOT NULL
             GROUP BY "canonicalBrandId"
          ) links ON links."canonicalBrandId" = b."id"
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ) x
      ${seek.length ? `WHERE ${seek.join(' AND ')}` : ''}
      ORDER BY ${orderBy}
      LIMIT ${bind(limit + 1)}
      `,
      values
    );

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((row) =>
        toBrandView(row, {
          itemCount: row.itemCount,
          canonicalLabel: row.canonicalLabel,
          linkCount: row.linkCount,
        })
      ),
      nextCursor:
        hasMore && last
          ? encodeCursor({
              order,
              value: order === 'label' ? last.label : String(last.itemCount),
              id: last.id,
            })
          : null,
    };
  }

  /**
   * Every registered key, and nothing else (plan 0115, section 7.3).
   *
   * The suggestions read is the harvester subtracting this set from the keys
   * its queued rows carry, and the harvester holds no copy of the registry: a
   * copy is a second answer to what is registered, and it can disagree with the
   * first. So the whole set travels in one message, whose ceiling is documented
   * on `BRAND_PATTERNS.keys`.
   */
  async keys(_req: BrandKeysRequest): Promise<BrandKeysResult> {
    const rows: { key: string }[] = await this.brands.query(
      `SELECT "key" FROM "brands" ORDER BY "key" ASC`
    );
    return { keys: rows.map((row) => row.key) };
  }

  /** Load a brand by id, or say it is not there as every catalog read does. */
  async load(id: string): Promise<Brand> {
    const row = await this.brands.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Brand not found');
    }
    return row;
  }

  /**
   * Claim every item that carries this brand's key and belongs to no brand.
   *
   * Answers the row count, which is the `linkedItems` a create reports. The
   * label is written onto `items.brand` at the same time, so an item harvested
   * as `MAHOU` reads `Mahou` from the moment the brand exists.
   *
   * **Not audited row by row**, deliberately: one register can move thousands
   * of products and the trail would carry a row per product for a single human
   * act. The act itself is the brand's own `CREATE` or `UPDATE` row, which
   * names who did it and when.
   */
  private async linkUnlinkedItems(
    manager: EntityManager,
    brand: Brand
  ): Promise<number> {
    const result = await manager
      .createQueryBuilder()
      .update(Item)
      .set({ brandId: brand.id, brand: brand.label })
      .where('"brandKey" = :key AND "brandId" IS NULL', { key: brand.key })
      .execute();
    return result.affected ?? 0;
  }

  /**
   * What a brand row cannot answer about itself, read through the caller's
   * manager.
   *
   * Three reads for one row, and sequentially rather than together: a query
   * issued inside a transaction through a second connection waits for one the
   * transaction is holding. The list pays none of this, because it answers all
   * three for the whole page in one statement.
   */
  private async countsOf(
    manager: EntityManager,
    brand: Brand
  ): Promise<BrandCounts> {
    const itemCount = await manager.count(Item, {
      where: { brandId: brand.id },
    });
    const linkCount = await manager.count(Brand, {
      where: { canonicalBrandId: brand.id },
    });
    const canonical = brand.canonicalBrandId
      ? await manager.findOne(Brand, {
          where: { id: brand.canonicalBrandId },
        })
      : null;
    return { itemCount, linkCount, canonicalLabel: canonical?.label ?? null };
  }

  /** The key a label makes, or the 400 that says the label makes none. */
  private requireKey(label: string): string {
    const key = brandKey(label);
    if (key === null) {
      throw new BrandLabelEmptyException(
        'A brand label needs at least one letter or digit, because its key is ' +
          'made of nothing else.'
      );
    }
    return key;
  }

  /**
   * Turn a unique violation on `uq_brands_key` into the 409 that names the
   * holder, and leave every other error alone.
   */
  private async asKeyTaken(error: unknown, key: string): Promise<unknown> {
    const code = (error as { driverError?: { code?: string } }).driverError
      ?.code;
    if (!(error instanceof QueryFailedError) || code !== PG_UNIQUE_VIOLATION) {
      return error;
    }
    const holder = await this.brands.findOne({ where: { key } });
    return new BrandKeyTakenException('A brand already holds that key', {
      // The id is the whole reason this is not a plain conflict: the panel that
      // met it links to the brand that holds the key.
      details: holder ? { [BRAND_KEY_HOLDER_DETAIL]: holder.id } : undefined,
    });
  }
}
