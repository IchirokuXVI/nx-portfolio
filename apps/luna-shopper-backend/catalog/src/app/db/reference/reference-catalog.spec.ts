import { CATEGORY_SLUG_MAX_LENGTH } from '@portfolio/luna-shopper/contracts';
import { demoWorld } from '@portfolio/luna-shopper/test-fixtures';
import {
  LANDING_LEAVES,
  ROOTS,
} from '../migrations/1758100000000-CategoryTree';
import {
  REFERENCE_CATEGORIES,
  REFERENCE_LEAF_SLUGS,
  referenceCategoryRows,
} from './categories';
import {
  MERCADONA_SUPERMARKET_ID,
  authoredItemId,
  categoryId,
  groupId,
  itemId,
  nationalScopeId,
  priceScopeId,
  supermarketItemId,
} from './ids';
import {
  EL_JAMON_ITEMS,
  MERCADONA_ITEMS,
  REFERENCE_GROUPS,
  REFERENCE_STORES,
  SUPERCASH_ITEMS,
} from './index';
import { referenceChainRows } from './seed-reference-catalog';
import type { AuthoredItem } from './types';

const ALL_ITEMS: [string, AuthoredItem[]][] = [
  ['mercadona', MERCADONA_ITEMS],
  ['el-jamon', EL_JAMON_ITEMS],
  ['supercash', SUPERCASH_ITEMS],
];
const EVERY_ITEM = ALL_ITEMS.flatMap(([store, items]) =>
  items.map((it) => ({ store, it }))
);

describe('reference catalog', () => {
  describe('the category taxonomy (plan 0166, section 5)', () => {
    const rows = referenceCategoryRows();
    const roots = rows.filter((row) => row.parentId === null);
    const leaves = rows.filter((row) => row.parentId !== null);

    it('holds the seventeen roots and eighty four leaves of appendix A', () => {
      // The appendix's own text says eighty; its table holds eighty four, and
      // the table is what is seeded.
      expect(roots).toHaveLength(17);
      expect(leaves).toHaveLength(84);
      expect(REFERENCE_LEAF_SLUGS.size).toBe(84);
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

    it('gives every root children and a catch all among them', () => {
      for (const root of REFERENCE_CATEGORIES) {
        expect(root.children.length).toBeGreaterThan(0);
        // No children page is longer than a phone holds.
        expect(root.children.length).toBeLessThanOrEqual(8);
        const catchAll =
          root.slug === 'other'
            ? root.children.some((c) => c.slug === 'uncategorised')
            : root.children.some((c) => c.slug.startsWith('other-'));
        expect(`${root.slug}: ${catchAll}`).toBe(`${root.slug}: true`);
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

    it('agrees with the rows the migration inserted, id for id', () => {
      // The migration froze the roots and the landing leaves it needed. The seed
      // upserts over them by id, so the slugs and positions must match, or the
      // first boot after the migration would move them.
      expect(ROOTS.map((root) => root.slug)).toEqual(
        REFERENCE_CATEGORIES.map((root) => root.slug)
      );
      const byId = new Map(rows.map((row) => [row.id, row]));
      for (const leaf of LANDING_LEAVES) {
        const row = byId.get(categoryId(leaf.slug));
        expect(row).toMatchObject({
          slug: leaf.slug,
          parentId: categoryId(leaf.root),
          position: leaf.position,
          name: leaf.name,
        });
      }
    });

    it('lands each of the twelve old values on a named leaf', () => {
      expect(LANDING_LEAVES.map((leaf) => leaf.from).sort()).toEqual(
        [
          'BAKERY',
          'BEVERAGES',
          'DAIRY',
          'FROZEN',
          'HOUSEHOLD',
          'MEAT',
          'OTHER',
          'PANTRY',
          'PERSONAL_CARE',
          'PRODUCE',
          'SEAFOOD',
          'SNACKS',
        ].sort()
      );
      for (const leaf of LANDING_LEAVES) {
        expect(REFERENCE_LEAF_SLUGS.has(leaf.slug)).toBe(true);
      }
    });

    it('puts every reference product on one or more leaves that exist', () => {
      const wrong = EVERY_ITEM.filter(
        ({ it }) =>
          it.categories.length === 0 ||
          new Set(it.categories).size !== it.categories.length ||
          it.categories.some((slug) => !REFERENCE_LEAF_SLUGS.has(slug))
      ).map(({ store, it }) => `${store}/${it.slug}`);
      expect(wrong).toEqual([]);
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

  describe('groups', () => {
    it('has a unique slug per group', () => {
      const slugs = REFERENCE_GROUPS.map((g) => g.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
    });

    it('names every group in both locales', () => {
      for (const g of REFERENCE_GROUPS) {
        expect(g.name.en?.trim()).toBeTruthy();
        expect(g.name.es?.trim()).toBeTruthy();
      }
    });

    /**
     * The rule the demo world states and this set is large enough to break: a
     * group with no members describes a catalog nothing here holds. It has
     * already caught two, `custard` and `nougat`, both of which looked obviously
     * necessary and turned out to have nothing in them.
     */
    it('gives every group at least one member', () => {
      // A member is an authored product or, since plan 0156, a harvested one
      // the group names by barcode.
      const used = new Set([
        ...EVERY_ITEM.map(({ it }) => it.group),
        ...REFERENCE_GROUPS.filter((g) => g.harvestedEans?.length).map(
          (g) => g.slug
        ),
      ]);
      const orphans = REFERENCE_GROUPS.map((g) => g.slug).filter(
        (s) => !used.has(s)
      );
      expect(orphans).toEqual([]);
    });

    it('assigns every product to a group that exists', () => {
      const known = new Set(REFERENCE_GROUPS.map((g) => g.slug));
      const unknown = EVERY_ITEM.map(({ it }) => it.group).filter(
        (g) => !known.has(g)
      );
      expect(unknown).toEqual([]);
    });

    it('lists synonyms in both locales, so either language finds the group', () => {
      for (const g of REFERENCE_GROUPS) {
        expect(g.synonyms.en.length).toBeGreaterThan(0);
        expect(g.synonyms.es.length).toBeGreaterThan(0);
      }
    });
  });

  describe('authored items', () => {
    it('has a unique slug within its store', () => {
      for (const [store, items] of ALL_ITEMS) {
        const slugs = items.map((i) => i.slug);
        expect(`${store}:${new Set(slugs).size}`).toBe(
          `${store}:${slugs.length}`
        );
      }
    });

    it('normalizes the name away from what the till printed', () => {
      // The whole point of the exercise: no item may keep the receipt's own
      // shouty abbreviation as its Spanish name.
      for (const { it } of EVERY_ITEM) {
        expect(it.name.es).not.toBe(it.receipt);
        expect(it.name.en).not.toBe(it.receipt);
        expect(it.name.en).not.toBe(it.name.en.toUpperCase());
      }
    });

    it('carries a positive price and the date it was seen', () => {
      for (const { it } of EVERY_ITEM) {
        expect(it.price).toBeGreaterThan(0);
        expect(it.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Number.isNaN(Date.parse(it.observedAt))).toBe(false);
      }
    });

    it('prices a per kilo product in kilograms', () => {
      for (const { it } of EVERY_ITEM) {
        if (it.perKilo) expect(it.defaultUnit).toBe('KILOGRAM');
      }
    });
  });

  describe('barcodes', () => {
    it('claims each EAN once', () => {
      // `uq_items_ean` is UNIQUE where not null, so a repeated barcode is not a
      // duplicate row, it is an insert that fails. A group's harvested barcode
      // counts too: two claims would put one product in two groups.
      const eans = [
        ...EVERY_ITEM.map(({ it }) => it.ean).filter(Boolean),
        ...REFERENCE_GROUPS.flatMap((g) => g.harvestedEans ?? []),
      ];
      expect(new Set(eans).size).toBe(eans.length);
    });

    it('carries EANs that look like barcodes', () => {
      for (const { it } of EVERY_ITEM) {
        if (it.ean) expect(it.ean).toMatch(/^\d{8,14}$/);
      }
      for (const ean of REFERENCE_GROUPS.flatMap(
        (g) => g.harvestedEans ?? []
      )) {
        expect(ean).toMatch(/^\d{8,14}$/);
      }
    });

    it('finds extra virgin olive oil by "aove" (plan 0156)', () => {
      const group = REFERENCE_GROUPS.find(
        (g) => g.slug === 'extra-virgin-olive-oil'
      );
      expect(group?.synonyms.es).toContain('aove');
      expect(group?.harvestedEans?.length).toBeGreaterThan(0);
    });

    it('gives barcodes only to Mercadona', () => {
      // The join to a harvest is a Mercadona affair; nothing harvests El Jamón
      // or SuperCash, so a barcode there would be a claim nothing can check.
      for (const it of [...EL_JAMON_ITEMS, ...SUPERCASH_ITEMS]) {
        expect(it.ean).toBeUndefined();
      }
    });

    it('knows the eight Mercadona products no harvest carries', () => {
      const withoutEan = MERCADONA_ITEMS.filter((it) => !it.ean);
      expect(withoutEan).toHaveLength(8);
    });
  });

  describe('derived ids', () => {
    it('is stable across runs', () => {
      expect(groupId('greek-yogurt')).toBe(groupId('greek-yogurt'));
      expect(groupId('greek-yogurt')).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
    });

    it('separates the same slug in different stores', () => {
      // El Jamón and SuperCash both sell a pâté; they are not one product.
      expect(itemId('el-jamon', 'pate-125g')).not.toBe(
        itemId('supercash', 'pate-125g')
      );
    });

    it('gives every row across the whole set a distinct id', () => {
      // Products rather than entries: an entry naming a `sameAs` deliberately
      // shares the target's id, so counting entries would report the merge as a
      // collision. The per chain price rows below stay one per entry.
      const productIds = new Set(
        EVERY_ITEM.map(({ store, it }) => authoredItemId(store, it))
      );
      const ids = [
        ...REFERENCE_GROUPS.map((g) => groupId(g.slug)),
        ...referenceCategoryRows().map((row) => row.id),
        ...productIds,
        ...EVERY_ITEM.map(({ store, it }) => supermarketItemId(store, it.slug)),
      ];
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('one product sold by two chains', () => {
    const ALIASED = EVERY_ITEM.filter(({ it }) => it.sameAs);

    it('names a target that exists', () => {
      for (const { it } of ALIASED) {
        const target = ALL_ITEMS.find(
          ([store]) => store === it.sameAs?.store
        )?.[1].find((other) => other.slug === it.sameAs?.slug);
        expect(`${it.slug} -> ${it.sameAs?.store}/${it.sameAs?.slug}`).toBe(
          `${it.slug} -> ${it.sameAs?.store}/${target?.slug}`
        );
      }
    });

    it('takes the target id rather than deriving its own', () => {
      for (const { store, it } of ALIASED) {
        expect(authoredItemId(store, it)).toBe(
          itemId(it.sameAs?.store as string, it.sameAs?.slug as string)
        );
        expect(authoredItemId(store, it)).not.toBe(itemId(store, it.slug));
      }
    });

    /**
     * Both entries write the product row, so a disagreement would be decided by
     * whichever store the seeder reaches last. This is what stops that being a
     * thing anybody has to know: the two state the same product, and only
     * `receipt`, `price` and `observedAt` are allowed to differ.
     */
    it('agrees with its target on every product field', () => {
      for (const { it } of ALIASED) {
        const target = ALL_ITEMS.find(
          ([store]) => store === it.sameAs?.store
        )?.[1].find((other) => other.slug === it.sameAs?.slug);
        expect(target).toBeDefined();
        expect({
          name: it.name,
          group: it.group,
          categories: it.categories,
          defaultUnit: it.defaultUnit,
          unitSize: it.unitSize,
          brand: it.brand,
          ean: it.ean,
        }).toEqual({
          name: target?.name,
          group: target?.group,
          categories: target?.categories,
          defaultUnit: target?.defaultUnit,
          unitSize: target?.unitSize,
          brand: target?.brand,
          ean: target?.ean,
        });
      }
    });

    it('never merges a private label, which does not cross a chain', () => {
      const HOUSE = [
        'Hacendado',
        'Bosque Verde',
        'Deliplus',
        'Alteza',
        'Eliges',
      ];
      for (const { it } of ALIASED) {
        expect(HOUSE).not.toContain(it.brand);
      }
    });
  });

  describe('stores', () => {
    it('describes one priced location per chain', () => {
      for (const s of REFERENCE_STORES) {
        expect(s.scopeKind).toBe('STORE');
        expect(s.location.postalCode).toMatch(/^\d{5}$/);
        expect(s.location.country).toBe('ES');
      }
    });

    it('means the same Mercadona row as the demo world', () => {
      // `uq_supermarkets_external_brand_key` allows exactly one row with
      // Q377705, so the two seeders have to agree on which. If the demo world
      // ever renumbers its Mercadona this fails here rather than as a unique
      // violation in whichever seeder happens to run second.
      expect(MERCADONA_SUPERMARKET_ID).toBe(
        demoWorld.catalog.supermarkets[0].id
      );
      expect(demoWorld.catalog.supermarkets[0].externalBrandKey).toBe(
        'Q377705'
      );
    });

    it('gives every chain a NATIONAL default beside its STORE scope', () => {
      // Plan 0153: the default used to be the one STORE scope, so one shop
      // answered for the whole chain.
      for (const s of REFERENCE_STORES) {
        const rows = referenceChainRows(s);
        expect(rows.national).toMatchObject({
          id: nationalScopeId(s.slug),
          supermarketId: rows.supermarket.id,
          kind: 'NATIONAL',
          externalKey: null,
          label: s.name,
        });
        expect(rows.supermarket.defaultPriceScopeId).toBe(rows.national.id);
        expect(rows.store).toMatchObject({
          id: priceScopeId(s.slug),
          supermarketId: rows.supermarket.id,
          kind: 'STORE',
        });
        expect(rows.store.id).not.toBe(rows.national.id);
      }
    });

    it("keys El Jamón on the chain's Wikidata item, the one OpenStreetMap uses", () => {
      const elJamon = REFERENCE_STORES.find((s) => s.slug === 'el-jamon');
      expect(elJamon?.externalBrandKey).toBe('Q6135982');
    });

    it('leaves Mercadona to the seeder', () => {
      // Mercadona is not here because it is the one chain that may already
      // exist: the seeder looks it up by brand key and only creates it when no
      // harvest has. Declaring it beside El Jamón would make that a second
      // chain with the same name and different prices.
      expect(REFERENCE_STORES.map((s) => s.slug)).not.toContain('mercadona');
    });
  });
});
