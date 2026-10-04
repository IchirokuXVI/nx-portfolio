import type { EntityManager } from 'typeorm';
import { Category } from '../../entities';
import { referenceCategoryRows } from './categories';
import { categoryId } from './ids';

/**
 * The category tree of plan 0173's appendix A, upserted by the id each slug
 * derives, names and positions included, and never deleted from (plan 0166,
 * section 5).
 *
 * Roots first, because a child's parent has to exist before it does. A row
 * the back office added survives, and a rename in the taxonomy file wins the
 * next time this runs. The migration `DiaCategoryTree1758500000000` already wrote
 * the whole tree under these same ids, so on a migrated database this inserts
 * nothing and only puts back a name or a position that was edited.
 *
 * Called by the demo world seeder, whose products name leaves, and by the
 * integration specs that need the whole tree.
 */
export async function seedTaxonomy(m: EntityManager): Promise<number> {
  const rows = referenceCategoryRows();
  const repository = m.getRepository(Category);
  // Roots in their own statement first, so every parent a child names exists
  // and is a root by the time the child is written.
  await repository.upsert(
    rows.filter((row) => row.parentId === null),
    ['id']
  );
  await repository.upsert(
    rows.filter((row) => row.parentId !== null),
    ['id']
  );
  return rows.length;
}

/**
 * Replace the categories of these seeded products with the leaves they name,
 * by slug (plan 0166, section 5).
 *
 * A seeded product's set is rewritten every time the demo seed runs, so a
 * category an operator gave one of these products in the back office does not
 * survive the next run. Products the seed does not own, harvested ones
 * included, are never touched.
 */
export async function writeItemCategories(
  m: EntityManager,
  entries: { itemId: string; slugs: readonly string[] }[]
): Promise<void> {
  if (entries.length === 0) return;
  await m.query(
    `DELETE FROM "item_categories" WHERE "itemId" = ANY($1::uuid[])`,
    [entries.map((entry) => entry.itemId)]
  );
  const itemIds: string[] = [];
  const categoryIds: string[] = [];
  const positions: number[] = [];
  for (const entry of entries) {
    for (const [position, slug] of entry.slugs.entries()) {
      itemIds.push(entry.itemId);
      categoryIds.push(categoryId(slug));
      positions.push(position);
    }
  }
  await m.query(
    `INSERT INTO "item_categories" ("itemId", "categoryId", "position")
     SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::smallint[])`,
    [itemIds, categoryIds, positions]
  );
}
