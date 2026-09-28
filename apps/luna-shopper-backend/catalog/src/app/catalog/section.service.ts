import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  SECTION_SLUG_MAX_LENGTH,
  type CreateSupermarketSectionRequest,
  type ItemSectionPinsPage,
  type ItemSectionPinsView,
  type ItemSectionsAtLocationEntry,
  type ItemSectionsAtLocationRequest,
  type ItemSectionsAtLocationView,
  type ListItemSectionPinsRequest,
  type ListSupermarketSectionsRequest,
  type LocalizedText,
  type LocationSectionsRequest,
  type LocationSectionsSource,
  type LocationSectionsView,
  type SectionRuleStep,
  type SetItemSectionPinsRequest,
  type SetLocationSectionsRequest,
  type SupermarketSectionIdRequest,
  type SupermarketSectionPage,
  type SupermarketSectionView,
  type UpdateSupermarketSectionRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  CATEGORY_UNKNOWN_DETAIL,
  CategoryNotFoundException,
  clampPageSize,
  decodeCursor,
  encodeCursor,
  isUuid,
  NotFoundException,
  SECTION_OTHER_CHAIN_DETAIL,
  SECTION_SLUG_HOLDER_DETAIL,
  SECTION_UNKNOWN_DETAIL,
  SectionNotFoundException,
  SectionOfAnotherChainException,
  SectionSlugTakenException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { QueryFailedError, Repository, type EntityManager } from 'typeorm';
import { LocationSection, SupermarketSection } from '../entities';
import { CatalogAuditService } from './catalog-audit.service';
import { PlatformAdminService } from './platform-admin.service';

/** The ascii kebab case a slug is written in, as a category's is. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';
const PG_CHECK_VIOLATION = '23514';

interface SectionListCursor extends Record<string, unknown> {
  offset: number;
}

interface PinListCursor extends Record<string, unknown> {
  after: string;
}

/** A shop, as the rule reads it: which chain it belongs to. */
interface ShopRow {
  id: string;
  supermarketId: string;
}

/** One row of {@link ITEMS_AT_LOCATION_SQL}. */
interface RuleRow {
  known: number;
  own: boolean;
  itemId: string | null;
  step: SectionRuleStep | null;
  sectionIds: string[] | null;
}

/**
 * The rule of plan 0167, section 3, for every product of one read at one shop,
 * in **one statement**. `$1` is the shop, `$2` the products (`uuid[]`).
 *
 * 1. `present`: the shop's own rows in its order, else every section of its
 *    chain in `position` order. `own` says which.
 * 2. `pinned`: the product's pins in the shop's chain that are present. A
 *    product whose pins are all absent here has no row, and falls through.
 * 3. `covered`: the present sections covering one of the product's leaves,
 *    directly or through the leaf's root. `coverage` expands a covered root to
 *    its children once, over the few present sections, so the join onto the
 *    products is an equality on `item_categories`' primary key.
 * 4. Neither: an empty list.
 *
 * Every list is in the present order. The statement always answers at least
 * one row, the head: `known` is 0 for a shop that does not exist, and a read
 * with no products answers the head alone, so the source is read in the same
 * statement too.
 *
 * Exported so the integration spec can `EXPLAIN` exactly this text.
 */
export const ITEMS_AT_LOCATION_SQL = `
  WITH "loc" AS (
    SELECT l."id", l."supermarketId"
      FROM "supermarket_locations" l
     WHERE l."id" = $1
  ),
  "own" AS (
    SELECT ls."sectionId", ls."position"::bigint AS "rank"
      FROM "location_sections" ls
     WHERE ls."supermarketLocationId" = $1
  ),
  "present" AS (
    SELECT o."sectionId", o."rank" FROM "own" o
    UNION ALL
    SELECT s."id", row_number() OVER (ORDER BY s."position", s."id")
      FROM "supermarket_sections" s
      JOIN "loc" ON loc."supermarketId" = s."supermarketId"
     WHERE NOT EXISTS (SELECT 1 FROM "own")
  ),
  "asked" AS (
    SELECT DISTINCT a."itemId" FROM unnest($2::uuid[]) AS a("itemId")
  ),
  "pinned" AS (
    SELECT p."itemId",
           array_agg(pr."sectionId" ORDER BY pr."rank")::text[] AS "sectionIds"
      FROM "asked" a
      JOIN "loc" ON true
      JOIN "supermarket_item_sections" p
        ON p."itemId" = a."itemId" AND p."supermarketId" = loc."supermarketId"
      JOIN "present" pr ON pr."sectionId" = p."sectionId"
     GROUP BY p."itemId"
  ),
  "coverage" AS (
    SELECT sc."sectionId", pr."rank", sc."categoryId" AS "leafId"
      FROM "present" pr
      JOIN "section_categories" sc ON sc."sectionId" = pr."sectionId"
    UNION
    SELECT sc."sectionId", pr."rank", ch."id"
      FROM "present" pr
      JOIN "section_categories" sc ON sc."sectionId" = pr."sectionId"
      JOIN "categories" ch ON ch."parentId" = sc."categoryId"
  ),
  "covered" AS (
    SELECT c."itemId",
           array_agg(c."sectionId" ORDER BY c."rank")::text[] AS "sectionIds"
      FROM (
        SELECT DISTINCT ic."itemId", cv."sectionId", cv."rank"
          FROM "asked" a
          JOIN "item_categories" ic ON ic."itemId" = a."itemId"
          JOIN "coverage" cv ON cv."leafId" = ic."categoryId"
      ) c
     GROUP BY c."itemId"
  ),
  "answers" AS (
    SELECT a."itemId", pn."sectionIds" AS "pinned", cv."sectionIds" AS "covered"
      FROM "asked" a
      LEFT JOIN "pinned" pn ON pn."itemId" = a."itemId"
      LEFT JOIN "covered" cv ON cv."itemId" = a."itemId"
  )
  SELECT (SELECT count(*) FROM "loc")::int AS "known",
         EXISTS (SELECT 1 FROM "own") AS "own",
         an."itemId"::text AS "itemId",
         CASE
           WHEN an."pinned" IS NOT NULL THEN 'PINNED'
           WHEN an."covered" IS NOT NULL THEN 'COVERED'
           ELSE 'NONE'
         END AS "step",
         COALESCE(an."pinned", an."covered", '{}'::text[]) AS "sectionIds"
    FROM (SELECT 1) "head"
    LEFT JOIN "answers" an ON true
`;

/**
 * Shop sections, a shop's list of them, and pins (plan 0167, sections 1 to 3).
 *
 * | Write | Means |
 * | ----- | ----- |
 * | a section with categories | this chain has an aisle called X, and it holds these kinds of product |
 * | a shop's ordered list | this shop has these of its chain's aisles, walked in this order |
 * | a product's pins in a chain | in this chain, this product is in these aisles and no other |
 *
 * **One chain per section.** A shop's list and a pin name only their own
 * chain's sections. This service refuses the rest with
 * `section_of_another_chain` before it writes, and the two triggers of the
 * migration refuse whatever reaches the tables another way, which this
 * service translates into the same exception.
 *
 * **The rule of section 3 is one statement**, {@link ITEMS_AT_LOCATION_SQL},
 * whatever the number of products, because the basket read at a shop asks it
 * once per read.
 *
 * Writes go through the platform admin gate and run inside the audit
 * transaction. The section row is audited like any catalog row; the three join
 * tables are keyed on their pairs and have no `id`, so, as with a product's
 * categories, they are written inside the same transaction and not recorded
 * row by row. Reads are open: a shop's aisle list is not private.
 */
@Injectable()
export class SectionService {
  constructor(
    @InjectRepository(SupermarketSection)
    private readonly sections: Repository<SupermarketSection>,
    private readonly admin: PlatformAdminService,
    private readonly audit: CatalogAuditService
  ) {}

  /** A new section on a chain. An absent position appends after the last. */
  async create(
    req: CreateSupermarketSectionRequest
  ): Promise<SupermarketSectionView> {
    const actor = await this.admin.requireAdmin(req);
    const slug = validateSlug(req.slug);
    validateName(req.name);
    await this.requireChain(req.supermarketId);
    const categoryIds = await this.requireCategories(req.categoryIds);
    const holder = await this.sections.findOne({
      where: { supermarketId: req.supermarketId, slug },
    });
    if (holder) {
      throw slugTaken(holder.id);
    }
    const draft = this.sections.create({
      supermarketId: req.supermarketId,
      slug,
      name: req.name,
      position: req.position ?? (await this.nextPosition(req.supermarketId)),
    });
    let saved: SupermarketSection;
    try {
      saved = await this.audit.write(actor, async (tx) => {
        const row = await tx.create(SupermarketSection, draft);
        await writeCoverage(tx.manager, row.id, categoryIds);
        return row;
      });
    } catch (error) {
      throw await this.asViolation(error, req.supermarketId, slug);
    }
    return (await this.adminViews([saved]))[0];
  }

  /**
   * One chain's sections in `position` order, filtered by `query` and paged.
   * Offset paged, like the category list: a chain has tens of aisles.
   */
  async list(
    req: ListSupermarketSectionsRequest
  ): Promise<SupermarketSectionPage> {
    await this.requireChain(req.supermarketId);
    const limit = clampPageSize(req.limit);
    const offset = Math.max(
      0,
      Number(decodeCursor<SectionListCursor>(req.cursor)?.offset ?? 0) || 0
    );
    const qb = this.sections
      .createQueryBuilder('s')
      .where('s."supermarketId" = :sid', { sid: req.supermarketId })
      .orderBy('s."position"', 'ASC')
      .addOrderBy('s."id"', 'ASC')
      .offset(offset)
      .limit(limit + 1);
    const text = req.query?.trim();
    if (text) {
      // Both content languages and the slug, through the normalization the
      // category list uses, so `charcuteria` finds `Charcutería`.
      qb.andWhere(
        `(
          "catalog_norm"(coalesce(s."name" ->> 'es', '')) LIKE '%' || "catalog_norm"(:text) || '%'
          OR "catalog_norm"(coalesce(s."name" ->> 'en', '')) LIKE '%' || "catalog_norm"(:text) || '%'
          OR s."slug" LIKE '%' || lower(:text) || '%'
        )`,
        { text }
      );
    }
    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    return {
      items: await this.adminViews(rows.slice(0, limit)),
      nextCursor: hasMore ? encodeCursor({ offset: offset + limit }) : null,
    };
  }

  async get(req: SupermarketSectionIdRequest): Promise<SupermarketSectionView> {
    const row = await this.load(req.sectionId);
    return (await this.adminViews([row]))[0];
  }

  /**
   * Rename or reorder a section, or replace the categories it covers. The slug
   * is an identity and not a field of the request.
   */
  async update(
    req: UpdateSupermarketSectionRequest
  ): Promise<SupermarketSectionView> {
    const actor = await this.admin.requireAdmin(req);
    const row = await this.load(req.sectionId);
    const before = { ...row };
    if (req.name !== undefined) {
      validateName(req.name);
      row.name = req.name;
    }
    if (req.position !== undefined) {
      row.position = req.position;
    }
    const categoryIds =
      req.categoryIds === undefined
        ? undefined
        : await this.requireCategories(req.categoryIds);
    let saved: SupermarketSection;
    try {
      saved = await this.audit.write(actor, async (tx) => {
        const updated = await tx.update(SupermarketSection, before, row);
        if (categoryIds !== undefined) {
          await writeCoverage(tx.manager, row.id, categoryIds);
        }
        return updated;
      });
    } catch (error) {
      throw await this.asViolation(error, row.supermarketId, row.slug);
    }
    return (await this.adminViews([saved]))[0];
  }

  /**
   * Delete a section. It cascades out of every shop's list and every pin
   * (section 2): a section that no longer exists cannot be a place.
   */
  async delete(req: SupermarketSectionIdRequest): Promise<{ id: string }> {
    const actor = await this.admin.requireAdmin(req);
    const row = await this.load(req.sectionId);
    await this.audit.write(actor, (tx) => tx.delete(SupermarketSection, row));
    return { id: row.id };
  }

  /** A shop's sections in its order, and where the list comes from. */
  async forLocation(
    req: LocationSectionsRequest
  ): Promise<LocationSectionsView> {
    const shop = await this.requireShop(req.supermarketLocationId);
    const { rows, source } = await this.presentSections(shop);
    const categories = await this.coverageOf(rows.map((row) => row.id));
    return {
      sections: rows.map((row) =>
        toSectionView(row, categories.get(row.id) ?? [])
      ),
      source,
    };
  }

  /**
   * Replace a shop's ordered list, whole. An empty list deletes its rows and
   * the shop returns to its chain's default.
   */
  async setForLocation(
    req: SetLocationSectionsRequest
  ): Promise<LocationSectionsView> {
    const actor = await this.admin.requireAdmin(req);
    const shop = await this.requireShop(req.supermarketLocationId);
    const ids = requireDistinct(req.sectionIds);
    await this.requireOwnSections(ids, shop.supermarketId);
    try {
      await this.audit.write(actor, async (tx) => {
        await tx.manager.query(
          `DELETE FROM "location_sections" WHERE "supermarketLocationId" = $1`,
          [shop.id]
        );
        if (ids.length > 0) {
          await tx.manager.query(
            `INSERT INTO "location_sections" ("supermarketLocationId", "sectionId", "position")
             SELECT $1, v."sectionId", v."position" - 1
               FROM unnest($2::uuid[]) WITH ORDINALITY AS v("sectionId", "position")`,
            [shop.id, ids]
          );
        }
      });
    } catch (error) {
      throw await this.asViolation(error, shop.supermarketId, null);
    }
    return this.forLocation({ supermarketLocationId: shop.id });
  }

  /**
   * One chain's pins, one entry per pinned product, ordered by product id and
   * keyset paged on it. `itemId` and `sectionId` narrow together; with
   * `sectionId`, each entry still carries every pin of that product.
   */
  async listPins(
    req: ListItemSectionPinsRequest
  ): Promise<ItemSectionPinsPage> {
    await this.requireChain(req.supermarketId);
    const empty: ItemSectionPinsPage = { items: [], nextCursor: null };
    if (
      (req.itemId !== undefined && !isUuid(req.itemId)) ||
      (req.sectionId !== undefined && !isUuid(req.sectionId))
    ) {
      // A malformed id names nothing, and casting it would fail the query.
      return empty;
    }
    const limit = clampPageSize(req.limit);
    const after = decodeCursor<PinListCursor>(req.cursor)?.after;
    const rows = (await this.sections.query(
      `SELECT p."itemId"::text AS "itemId",
              array_agg(p."sectionId" ORDER BY s."position", s."id")::text[] AS "sectionIds"
         FROM "supermarket_item_sections" p
         JOIN "supermarket_sections" s ON s."id" = p."sectionId"
        WHERE p."supermarketId" = $1
          AND ($2::uuid IS NULL OR p."itemId" = $2::uuid)
          AND ($3::uuid IS NULL OR p."itemId" IN (
                SELECT q."itemId" FROM "supermarket_item_sections" q
                 WHERE q."sectionId" = $3::uuid AND q."supermarketId" = $1))
          AND ($4::uuid IS NULL OR p."itemId" > $4::uuid)
        GROUP BY p."itemId"
        ORDER BY p."itemId"
        LIMIT $5`,
      [
        req.supermarketId,
        req.itemId ?? null,
        req.sectionId ?? null,
        after && isUuid(after) ? after : null,
        limit + 1,
      ]
    )) as { itemId: string; sectionIds: string[] }[];
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((row) => ({
        supermarketId: req.supermarketId,
        itemId: row.itemId,
        sectionIds: row.sectionIds,
      })),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ after: last.itemId })
          : null,
    };
  }

  /**
   * Replace one product's pins in one chain. An empty list removes them, and
   * the product returns to the rule's other steps. Whether the chain sells
   * the product is not checked: a pin says where it would be.
   */
  async setPins(req: SetItemSectionPinsRequest): Promise<ItemSectionPinsView> {
    const actor = await this.admin.requireAdmin(req);
    await this.requireChain(req.supermarketId);
    await this.requireItem(req.itemId);
    const ids = requireDistinct(req.sectionIds);
    const sections = await this.requireOwnSections(ids, req.supermarketId);
    try {
      await this.audit.write(actor, async (tx) => {
        await tx.manager.query(
          `DELETE FROM "supermarket_item_sections"
            WHERE "supermarketId" = $1 AND "itemId" = $2`,
          [req.supermarketId, req.itemId]
        );
        if (ids.length > 0) {
          await tx.manager.query(
            `INSERT INTO "supermarket_item_sections" ("supermarketId", "itemId", "sectionId")
             SELECT $1, $2, v."sectionId" FROM unnest($3::uuid[]) AS v("sectionId")`,
            [req.supermarketId, req.itemId, ids]
          );
        }
      });
    } catch (error) {
      throw await this.asViolation(error, req.supermarketId, null);
    }
    return {
      supermarketId: req.supermarketId,
      itemId: req.itemId,
      sectionIds: [...sections]
        .sort((a, b) => a.position - b.position || compare(a.id, b.id))
        .map((row) => row.id),
    };
  }

  /**
   * The rule of section 3 for several products at one shop, in one statement.
   *
   * One entry per distinct id, in the order first asked. An id catalog does
   * not hold answers `NONE` with no sections rather than an error, because
   * the basket read must not fail over one stale id. An unknown shop is the
   * ordinary 404 for a location.
   */
  async itemsAtLocation(
    req: ItemSectionsAtLocationRequest
  ): Promise<ItemSectionsAtLocationView> {
    if (!isUuid(req.supermarketLocationId)) {
      throw locationNotFound();
    }
    const asked = [...new Set(req.itemIds)];
    const valid = [...new Set(asked.filter(isUuid).map(lower))];
    const rows = (await this.sections.query(ITEMS_AT_LOCATION_SQL, [
      req.supermarketLocationId,
      valid,
    ])) as RuleRow[];
    const head = rows[0];
    if (!head || Number(head.known) === 0) {
      throw locationNotFound();
    }
    const byItem = new Map<string, RuleRow>();
    for (const row of rows) {
      if (row.itemId) {
        byItem.set(lower(row.itemId), row);
      }
    }
    return {
      source: head.own ? 'LOCATION' : 'CHAIN',
      items: asked.map((itemId): ItemSectionsAtLocationEntry => {
        const row = byItem.get(lower(itemId));
        return {
          itemId,
          sectionIds: row?.sectionIds ?? [],
          step: row?.step ?? 'NONE',
        };
      }),
    };
  }

  /**
   * Step 1 of the rule: the shop's own rows in its order, else every section
   * of its chain in `position` order.
   */
  private async presentSections(
    shop: ShopRow
  ): Promise<{ rows: SupermarketSection[]; source: LocationSectionsSource }> {
    const own = await this.sections
      .createQueryBuilder('s')
      .innerJoin(LocationSection, 'ls', 'ls."sectionId" = s."id"')
      .where('ls."supermarketLocationId" = :id', { id: shop.id })
      .orderBy('ls."position"', 'ASC')
      .getMany();
    if (own.length > 0) {
      return { rows: own, source: 'LOCATION' };
    }
    const chain = await this.sections.find({
      where: { supermarketId: shop.supermarketId },
      order: { position: 'ASC', id: 'ASC' },
    });
    return { rows: chain, source: 'CHAIN' };
  }

  /** The back office's views: each section with its categories and shop count. */
  private async adminViews(
    rows: readonly SupermarketSection[]
  ): Promise<SupermarketSectionView[]> {
    const ids = rows.map((row) => row.id);
    const [categories, counts] = [
      await this.coverageOf(ids),
      await this.locationCounts(ids),
    ];
    return rows.map((row) => ({
      ...toSectionView(row, categories.get(row.id) ?? []),
      locationCount: counts.get(row.id) ?? 0,
    }));
  }

  /**
   * The categories each section covers, in the tree's order (each root before
   * its children, roots by position), in one query.
   */
  private async coverageOf(
    sectionIds: readonly string[]
  ): Promise<Map<string, string[]>> {
    const bySection = new Map<string, string[]>();
    if (sectionIds.length === 0) {
      return bySection;
    }
    const rows = (await this.sections.query(
      `SELECT sc."sectionId"::text AS "sectionId", sc."categoryId"::text AS "categoryId"
         FROM "section_categories" sc
         JOIN "categories" c ON c."id" = sc."categoryId"
         LEFT JOIN "categories" p ON p."id" = c."parentId"
        WHERE sc."sectionId" = ANY($1::uuid[])
        ORDER BY sc."sectionId",
                 coalesce(p."position", c."position"),
                 coalesce(p."id", c."id"),
                 c."parentId" IS NOT NULL,
                 c."position",
                 c."id"`,
      [[...sectionIds]]
    )) as { sectionId: string; categoryId: string }[];
    for (const row of rows) {
      const list = bySection.get(row.sectionId);
      if (list) {
        list.push(row.categoryId);
      } else {
        bySection.set(row.sectionId, [row.categoryId]);
      }
    }
    return bySection;
  }

  /**
   * How many of its chain's shops each section is present at by step 1: the
   * shops whose own list names it, plus the shops with no list of their own.
   * The first half counts rows on the section's index; the second is one
   * anti join over the chain's shops.
   */
  private async locationCounts(
    sectionIds: readonly string[]
  ): Promise<Map<string, number>> {
    if (sectionIds.length === 0) {
      return new Map();
    }
    const rows = (await this.sections.query(
      `WITH "inheriting" AS (
         SELECT l."supermarketId", count(*)::int AS "count"
           FROM "supermarket_locations" l
          WHERE l."supermarketId" IN (
                  SELECT s."supermarketId" FROM "supermarket_sections" s
                   WHERE s."id" = ANY($1::uuid[]))
            AND NOT EXISTS (
                  SELECT 1 FROM "location_sections" o
                   WHERE o."supermarketLocationId" = l."id")
          GROUP BY l."supermarketId"
       )
       SELECT s."id"::text AS "id",
              ((SELECT count(*) FROM "location_sections" ls
                 WHERE ls."sectionId" = s."id")
               + coalesce(i."count", 0))::int AS "count"
         FROM "supermarket_sections" s
         LEFT JOIN "inheriting" i ON i."supermarketId" = s."supermarketId"
        WHERE s."id" = ANY($1::uuid[])`,
      [[...sectionIds]]
    )) as { id: string; count: number }[];
    return new Map(rows.map((row) => [row.id, Number(row.count)]));
  }

  /**
   * The sections a shop's list or a pin names, all of them of `chainId`:
   * refused with `section_not_found` naming the ids that match nothing, then
   * with `section_of_another_chain` naming the ones of another chain.
   */
  private async requireOwnSections(
    ids: readonly string[],
    chainId: string
  ): Promise<SupermarketSection[]> {
    if (ids.length === 0) {
      return [];
    }
    const valid = ids.filter((id) => isUuid(id));
    const rows =
      valid.length > 0
        ? await this.sections
            .createQueryBuilder('s')
            .where('s."id" = ANY(:ids)', { ids: valid })
            .getMany()
        : [];
    const known = new Map(rows.map((row) => [lower(row.id), row]));
    const unknown = ids.filter((id) => !known.has(lower(id)));
    if (unknown.length > 0) {
      throw sectionNotFound(unknown);
    }
    const foreign = ids.filter(
      (id) => known.get(lower(id))?.supermarketId !== chainId
    );
    if (foreign.length > 0) {
      throw anotherChain(foreign);
    }
    return ids.map((id) => known.get(lower(id)) as SupermarketSection);
  }

  /** The categories a section write names, all of them rows. */
  private async requireCategories(ids: readonly string[]): Promise<string[]> {
    const unique = requireDistinct(ids, 'categoryIds');
    if (unique.length === 0) {
      return [];
    }
    const valid = unique.filter((id) => isUuid(id));
    const rows =
      valid.length > 0
        ? ((await this.sections.query(
            `SELECT c."id"::text AS "id" FROM "categories" c WHERE c."id" = ANY($1::uuid[])`,
            [valid]
          )) as { id: string }[])
        : [];
    const known = new Set(rows.map((row) => lower(row.id)));
    const unknown = unique.filter((id) => !known.has(lower(id)));
    if (unknown.length > 0) {
      throw categoryNotFound(unknown);
    }
    return unique;
  }

  private async requireChain(id: string): Promise<void> {
    const rows = isUuid(id)
      ? ((await this.sections.query(
          `SELECT 1 FROM "supermarkets" WHERE "id" = $1`,
          [id]
        )) as unknown[])
      : [];
    if (rows.length === 0) {
      throw new NotFoundException('Supermarket not found');
    }
  }

  private async requireShop(id: string): Promise<ShopRow> {
    const rows = isUuid(id)
      ? ((await this.sections.query(
          `SELECT l."id"::text AS "id", l."supermarketId"::text AS "supermarketId"
             FROM "supermarket_locations" l WHERE l."id" = $1`,
          [id]
        )) as ShopRow[])
      : [];
    if (rows.length === 0) {
      throw locationNotFound();
    }
    return rows[0];
  }

  private async requireItem(id: string): Promise<void> {
    const rows = isUuid(id)
      ? ((await this.sections.query(`SELECT 1 FROM "items" WHERE "id" = $1`, [
          id,
        ])) as unknown[])
      : [];
    if (rows.length === 0) {
      throw new NotFoundException('Item not found');
    }
  }

  private async load(id: string): Promise<SupermarketSection> {
    const row = isUuid(id)
      ? await this.sections.findOne({ where: { id } })
      : null;
    if (!row) {
      throw sectionNotFound([id]);
    }
    return row;
  }

  /** After the chain's last section, or 0 for the first. */
  private async nextPosition(supermarketId: string): Promise<number> {
    const [{ next }] = (await this.sections.query(
      `SELECT coalesce(max(s."position") + 1, 0)::int AS "next"
         FROM "supermarket_sections" s
        WHERE s."supermarketId" = $1`,
      [supermarketId]
    )) as { next: number }[];
    return Number(next);
  }

  /**
   * The database's refusal of a section write, as the rule it enforces.
   *
   * The service checks every rule first, so reaching one of these means a
   * concurrent write got between the check and the statement: another create
   * took the slug, a section or category was deleted, or, from outside this
   * service, a row of another chain reached a trigger.
   */
  private async asViolation(
    error: unknown,
    supermarketId: string,
    slug: string | null
  ): Promise<unknown> {
    const driver = driverErrorOf(error);
    if (!driver) {
      return error;
    }
    const { code, constraint, detail } = driver;
    if (
      code === PG_CHECK_VIOLATION &&
      (constraint === 'ck_location_sections_chain' ||
        constraint === 'ck_item_sections_chain')
    ) {
      return anotherChain(detail ? [detail] : []);
    }
    if (
      code === PG_UNIQUE_VIOLATION &&
      constraint === 'uq_supermarket_sections_slug' &&
      slug !== null
    ) {
      const holder = await this.sections.findOne({
        where: { supermarketId, slug },
      });
      return slugTaken(holder?.id ?? '');
    }
    if (code === PG_FOREIGN_KEY_VIOLATION) {
      if (constraint === 'fk_section_categories_category') {
        return categoryNotFound([]);
      }
      if (
        constraint === 'fk_location_sections_section' ||
        constraint === 'fk_item_sections_section' ||
        constraint === 'fk_section_categories_section'
      ) {
        return sectionNotFound([]);
      }
      if (constraint === 'fk_location_sections_location') {
        return locationNotFound();
      }
      if (constraint === 'fk_item_sections_item') {
        return new NotFoundException('Item not found');
      }
      if (
        constraint === 'fk_item_sections_supermarket' ||
        constraint === 'fk_supermarket_sections_supermarket'
      ) {
        return new NotFoundException('Supermarket not found');
      }
    }
    return error;
  }
}

/** Replace a section's categories, inside the caller's transaction. */
async function writeCoverage(
  manager: EntityManager,
  sectionId: string,
  categoryIds: readonly string[]
): Promise<void> {
  await manager.query(
    `DELETE FROM "section_categories" WHERE "sectionId" = $1`,
    [sectionId]
  );
  if (categoryIds.length > 0) {
    await manager.query(
      `INSERT INTO "section_categories" ("sectionId", "categoryId")
       SELECT $1, v."categoryId" FROM unnest($2::uuid[]) AS v("categoryId")`,
      [sectionId, [...categoryIds]]
    );
  }
}

export function toSectionView(
  row: SupermarketSection,
  categoryIds: string[]
): SupermarketSectionView {
  return {
    id: row.id,
    supermarketId: row.supermarketId,
    slug: row.slug,
    name: row.name,
    position: row.position,
    categoryIds,
  };
}

/** A list with no repeats, refused whole when it has one. */
function requireDistinct(
  ids: readonly string[],
  field: 'sectionIds' | 'categoryIds' = 'sectionIds'
): string[] {
  const unique = [...new Set(ids.map(lower))];
  if (unique.length !== ids.length) {
    throw new ValidationException(`${field} must not repeat an id`, {
      messageArgs: { field },
    });
  }
  return [...ids];
}

function validateSlug(slug: string): string {
  const trimmed = slug.trim();
  if (trimmed.length > SECTION_SLUG_MAX_LENGTH || !SLUG_PATTERN.test(trimmed)) {
    throw new ValidationException(
      'slug must be lower case ascii words separated by single dashes, ' +
        `at most ${SECTION_SLUG_MAX_LENGTH} characters`,
      { messageArgs: { field: 'slug' } }
    );
  }
  return trimmed;
}

function validateName(name: LocalizedText): void {
  const en = name?.en?.trim();
  const es = name?.es?.trim();
  if (!en && !es) {
    throw new ValidationException('name needs at least one of en and es', {
      messageArgs: { field: 'name' },
    });
  }
}

function lower(id: string): string {
  return id.toLowerCase();
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function driverErrorOf(
  error: unknown
): { code?: string; constraint?: string; detail?: string } | null {
  if (!(error instanceof QueryFailedError)) {
    return null;
  }
  return (
    (
      error as {
        driverError?: { code?: string; constraint?: string; detail?: string };
      }
    ).driverError ?? null
  );
}

function sectionNotFound(unknown: readonly string[]): SectionNotFoundException {
  return new SectionNotFoundException('That section does not exist.', {
    details: { [SECTION_UNKNOWN_DETAIL]: [...unknown] },
  });
}

function anotherChain(
  sectionIds: readonly string[]
): SectionOfAnotherChainException {
  return new SectionOfAnotherChainException(
    'A shop and a pin may only name sections of their own chain.',
    { details: { [SECTION_OTHER_CHAIN_DETAIL]: [...sectionIds] } }
  );
}

function slugTaken(holderId: string): SectionSlugTakenException {
  return new SectionSlugTakenException(
    'This chain already has a section with that slug.',
    { details: { [SECTION_SLUG_HOLDER_DETAIL]: holderId } }
  );
}

function categoryNotFound(
  unknown: readonly string[]
): CategoryNotFoundException {
  return new CategoryNotFoundException('That category does not exist.', {
    details: { [CATEGORY_UNKNOWN_DETAIL]: [...unknown] },
  });
}

function locationNotFound(): NotFoundException {
  return new NotFoundException('Supermarket location not found');
}
