import type { EntityManager } from 'typeorm';
import type { Category } from '../entities';
import {
  checkLeaves,
  toCategoryOnItem,
  type CategoryOnItem,
  type CategoryService,
} from './category.service';

/** The root every fake leaf sits under. */
export const FAKE_ROOT_ID = 'root-1';

/** What {@link fakeCategories} hands back: the double, and what it wrote. */
export interface FakeCategories {
  service: CategoryService;
  /** Every `setItemCategories` call, in order: the product and its leaf ids. */
  written: { itemId: string; categoryIds: string[] }[];
}

/**
 * A {@link CategoryService} for the item service specs, which build their
 * subject by hand with fake repositories (plan 0166).
 *
 * Every id is a leaf under {@link FAKE_ROOT_ID}, except the ones named in
 * `roots`, which are roots, and the ones named in `unknown`, which do not
 * exist. The check itself is the real one, so a spec that names a root or an
 * unknown id is refused exactly as the service would refuse it. What is
 * genuinely held by the database, the triggers and the foreign keys, is proven
 * in `category.integration.spec.ts` against real Postgres.
 *
 * A read answers what the spec wrote through this double, or `held` for a
 * product the spec did not write, or one fake leaf for any other product, so a
 * read of a fixture row still answers a product with a category.
 */
export function fakeCategories(
  options: {
    roots?: readonly string[];
    unknown?: readonly string[];
    held?: ReadonlyMap<string, CategoryOnItem[]>;
  } = {}
): FakeCategories {
  const roots = new Set(options.roots ?? []);
  const unknown = new Set(options.unknown ?? []);
  const written: FakeCategories['written'] = [];
  const current = new Map<string, CategoryOnItem[]>();

  const rowOf = (id: string): Category =>
    ({
      id,
      parentId: roots.has(id) ? null : FAKE_ROOT_ID,
      slug: id,
      name: { en: id },
      position: 0,
    }) as Category;
  const known = (lists: readonly (readonly string[])[]) =>
    new Map(
      lists
        .flat()
        .filter((id) => !unknown.has(id))
        .map((id) => [id, rowOf(id)])
    );

  const service = {
    requireLeaves: async (ids: readonly string[]) =>
      checkLeaves(ids, known([ids])),
    leaveChecker: async (lists: readonly (readonly string[])[]) => {
      const rows = known(lists);
      return (ids: readonly string[]) => checkLeaves(ids, rows);
    },
    setItemCategories: async (
      _manager: EntityManager,
      itemId: string,
      leaves: readonly Category[]
    ) => {
      written.push({ itemId, categoryIds: leaves.map((leaf) => leaf.id) });
      current.set(itemId, leaves.map(toCategoryOnItem));
    },
    categoriesOf: async (itemIds: readonly string[]) =>
      new Map(
        itemIds.map((id) => [
          id,
          current.get(id) ??
            options.held?.get(id) ?? [toCategoryOnItem(rowOf('leaf-1'))],
        ])
      ),
  } as unknown as CategoryService;

  return { service, written };
}
