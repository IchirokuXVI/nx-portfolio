import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  CATEGORY_SLUG_MAX_LENGTH,
  type CategoryIdRequest,
  type CategoryPage,
  type CategoryTreeRequest,
  type CategoryTreeView,
  type CategoryView,
  type CreateCategoryRequest,
  type ItemView,
  type ListCategoriesRequest,
  type UpdateCategoryRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  CATEGORY_DETAIL,
  CATEGORY_UNKNOWN_DETAIL,
  CategoryInUseException,
  CategoryNotALeafException,
  CategoryNotFoundException,
  CategoryTooDeepException,
  clampPageSize,
  ConflictException,
  decodeCursor,
  encodeCursor,
  isUuid,
  ItemNeedsACategoryException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import {
  QueryFailedError,
  Repository,
  type EntityManager,
  type SelectQueryBuilder,
} from 'typeorm';
import { categoryId } from '../db/taxonomy/ids';
import { Category } from '../entities';
import { CatalogAuditService } from './catalog-audit.service';
import { PlatformAdminService } from './platform-admin.service';

/** A category as a product carries it: `ItemView.categories`, one entry. */
export type CategoryOnItem = ItemView['categories'][number];

/** The ascii kebab case a slug is written in (plan 0166, section 5). */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';
const PG_CHECK_VIOLATION = '23514';

interface CategoryListCursor extends Record<string, unknown> {
  offset: number;
}

/**
 * The category tree (plan 0166, sections 1 to 4): at most two levels, a root
 * and its children, and a product only ever on a child.
 *
 * ## The four rules, each with a readable code
 *
 * | Rule | Refuses | Code |
 * | ---- | ------- | ---- |
 * | R1 | a parent that is itself a child, or a parent given to a root that has children | `category_too_deep` |
 * | R2 | a product on a root, or a child holding products made a root | `category_not_a_leaf` |
 * | R3 | a product with no category | `item_needs_a_category` |
 * | R4 | deleting a category that has children or products, or that a shop section covers (plan 0167) | `category_in_use` |
 *
 * R1, R2 and R4 are held by the database too (the triggers and the two
 * `ON DELETE RESTRICT` keys of the migration), because the seed, the migration
 * and any later writer reach these tables without passing through here. This
 * service checks first so the refusal names the rule, and it translates the
 * database's refusal into the same exception when a concurrent write got there
 * between the check and the statement. R3 is this service's alone.
 *
 * ## The products on a category are the item service's to write
 *
 * A product's categories are a field of the product, so `ItemService` writes
 * them, through {@link requireLeaves} before its transaction and
 * {@link setItemCategories} inside it. Nothing here edits a product.
 *
 * Reads are open, like every catalog read: the gateway sends the user's id and
 * the harvester sends its own actor id to {@link tree}, and neither is asked
 * who it is. Writes go through the platform admin gate.
 */
@Injectable()
export class CategoryService {
  constructor(
    @InjectRepository(Category)
    private readonly categories: Repository<Category>,
    private readonly admin: PlatformAdminService,
    private readonly audit: CatalogAuditService
  ) {}

  /**
   * The whole tree, roots then children, each by position, with a product
   * count on every row. Unpaged: two levels of a supermarket's aisles is a
   * hundred rows, and both callers want all of them.
   */
  async tree(req: CategoryTreeRequest): Promise<CategoryTreeView> {
    void req;
    const rows = await orderAsTree(
      this.categories.createQueryBuilder('c')
    ).getMany();
    const counts = await this.itemCounts();
    return {
      categories: rows.map((row) => toCategoryView(row, counts)),
    };
  }

  /**
   * The place of each category in the tree, for the listing ordered by
   * category (plan 0196, section 1): the ids in the order of
   * {@link orderAsTree}, and the rank of each beside it.
   *
   * Two arrays of one length and not a map, because that is how the listing
   * hands them to its statement. A product sits on leaves alone (R2), and
   * the leaves come grouped under their root in the order of the roots, so
   * the rank of a leaf sorts by the position of its root and then by its
   * own. One read of a hundred rows for the request.
   */
  async treeRanks(): Promise<{ ids: string[]; ranks: number[] }> {
    const rows = await orderAsTree(this.categories.createQueryBuilder('c'))
      .select('c.id')
      .getMany();
    return {
      ids: rows.map((row) => row.id),
      ranks: rows.map((_, index) => index),
    };
  }

  /**
   * The back office's list: the tree's rows in the tree's order, filtered and
   * paged. Every filter narrows, so two that contradict each other answer an
   * empty page rather than one of them winning.
   *
   * Offset paged, because the order is over a join and the whole table is a
   * hundred rows: a keyset over four keys buys nothing here.
   */
  async list(req: ListCategoriesRequest): Promise<CategoryPage> {
    const limit = clampPageSize(req.limit);
    const offset = Math.max(
      0,
      Number(decodeCursor<CategoryListCursor>(req.cursor)?.offset ?? 0) || 0
    );
    if (req.parentId !== undefined && !isUuid(req.parentId)) {
      // A malformed id names no category, and casting it would fail the query.
      return { items: [], nextCursor: null };
    }

    // `offset` and `limit` rather than `skip` and `take`: the join is one
    // parent per row, so the plain clauses are exact, and `take` over a join
    // wraps the query in a distinct subquery the tree's ordering cannot pass.
    const qb = orderAsTree(this.categories.createQueryBuilder('c'))
      .offset(offset)
      .limit(limit + 1);
    if (req.parentId !== undefined) {
      qb.andWhere('c."parentId" = :parentId', { parentId: req.parentId });
    }
    if (req.withoutParent) {
      qb.andWhere('c."parentId" IS NULL');
    }
    if (req.kind === 'root') {
      qb.andWhere('c."parentId" IS NULL');
    } else if (req.kind === 'leaf') {
      qb.andWhere('c."parentId" IS NOT NULL');
    }
    const text = req.query?.trim();
    if (text) {
      // Both content languages and the slug, through the same normalization
      // the product search uses, so `lacteos` finds `Lácteos`.
      qb.andWhere(
        `(
          "catalog_norm"(coalesce(c."name" ->> 'es', '')) LIKE '%' || "catalog_norm"(:text) || '%'
          OR "catalog_norm"(coalesce(c."name" ->> 'en', '')) LIKE '%' || "catalog_norm"(:text) || '%'
          OR c."slug" LIKE '%' || lower(:text) || '%'
        )`,
        { text }
      );
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const counts = await this.itemCounts();
    return {
      items: page.map((row) => toCategoryView(row, counts)),
      nextCursor: hasMore ? encodeCursor({ offset: offset + limit }) : null,
    };
  }

  async get(req: CategoryIdRequest): Promise<CategoryView> {
    const row = await this.load(req.categoryId);
    return toCategoryView(row, await this.itemCounts());
  }

  /**
   * A new root, or a new child of a root.
   *
   * The id is derived from the slug, exactly as a seeded row's is, so a slug
   * the taxonomy file later names lands on this row rather than beside it.
   * An absent position appends after the last sibling.
   */
  async create(req: CreateCategoryRequest): Promise<CategoryView> {
    const actor = await this.admin.requireAdmin(req);
    const slug = validateSlug(req.slug);
    validateName(req.name);
    const parentId = req.parentId ?? null;
    if (parentId !== null) {
      const parent = await this.load(parentId);
      if (parent.parentId !== null) {
        throw tooDeep(parent.id);
      }
    }
    const draft = this.categories.create({
      id: categoryId(slug),
      parentId,
      slug,
      name: req.name,
      position: req.position ?? (await this.nextPosition(parentId)),
    });
    let saved: Category;
    try {
      saved = await this.audit.write(actor, async (tx) => {
        // `save` with an id it has not seen would read before it writes; an
        // existing slug has to fail on the unique index, not update a row.
        await tx.manager.insert(Category, draft);
        await tx.recordCreate(Category, draft);
        return draft;
      });
    } catch (error) {
      throw asTreeViolation(error);
    }
    return toCategoryView(saved, new Map());
  }

  /**
   * Rename, reorder or move a category. The slug is an identity and is not a
   * field of the request.
   *
   * A move keeps the tree two levels deep (R1) and never leaves products on a
   * root (R2), and a move with no position appends after the new siblings.
   */
  async update(req: UpdateCategoryRequest): Promise<CategoryView> {
    const actor = await this.admin.requireAdmin(req);
    const row = await this.load(req.categoryId);
    const before = { ...row };
    if (req.name !== undefined) {
      validateName(req.name);
      row.name = req.name;
    }
    if (req.parentId !== undefined && req.parentId !== row.parentId) {
      await this.checkMove(row, req.parentId);
      row.parentId = req.parentId;
      if (req.position === undefined) {
        row.position = await this.nextPosition(req.parentId);
      }
    }
    if (req.position !== undefined) {
      row.position = req.position;
    }
    let saved: Category;
    try {
      saved = await this.audit.write(actor, (tx) =>
        tx.update(Category, before, row)
      );
    } catch (error) {
      throw asTreeViolation(error);
    }
    const counts = await this.itemCounts();
    return toCategoryView(saved, counts);
  }

  /**
   * Refused while the category has children or products, or while a shop
   * section covers it (R4, and plan 0167, section 2).
   */
  async delete(req: CategoryIdRequest): Promise<{ id: string }> {
    const actor = await this.admin.requireAdmin(req);
    const row = await this.load(req.categoryId);
    const [{ held }] = (await this.categories.query(
      `SELECT (
         EXISTS (SELECT 1 FROM "categories" c WHERE c."parentId" = $1)
         OR EXISTS (SELECT 1 FROM "item_categories" ic WHERE ic."categoryId" = $1)
         OR EXISTS (SELECT 1 FROM "section_categories" sc WHERE sc."categoryId" = $1)
       ) AS "held"`,
      [row.id]
    )) as { held: boolean }[];
    if (held) {
      throw new CategoryInUseException(
        'This category still holds categories or products, or a shop section covers it.'
      );
    }
    try {
      await this.audit.write(actor, (tx) => tx.delete(Category, row));
    } catch (error) {
      throw asTreeViolation(error);
    }
    return { id: row.id };
  }

  /**
   * The leaves a product write names, checked, deduplicated and in the order
   * the caller meant (rules R2 and R3, and an unknown id).
   *
   * Read before the write's transaction opens, which is where the audit
   * service says validating reads belong. A leaf deleted or moved between here
   * and the insert is refused by the database instead.
   */
  async requireLeaves(ids: readonly string[]): Promise<Category[]> {
    const known = await this.leavesById([ids]);
    return checkLeaves(ids, known);
  }

  /**
   * Every leaf of several product writes, in **one** query, and a checker for
   * each list against it. What a batch of a thousand products uses, so the
   * check is not a thousand round trips for a tree of a hundred rows.
   */
  async leaveChecker(
    lists: readonly (readonly string[])[]
  ): Promise<(ids: readonly string[]) => Category[]> {
    const known = await this.leavesById(lists);
    return (ids) => checkLeaves(ids, known);
  }

  /**
   * Replace a product's whole set of categories, inside the caller's
   * transaction (plan 0166, section 2). The order given is the order kept:
   * position 0 is the first.
   *
   * Delete and insert rather than a diff, because the set is small and a
   * position is unique per product: renumbering in place would collide with
   * itself halfway through.
   */
  async setItemCategories(
    manager: EntityManager,
    itemId: string,
    leaves: readonly Category[]
  ): Promise<void> {
    if (leaves.length === 0) {
      throw new ItemNeedsACategoryException(
        'A product needs at least one category.'
      );
    }
    try {
      await manager.query(`DELETE FROM "item_categories" WHERE "itemId" = $1`, [
        itemId,
      ]);
      await manager.query(
        `INSERT INTO "item_categories" ("itemId", "categoryId", "position")
         SELECT $1, v."categoryId", v."position" - 1
           FROM unnest($2::uuid[]) WITH ORDINALITY AS v("categoryId", "position")`,
        [itemId, leaves.map((leaf) => leaf.id)]
      );
    } catch (error) {
      throw asTreeViolation(error);
    }
  }

  /**
   * The categories each of these products sits on, in position order, in one
   * query. Read through the caller's manager when it passes one, so a write
   * reads its own rows back inside its transaction.
   */
  async categoriesOf(
    itemIds: readonly string[],
    manager?: EntityManager
  ): Promise<Map<string, CategoryOnItem[]>> {
    const byItem = new Map<string, CategoryOnItem[]>();
    if (itemIds.length === 0) {
      return byItem;
    }
    const rows = (await (manager ?? this.categories.manager).query(
      `SELECT ic."itemId", c."id", c."parentId", c."slug", c."name"
         FROM "item_categories" ic
         JOIN "categories" c ON c."id" = ic."categoryId"
        WHERE ic."itemId" = ANY($1::uuid[])
        ORDER BY ic."itemId", ic."position"`,
      [[...new Set(itemIds)]]
    )) as (Category & { itemId: string })[];
    for (const row of rows) {
      const entry = toCategoryOnItem(row);
      const list = byItem.get(row.itemId);
      if (list) {
        list.push(entry);
      } else {
        byItem.set(row.itemId, [entry]);
      }
    }
    return byItem;
  }

  /**
   * How many distinct products sit under each row (section 4): a leaf counts
   * its own, a root the distinct products under any of its children, which is
   * not the sum of the leaves when a product sits on two of them. One grouped
   * query over the category index for each half.
   */
  private async itemCounts(): Promise<Map<string, number>> {
    const rows = (await this.categories.query(
      `SELECT ic."categoryId" AS "id", count(*)::int AS "count"
         FROM "item_categories" ic
        GROUP BY ic."categoryId"
       UNION ALL
       SELECT c."parentId" AS "id", count(DISTINCT ic."itemId")::int AS "count"
         FROM "item_categories" ic
         JOIN "categories" c ON c."id" = ic."categoryId"
        WHERE c."parentId" IS NOT NULL
        GROUP BY c."parentId"`
    )) as { id: string; count: number }[];
    return new Map(rows.map((row) => [row.id, Number(row.count)]));
  }

  /**
   * The rules a move has to keep (R1, and the half of R2 a move can break).
   * Each refusal names the row that breaks it.
   */
  private async checkMove(
    row: Category,
    parentId: string | null
  ): Promise<void> {
    if (parentId === null) {
      const [{ held }] = (await this.categories.query(
        `SELECT EXISTS (
           SELECT 1 FROM "item_categories" ic WHERE ic."categoryId" = $1
         ) AS "held"`,
        [row.id]
      )) as { held: boolean }[];
      if (held) {
        throw notALeaf(row.id);
      }
      return;
    }
    if (parentId === row.id) {
      throw tooDeep(row.id);
    }
    const parent = await this.load(parentId);
    if (parent.parentId !== null) {
      throw tooDeep(parent.id);
    }
    const children = await this.categories.count({
      where: { parentId: row.id },
    });
    if (children > 0) {
      throw tooDeep(row.id);
    }
  }

  /** After the last sibling, or 0 for the first. */
  private async nextPosition(parentId: string | null): Promise<number> {
    const [{ next }] = (await this.categories.query(
      `SELECT coalesce(max(c."position") + 1, 0)::int AS "next"
         FROM "categories" c
        WHERE c."parentId" IS NOT DISTINCT FROM $1::uuid`,
      [parentId]
    )) as { next: number }[];
    return Number(next);
  }

  private async load(id: string): Promise<Category> {
    const row = isUuid(id)
      ? await this.categories.findOne({ where: { id } })
      : null;
    if (!row) {
      throw notFound([id]);
    }
    return row;
  }

  /** Every distinct id the lists name, loaded in one query and keyed by id. */
  private async leavesById(
    lists: readonly (readonly string[])[]
  ): Promise<Map<string, Category>> {
    const ids = [
      ...new Set(lists.flat().filter((id) => isUuid(id))),
    ] as string[];
    if (ids.length === 0) {
      return new Map();
    }
    const rows = await this.categories
      .createQueryBuilder('c')
      .where('c."id" = ANY(:ids)', { ids })
      .getMany();
    return new Map(rows.map((row) => [row.id, row]));
  }
}

/**
 * One product write's leaves, against the rows loaded for it: deduplicated in
 * the order given, refused whole when the list is empty (R3), names an id
 * that does not exist, or names a root (R2).
 */
export function checkLeaves(
  ids: readonly string[],
  known: ReadonlyMap<string, Category>
): Category[] {
  const unique = [...new Set(ids)];
  if (unique.length === 0) {
    throw new ItemNeedsACategoryException(
      'A product needs at least one category.'
    );
  }
  const unknown = unique.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw notFound(unknown);
  }
  const leaves = unique.map((id) => known.get(id) as Category);
  const root = leaves.find((leaf) => leaf.parentId === null);
  if (root) {
    throw notALeaf(root.id);
  }
  return leaves;
}

/**
 * The tree's order: every root by position, then every child grouped under
 * its root in the roots' order, each by position. The id breaks a tie, so two
 * siblings at one position do not swap between two reads.
 */
function orderAsTree(
  qb: SelectQueryBuilder<Category>
): SelectQueryBuilder<Category> {
  return qb
    .leftJoin(Category, 'p', 'p."id" = c."parentId"')
    .orderBy('c."parentId" IS NOT NULL', 'ASC')
    .addOrderBy('p."position"', 'ASC', 'NULLS FIRST')
    .addOrderBy('p."id"', 'ASC', 'NULLS FIRST')
    .addOrderBy('c."position"', 'ASC')
    .addOrderBy('c."id"', 'ASC');
}

export function toCategoryView(
  row: Category,
  counts: ReadonlyMap<string, number>
): CategoryView {
  return {
    id: row.id,
    parentId: row.parentId,
    slug: row.slug,
    name: row.name,
    position: row.position,
    itemCount: counts.get(row.id) ?? 0,
  };
}

/** A leaf as a product carries it. Its parent is never null. */
export function toCategoryOnItem(
  row: Pick<Category, 'id' | 'parentId' | 'slug' | 'name'>
): CategoryOnItem {
  return {
    id: row.id,
    parentId: row.parentId as string,
    slug: row.slug,
    name: row.name,
  };
}

function validateSlug(slug: string): string {
  const trimmed = slug.trim();
  if (
    trimmed.length > CATEGORY_SLUG_MAX_LENGTH ||
    !SLUG_PATTERN.test(trimmed)
  ) {
    throw new ValidationException(
      'slug must be lower case ascii words separated by single dashes, ' +
        `at most ${CATEGORY_SLUG_MAX_LENGTH} characters`,
      { messageArgs: { field: 'slug' } }
    );
  }
  return trimmed;
}

function validateName(name: CreateCategoryRequest['name']): void {
  const en = name?.en?.trim();
  const es = name?.es?.trim();
  if (!en && !es) {
    throw new ValidationException('name needs at least one of en and es', {
      messageArgs: { field: 'name' },
    });
  }
}

function tooDeep(id: string): CategoryTooDeepException {
  return new CategoryTooDeepException(
    'Categories have two levels, and this write would make a third.',
    { details: { [CATEGORY_DETAIL]: id } }
  );
}

function notALeaf(id: string): CategoryNotALeafException {
  return new CategoryNotALeafException(
    'A product goes on a category inside another, never on a root.',
    { details: { [CATEGORY_DETAIL]: id } }
  );
}

function notFound(unknown: readonly string[]): CategoryNotFoundException {
  return new CategoryNotFoundException('That category does not exist.', {
    details: { [CATEGORY_UNKNOWN_DETAIL]: [...unknown] },
  });
}

/**
 * The database's refusal of a tree write, as the rule it enforces.
 *
 * The service checks every rule before it writes, so reaching one of these
 * means a concurrent write moved a row between the check and the statement.
 * The triggers name their constraint and put the offending row in the detail;
 * a foreign key refusing a delete is R4, and one refusing an insert names a
 * category that is gone.
 */
export function asTreeViolation(error: unknown): unknown {
  if (!(error instanceof QueryFailedError)) {
    return error;
  }
  const driver = (
    error as {
      driverError?: { code?: string; constraint?: string; detail?: string };
    }
  ).driverError;
  const code = driver?.code;
  const constraint = driver?.constraint;
  if (
    code === PG_CHECK_VIOLATION &&
    constraint === 'ck_categories_two_levels'
  ) {
    return tooDeep(driver?.detail ?? '');
  }
  if (code === PG_CHECK_VIOLATION && constraint === 'ck_item_categories_leaf') {
    return notALeaf(driver?.detail ?? '');
  }
  if (
    code === PG_CHECK_VIOLATION &&
    constraint === 'ck_categories_not_own_parent'
  ) {
    return tooDeep('');
  }
  // A shop section covering the category holds it too (plan 0167, section 2).
  const onCategory =
    constraint === 'fk_item_categories_category' ||
    constraint === 'fk_categories_parent' ||
    constraint === 'fk_section_categories_category';
  if (code === PG_FOREIGN_KEY_VIOLATION && onCategory) {
    // Postgres words the two directions differently: a delete of a row still
    // pointed at, or an insert naming a row that is not there.
    return /is still referenced/.test(driver?.detail ?? '')
      ? new CategoryInUseException(
          'This category still holds categories or products, or a shop section covers it.'
        )
      : notFound([]);
  }
  if (
    code === PG_UNIQUE_VIOLATION &&
    (constraint === 'uq_categories_slug' || constraint === 'pk_categories')
  ) {
    // The id is derived from the slug, so a taken slug can meet either one.
    return new ConflictException('A category already has that slug.');
  }
  return error;
}
