import { CATEGORY_SLUG_MAX_LENGTH } from '@portfolio/luna-shopper/contracts';
import { demoWorld } from '@portfolio/luna-shopper/test-fixtures';
import { DIA_CATEGORY_TREE } from '../migrations/1758500000000-DiaCategoryTree';
import {
  REFERENCE_CATEGORIES,
  REFERENCE_LEAF_SLUGS,
  UNCATEGORISED_SLUG,
  referenceCategoryRows,
} from './categories';
import { categoryId } from './ids';

describe('the category taxonomy (plan 0173, appendix A)', () => {
  const rows = referenceCategoryRows();
  const roots = rows.filter((row) => row.parentId === null);
  const leaves = rows.filter((row) => row.parentId !== null);

  /**
   * Appendix A as the migration froze it, in the shape of a taxonomy row.
   * The migration's constant was generated from the appendix, so agreeing
   * with it row for row is agreeing with the appendix.
   */
  const migrationRows = [
    ...DIA_CATEGORY_TREE.map((root, position) => ({
      id: categoryId(root.slug),
      parentId: null,
      slug: root.slug,
      name: root.name,
      position,
    })),
    ...DIA_CATEGORY_TREE.flatMap((root) =>
      root.children.map((leaf, position) => ({
        id: categoryId(leaf.slug),
        parentId: categoryId(root.slug),
        slug: leaf.slug,
        name: leaf.name,
        position,
      }))
    ),
  ];

  describe('the id a slug derives', () => {
    /**
     * Written out, and never computed here. Two migrations inserted the tree
     * under these ids and every category row in both clusters carries one, so
     * the derivation may not change: not its namespace, not its `category:`
     * prefix, not the file it lives in. These four were taken from the
     * derivation as it stood before plan 0180 moved it out of `reference`.
     */
    it.each([
      ['fruits', '143b7670-7498-522a-a45e-24f868bd95c3'],
      ['bananas-and-plantains', '7841f107-175a-5f47-9fa8-6a79828e7367'],
      ['other', '024bf597-b8f7-5a3a-8f11-34cd180df94f'],
      ['uncategorised', 'f65cf1c0-ce2d-5d22-931d-5c7cf8d047a0'],
    ])('answers the same uuid for %s as it always has', (slug, id) => {
      expect(categoryId(slug)).toBe(id);
    });

    it('gives every row of the tree a distinct id', () => {
      const ids = rows.map((row) => row.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  it('holds the twenty nine roots and two hundred and forty six leaves of appendix A', () => {
    expect(roots).toHaveLength(29);
    expect(leaves).toHaveLength(246);
    expect(rows).toHaveLength(275);
    expect(REFERENCE_LEAF_SLUGS.size).toBe(246);
  });

  it('equals appendix A: every slug, parent, position and both names', () => {
    expect(rows.map((row) => row.slug)).toEqual(
      migrationRows.map((row) => row.slug)
    );
    expect(rows).toEqual(migrationRows);
  });

  it('agrees with the rows the migration inserts, id for id', () => {
    // The migration froze the whole tree. `seedTaxonomy` upserts over it by
    // id, so a row that differed would be moved or renamed by the first demo
    // seed after the migration.
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.size).toBe(migrationRows.length);
    for (const row of migrationRows) {
      expect(byId.get(row.id)).toEqual(row);
    }
  });

  it('writes a slug in ascii kebab case, unique across the whole tree', () => {
    const slugs = rows.map((row) => row.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(slug.length).toBeLessThanOrEqual(CATEGORY_SLUG_MAX_LENGTH);
    }
  });

  it('names every row in both locales', () => {
    for (const row of rows) {
      expect(row.name.en?.trim()).toBeTruthy();
      expect(row.name.es?.trim()).toBeTruthy();
    }
  });

  it('gives every root at least one leaf', () => {
    for (const root of REFERENCE_CATEGORIES) {
      expect(`${root.slug}: ${root.children.length > 0}`).toBe(
        `${root.slug}: true`
      );
    }
  });

  it('numbers siblings from zero, in the order the file lists them', () => {
    expect(roots.map((row) => row.position)).toEqual(
      roots.map((_, index) => index)
    );
    for (const root of REFERENCE_CATEGORIES) {
      const children = leaves.filter(
        (row) => row.parentId === categoryId(root.slug)
      );
      expect(children.map((row) => row.slug)).toEqual(
        root.children.map((child) => child.slug)
      );
      expect(children.map((row) => row.position)).toEqual(
        root.children.map((_, index) => index)
      );
    }
  });

  it('keeps uncategorised under other, where the harvester files what it cannot place', () => {
    expect(UNCATEGORISED_SLUG).toBe('uncategorised');
    const row = rows.find((r) => r.slug === UNCATEGORISED_SLUG);
    expect(row?.parentId).toBe(categoryId('other'));
    expect(roots[roots.length - 1].slug).toBe('other');
  });

  it('puts every demo world product on leaves that exist', () => {
    const wrong = demoWorld.catalog.items
      .filter(
        (item) =>
          item.categories.length === 0 ||
          item.categories.some((slug) => !REFERENCE_LEAF_SLUGS.has(slug))
      )
      .map((item) => item.id);
    expect(wrong).toEqual([]);
  });
});
