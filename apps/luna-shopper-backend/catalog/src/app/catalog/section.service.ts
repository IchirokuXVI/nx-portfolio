import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  SECTION_LIMITS,
  SECTION_SLUG_MAX_LENGTH,
  type CreateShopSectionRequest,
  type ItemSectionsAtLocationEntry,
  type ItemSectionsAtLocationRequest,
  type ItemSectionsAtLocationView,
  type LocalizedText,
  type LocationSectionNamesRequest,
  type LocationSectionNamesView,
  type LocationSectionsRequest,
  type LocationSectionsView,
  type SectionRuleStep,
  type SetLocationSectionsRequest,
  type ShopMapSectionView,
  type ShopSectionIdRequest,
  type ShopSectionView,
  type UpdateShopSectionRequest,
} from '@portfolio/luna-shopper/contracts';
import type { SupportedLocale } from '@portfolio/luna-shopper/platform';
import {
  CATEGORY_UNKNOWN_DETAIL,
  CategoryNotFoundException,
  isUuid,
  NotFoundException,
  SECTION_OTHER_SHOP_DETAIL,
  SECTION_SLUG_HOLDER_DETAIL,
  SECTION_UNKNOWN_DETAIL,
  SectionNotFoundException,
  SectionOfAnotherShopException,
  SectionSlugTakenException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { QueryFailedError, Repository, type EntityManager } from 'typeorm';
import { ShopSection } from '../entities';
import { CatalogAuditService } from './catalog-audit.service';
import {
  presentSectionsOf,
  sectionNamesOf,
  type PresentSectionRow,
  type SqlRunner,
} from './location-sections';
import { PlatformAdminService } from './platform-admin.service';

/** The ascii kebab case a slug is written in, as a category's is. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';

/** One row of {@link ITEMS_AT_LOCATION_SQL}. */
interface RuleRow {
  known: number;
  itemId: string | null;
  step: SectionRuleStep | null;
  sectionIds: string[] | null;
}

/** One name of a walk, and the section of the shop it resolved to, if any. */
interface WalkName {
  name: string;
  sectionId: string | null;
}

/**
 * Which of a shop's sections every product of one read is in, in **one
 * statement** (plan 0167, section 3, as plan 0200 left it). `$1` is the shop,
 * `$2` the products (`uuid[]`).
 *
 * 1. `present`: the rows of `shop_sections` of this shop, in its order. A shop
 *    with no rows has no sections: nothing is read from its chain.
 * 2. `covered`: the present sections covering one of the product's leaves,
 *    directly or through the leaf's root. `coverage` expands a covered root to
 *    its children once, over the few present sections, so the join onto the
 *    products is an equality on `item_categories`' primary key.
 * 3. Otherwise an empty list.
 *
 * No product is pinned. A product is in a section only through a category of
 * that section.
 *
 * Every list is in the shop's order. The statement always answers at least
 * one row, the head: `known` is 0 for a shop that does not exist, and a read
 * with no products answers the head alone.
 *
 * Exported so the integration spec can `EXPLAIN` exactly this text.
 */
export const ITEMS_AT_LOCATION_SQL = `
  WITH "loc" AS (
    SELECT l."id"
      FROM "supermarket_locations" l
     WHERE l."id" = $1
  ),
  "present" AS (
    SELECT s."id" AS "sectionId", s."position" AS "rank"
      FROM "shop_sections" s
     WHERE s."supermarketLocationId" = $1
  ),
  "asked" AS (
    SELECT DISTINCT a."itemId" FROM unnest($2::uuid[]) AS a("itemId")
  ),
  "coverage" AS (
    SELECT sc."sectionId", pr."rank", sc."categoryId" AS "leafId"
      FROM "present" pr
      JOIN "shop_section_categories" sc ON sc."sectionId" = pr."sectionId"
    UNION
    SELECT sc."sectionId", pr."rank", ch."id"
      FROM "present" pr
      JOIN "shop_section_categories" sc ON sc."sectionId" = pr."sectionId"
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
    SELECT a."itemId", cv."sectionIds" AS "covered"
      FROM "asked" a
      LEFT JOIN "covered" cv ON cv."itemId" = a."itemId"
  )
  SELECT (SELECT count(*) FROM "loc")::int AS "known",
         an."itemId"::text AS "itemId",
         CASE
           WHEN an."covered" IS NOT NULL THEN 'COVERED'
           ELSE 'NONE'
         END AS "step",
         COALESCE(an."covered", '{}'::text[]) AS "sectionIds"
    FROM (SELECT 1) "head"
    LEFT JOIN "answers" an ON true
`;

/**
 * The sections of a shop (plan 0167, as plan 0200 left it).
 *
 * | Write | Means |
 * | ----- | ----- |
 * | a section with categories | this shop has an aisle called X, and it holds these kinds of product |
 * | the order of a shop | this shop is walked through its aisles in this order |
 *
 * **One shop per section.** A chain has no sections, and a shop with none of
 * its own has none: nothing is inherited, and nothing is copied from another
 * shop. A product has no pin. The order of a shop names only its own sections,
 * and this service refuses the rest with `section_of_another_shop`.
 *
 * **The order is dense and has one writer at a time.** Every write that
 * changes it locks the row of its shop first, and then writes every position
 * of the shop in one statement ({@link writeOrder}). The constraint on
 * `(shop, position)` is deferrable, so that statement is checked when it ends
 * and two sections can swap places.
 *
 * **The read is one statement**, {@link ITEMS_AT_LOCATION_SQL}, whatever the
 * number of products, because the basket read at a shop asks it once per read.
 *
 * Writes go through the platform admin gate and run inside the audit
 * transaction. The section row is audited like any catalog row. Its categories
 * are keyed on their pair and have no `id`, so, as with a product's
 * categories, they are written inside the same transaction and not recorded
 * row by row. The same holds for the places of the other sections that a
 * write moves. Reads are open: a shop's aisle list is not private.
 */
@Injectable()
export class SectionService {
  constructor(
    @InjectRepository(ShopSection)
    private readonly sections: Repository<ShopSection>,
    private readonly admin: PlatformAdminService,
    private readonly audit: CatalogAuditService
  ) {}

  /** A new section of a shop, after its last one. */
  async create(req: CreateShopSectionRequest): Promise<ShopSectionView> {
    const actor = await this.admin.requireAdmin(req);
    const slug = validateSlug(req.slug);
    validateName(req.name);
    const shopId = await this.requireShop(req.supermarketLocationId);
    const categoryIds = await this.requireCategories(req.categoryIds);
    const holder = await this.sections.findOne({
      where: { supermarketLocationId: shopId, slug },
    });
    if (holder) {
      throw slugTaken(holder.id);
    }
    let saved: ShopSection;
    try {
      saved = await this.audit.write(actor, async (tx) => {
        await lockShop(tx.manager, shopId);
        const row = await tx.create(
          ShopSection,
          this.sections.create({
            supermarketLocationId: shopId,
            slug,
            name: req.name,
            position: await nextPosition(tx.manager, shopId),
          })
        );
        await writeCoverage(tx.manager, row.id, categoryIds);
        return row;
      });
    } catch (error) {
      throw await this.asViolation(error, shopId, slug);
    }
    return (await this.views([saved]))[0];
  }

  async get(req: ShopSectionIdRequest): Promise<ShopSectionView> {
    const row = await this.load(req.sectionId);
    return (await this.views([row]))[0];
  }

  /**
   * Rename or move a section, or replace the categories it covers. The slug
   * is an identity and not a field of the request.
   *
   * `position` is a move: the section takes that place in its shop, and the
   * sections between its old place and its new one move by one. A place past
   * the last one is the last one.
   */
  async update(req: UpdateShopSectionRequest): Promise<ShopSectionView> {
    const actor = await this.admin.requireAdmin(req);
    const loaded = await this.load(req.sectionId);
    if (req.name !== undefined) {
      validateName(req.name);
    }
    const categoryIds =
      req.categoryIds === undefined
        ? undefined
        : await this.requireCategories(req.categoryIds);
    const shopId = loaded.supermarketLocationId;
    let saved: ShopSection;
    try {
      saved = await this.audit.write(actor, async (tx) => {
        await lockShop(tx.manager, shopId);
        // Read again under the lock: another write may have moved it.
        const row = await tx.manager.findOne(ShopSection, {
          where: { id: loaded.id },
        });
        if (!row) {
          throw sectionNotFound([req.sectionId]);
        }
        const before = { ...row };
        if (req.name !== undefined) {
          row.name = req.name;
        }
        if (req.position !== undefined) {
          const order = (await heldIds(tx.manager, shopId)).filter(
            (id) => id !== lower(row.id)
          );
          const place = Math.min(req.position, order.length);
          order.splice(place, 0, row.id);
          await writeOrder(tx.manager, shopId, order);
          row.position = place;
        }
        const updated = await tx.update(ShopSection, before, row);
        if (categoryIds !== undefined) {
          await writeCoverage(tx.manager, row.id, categoryIds);
        }
        return updated;
      });
    } catch (error) {
      throw await this.asViolation(error, shopId, loaded.slug);
    }
    return (await this.views([saved]))[0];
  }

  /**
   * Delete a section. Its categories go with it, and the sections after it
   * move up by one, in the same transaction.
   */
  async delete(req: ShopSectionIdRequest): Promise<{ id: string }> {
    const actor = await this.admin.requireAdmin(req);
    const row = await this.load(req.sectionId);
    const shopId = row.supermarketLocationId;
    await this.audit.write(actor, async (tx) => {
      await lockShop(tx.manager, shopId);
      await tx.delete(ShopSection, row);
      await writeOrder(tx.manager, shopId, await heldIds(tx.manager, shopId));
    });
    return { id: row.id };
  }

  /** The sections of a shop, in its order. None when it has none of its own. */
  async forLocation(
    req: LocationSectionsRequest
  ): Promise<LocationSectionsView> {
    const shopId = await this.requireShop(req.supermarketLocationId);
    const present = await presentSectionsOf(this.sections, [shopId]);
    const rows = present.get(shopId) ?? [];
    const categories = await this.coverageOf(rows.map((row) => row.id));
    return {
      sections: rows.map((row) =>
        toSectionView(row, categories.get(row.id) ?? [])
      ),
    };
  }

  /**
   * Several shops' section names, keyed by shop, in one statement (plan
   * 0170): the ids and names {@link forLocation} would answer for each. A
   * shop that does not exist is absent, and one with no sections maps to an
   * empty list.
   */
  async namesForLocations(
    req: LocationSectionNamesRequest
  ): Promise<LocationSectionNamesView> {
    const asked = [...new Set(req.supermarketLocationIds)];
    if (asked.length > SECTION_LIMITS.maxLocationsPerNamesRead) {
      throw new ValidationException(
        `supermarketLocationIds must name at most ${SECTION_LIMITS.maxLocationsPerNamesRead} shops`,
        { messageArgs: { field: 'supermarketLocationIds' } }
      );
    }
    const names = await sectionNamesOf(this.sections, asked);
    return { locations: Object.fromEntries(names) };
  }

  /**
   * Set the order of a shop's own sections.
   *
   * The sections named come first, in the order given. A section of the shop
   * that the list does not name is kept, after the named ones, in the order it
   * had: this write creates and deletes nothing, so an empty list changes
   * nothing. An id that names no section is refused with `section_not_found`,
   * and a section of another shop with `section_of_another_shop`.
   */
  async setForLocation(
    req: SetLocationSectionsRequest
  ): Promise<LocationSectionsView> {
    const actor = await this.admin.requireAdmin(req);
    const shopId = await this.requireShop(req.supermarketLocationId);
    const ids = requireDistinct(req.sectionIds).map(lower);
    await this.requireOwnSections(ids, shopId);
    await this.audit.write(actor, async (tx) => {
      await lockShop(tx.manager, shopId);
      const held = await heldIds(tx.manager, shopId);
      await writeOrder(tx.manager, shopId, namedFirst(ids, held));
    });
    return this.forLocation({ supermarketLocationId: shopId });
  }

  /**
   * Which of a shop's sections several products are in, in one statement.
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
   * The sections of a shop follow its shown walk (backend plan 0168, section
   * 4, as plan 0200 left it).
   *
   * Each of `names`, in walk order, resolves to the section **of this shop**
   * whose localized name matches it after trimming and case folding, in any
   * locale. A name with no match creates a section of this shop named in
   * `locale`, with a slug from the name, covering no category. The order of
   * the shop is then written: the resolved sections in walk order, a section
   * two names resolve to keeping its first place.
   *
   * **A walk deletes no section.** A section the walk does not name is kept,
   * with its categories, after the named ones and in the order it had. A walk
   * that names nothing leaves the shop as it was.
   *
   * Runs inside the caller's transaction (the walk write), and **outside the
   * admin gate and the audit trail**: the caller is an account holding
   * `shopMap.record`, which the gateway checked, and the audit trail records
   * operators and services only. It locks the row of the shop, and not the row
   * of its chain: two shops of one chain no longer share any section, so their
   * walks have nothing to wait on each other for.
   */
  async followWalk(
    manager: EntityManager,
    supermarketLocationId: string,
    names: readonly string[],
    locale: SupportedLocale
  ): Promise<ShopMapSectionView[]> {
    const shopId = await requireShopIn(manager, supermarketLocationId);
    await lockShop(manager, shopId);
    const held = await namedSections(manager, shopId);
    const resolved = matchWalkNames(held, names);
    await createWalkSections(manager, shopId, resolved, locale);
    const sections = resolved.filter(
      (entry): entry is ShopMapSectionView => entry.sectionId !== null
    );
    // Read again: the order holds the sections this walk just created too.
    await writeOrder(
      manager,
      shopId,
      namedFirst(
        sections.map((entry) => entry.sectionId),
        await heldIds(manager, shopId)
      )
    );
    return sections;
  }

  /**
   * The sections of the shop a walk's section names resolve to, by the match
   * {@link followWalk} uses, creating nothing. A name the shop has no section
   * for is left out. What the public map read answers beside the map.
   */
  async resolveWalkNames(
    supermarketLocationId: string,
    names: readonly string[]
  ): Promise<ShopMapSectionView[]> {
    const shopId = await this.requireShop(supermarketLocationId);
    const held = await namedSections(this.sections, shopId);
    return matchWalkNames(held, names).filter(
      (entry): entry is ShopMapSectionView => entry.sectionId !== null
    );
  }

  /** Each section with the categories it covers. */
  private async views(
    rows: readonly ShopSection[]
  ): Promise<ShopSectionView[]> {
    const categories = await this.coverageOf(rows.map((row) => row.id));
    return rows.map((row) => toSectionView(row, categories.get(row.id) ?? []));
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
         FROM "shop_section_categories" sc
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
   * The sections the order of a shop names, all of them of `shopId`: refused
   * with `section_not_found` naming the ids that match nothing, then with
   * `section_of_another_shop` naming the ones of another shop.
   */
  private async requireOwnSections(
    ids: readonly string[],
    shopId: string
  ): Promise<void> {
    if (ids.length === 0) {
      return;
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
      (id) =>
        lower(known.get(lower(id))?.supermarketLocationId ?? '') !== shopId
    );
    if (foreign.length > 0) {
      throw anotherShop(foreign);
    }
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

  /** The id of a shop as the database spells it, or the ordinary 404. */
  private requireShop(id: string): Promise<string> {
    return requireShopIn(this.sections, id);
  }

  private async load(id: string): Promise<ShopSection> {
    const row = isUuid(id)
      ? await this.sections.findOne({ where: { id } })
      : null;
    if (!row) {
      throw sectionNotFound([id]);
    }
    return row;
  }

  /**
   * The database's refusal of a section write, as the rule it enforces.
   *
   * The service checks every rule first, so reaching one of these means a
   * concurrent write got between the check and the statement: another create
   * took the slug, or a shop, a section or a category was deleted.
   */
  private async asViolation(
    error: unknown,
    shopId: string,
    slug: string
  ): Promise<unknown> {
    const driver = driverErrorOf(error);
    if (!driver) {
      return error;
    }
    const { code, constraint } = driver;
    if (
      code === PG_UNIQUE_VIOLATION &&
      constraint === 'uq_shop_sections_slug'
    ) {
      const holder = await this.sections.findOne({
        where: { supermarketLocationId: shopId, slug },
      });
      return slugTaken(holder?.id ?? '');
    }
    if (code === PG_FOREIGN_KEY_VIOLATION) {
      if (constraint === 'fk_shop_section_categories_category') {
        return categoryNotFound([]);
      }
      if (constraint === 'fk_shop_section_categories_section') {
        return sectionNotFound([]);
      }
      if (constraint === 'fk_shop_sections_location') {
        return locationNotFound();
      }
    }
    return error;
  }
}

/**
 * One writer of a shop's sections at a time: the lock every write that
 * changes the order takes first, on the row of the shop.
 *
 * `FOR NO KEY UPDATE`, so it does not wait on the foreign key checks of rows
 * that name the shop. A caller that also locks a walk of the shop takes this
 * lock **before** the walk's (`ShopWalkService`), so the two orders cannot
 * cross.
 */
async function lockShop(manager: EntityManager, shopId: string): Promise<void> {
  await manager.query(
    `SELECT 1 FROM "supermarket_locations" WHERE "id" = $1 FOR NO KEY UPDATE`,
    [shopId]
  );
}

/** The id of a shop as the database spells it, or the ordinary 404. */
async function requireShopIn(runner: SqlRunner, id: string): Promise<string> {
  const rows = isUuid(id)
    ? ((await runner.query(
        `SELECT l."id"::text AS "id" FROM "supermarket_locations" l WHERE l."id" = $1`,
        [id]
      )) as { id: string }[])
    : [];
  if (rows.length === 0) {
    throw locationNotFound();
  }
  return rows[0].id;
}

/** The ids of a shop's sections, in its order. */
async function heldIds(
  manager: EntityManager,
  shopId: string
): Promise<string[]> {
  const rows = (await manager.query(
    `SELECT s."id"::text AS "id"
       FROM "shop_sections" s
      WHERE s."supermarketLocationId" = $1
      ORDER BY s."position", s."id"`,
    [shopId]
  )) as { id: string }[];
  return rows.map((row) => row.id);
}

/** A shop's sections with their names, in its order: what a walk matches. */
async function namedSections(
  runner: SqlRunner,
  shopId: string
): Promise<{ id: string; slug: string; name: LocalizedText }[]> {
  return (await runner.query(
    `SELECT s."id"::text AS "id", s."slug" AS "slug", s."name" AS "name"
       FROM "shop_sections" s
      WHERE s."supermarketLocationId" = $1
      ORDER BY s."position", s."id"`,
    [shopId]
  )) as { id: string; slug: string; name: LocalizedText }[];
}

/** After the shop's last section, or 0 for the first. */
async function nextPosition(
  manager: EntityManager,
  shopId: string
): Promise<number> {
  const [{ next }] = (await manager.query(
    `SELECT coalesce(max(s."position") + 1, 0)::int AS "next"
       FROM "shop_sections" s
      WHERE s."supermarketLocationId" = $1`,
    [shopId]
  )) as { next: number }[];
  return Number(next);
}

/**
 * Write the order of a shop: `ids` are **all** of its sections, and each takes
 * the place it has in the list, from 0.
 *
 * One statement, so the deferrable constraint on `(shop, position)` checks it
 * when it ends: two sections can swap, and a gap closes, without a collision
 * halfway. A row already in its place is not written. Runs under
 * {@link lockShop}.
 */
async function writeOrder(
  manager: EntityManager,
  shopId: string,
  ids: readonly string[]
): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  await manager.query(
    `UPDATE "shop_sections" s
        SET "position" = v."place" - 1, "updatedAt" = now()
       FROM unnest($2::uuid[]) WITH ORDINALITY AS v("id", "place")
      WHERE s."id" = v."id"
        AND s."supermarketLocationId" = $1
        AND s."position" <> v."place" - 1`,
    [shopId, [...ids]]
  );
}

/**
 * The order a write gives a shop: the sections it names first, each at its
 * first mention, then the ones it does not name, in the order they had. An id
 * the shop no longer holds is left out, so the answer is always every section
 * of the shop, one time each.
 */
export function namedFirst(
  named: readonly string[],
  held: readonly string[]
): string[] {
  const holds = new Set(held.map(lower));
  const first = [...new Set(named.map(lower))].filter((id) => holds.has(id));
  const taken = new Set(first);
  return [...first, ...held.map(lower).filter((id) => !taken.has(id))];
}

/** Each name of a walk with the section of the shop it matches, or null. */
function matchWalkNames(
  held: readonly { id: string; name: LocalizedText }[],
  names: readonly string[]
): WalkName[] {
  const byKey = new Map<string, string>();
  for (const row of held) {
    for (const value of Object.values(row.name ?? {})) {
      if (typeof value === 'string' && value.trim() !== '') {
        const key = walkNameKey(value);
        if (!byKey.has(key)) {
          byKey.set(key, row.id);
        }
      }
    }
  }
  return names.map((name) => ({
    name: name.trim(),
    sectionId: byKey.get(walkNameKey(name)) ?? null,
  }));
}

/**
 * One section of the shop per distinct unmatched name, after the shop's last
 * one, and each entry pointed at it. Mutates `resolved`. Runs under
 * {@link lockShop}, so a second save of the same walk finds what this one
 * created.
 */
async function createWalkSections(
  manager: EntityManager,
  shopId: string,
  resolved: WalkName[],
  locale: SupportedLocale
): Promise<void> {
  if (resolved.every((entry) => entry.sectionId !== null)) {
    return;
  }
  const taken = new Set(
    (await namedSections(manager, shopId)).map((row) => row.slug)
  );
  let position = await nextPosition(manager, shopId);
  const created = new Map<string, string>();
  for (const entry of resolved) {
    if (entry.sectionId !== null) {
      continue;
    }
    const key = walkNameKey(entry.name);
    const known = created.get(key);
    if (known) {
      entry.sectionId = known;
      continue;
    }
    const slug = uniqueSlug(slugFromName(entry.name), taken);
    taken.add(slug);
    const [row] = (await manager.query(
      `INSERT INTO "shop_sections" ("supermarketLocationId", "slug", "name", "position")
       VALUES ($1, $2, $3::jsonb, $4)
       RETURNING "id"::text AS "id"`,
      [shopId, slug, JSON.stringify({ [locale]: entry.name }), position]
    )) as { id: string }[];
    position += 1;
    created.set(key, row.id);
    entry.sectionId = row.id;
  }
}

/** Replace a section's categories, inside the caller's transaction. */
async function writeCoverage(
  manager: EntityManager,
  sectionId: string,
  categoryIds: readonly string[]
): Promise<void> {
  await manager.query(
    `DELETE FROM "shop_section_categories" WHERE "sectionId" = $1`,
    [sectionId]
  );
  if (categoryIds.length > 0) {
    await manager.query(
      `INSERT INTO "shop_section_categories" ("sectionId", "categoryId")
       SELECT $1, v."categoryId" FROM unnest($2::uuid[]) AS v("categoryId")`,
      [sectionId, [...categoryIds]]
    );
  }
}

export function toSectionView(
  row: Pick<
    PresentSectionRow,
    'id' | 'supermarketLocationId' | 'slug' | 'name' | 'position'
  >,
  categoryIds: string[]
): ShopSectionView {
  return {
    id: row.id,
    supermarketLocationId: row.supermarketLocationId,
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

/**
 * How a walk's section name compares with the name of a section of the shop
 * (plan 0168, section 4): trimmed and case folded, as `walkOrderV2` groups
 * them.
 */
export function walkNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * A slug from a section name: ascii kebab case, accents dropped, at most
 * {@link SECTION_SLUG_MAX_LENGTH}. A name with no letter or digit in it gives
 * `section`.
 */
export function slugFromName(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SECTION_SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
  return slug === '' ? 'section' : slug;
}

/** `slug`, or `slug-2`, `slug-3` and so on, whichever the shop does not hold. */
export function uniqueSlug(slug: string, taken: ReadonlySet<string>): string {
  if (!taken.has(slug)) {
    return slug;
  }
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const head = slug
      .slice(0, SECTION_SLUG_MAX_LENGTH - suffix.length)
      .replace(/-+$/g, '');
    const candidate = `${head}${suffix}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
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

function anotherShop(
  sectionIds: readonly string[]
): SectionOfAnotherShopException {
  return new SectionOfAnotherShopException(
    'The order of a shop may only name its own sections.',
    { details: { [SECTION_OTHER_SHOP_DETAIL]: [...sectionIds] } }
  );
}

function slugTaken(holderId: string): SectionSlugTakenException {
  return new SectionSlugTakenException(
    'This shop already has a section with that slug.',
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
