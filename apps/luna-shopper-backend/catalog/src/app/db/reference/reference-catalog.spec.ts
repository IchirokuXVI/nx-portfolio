import { demoWorld } from '@portfolio/luna-shopper/test-fixtures';
import {
  MERCADONA_SUPERMARKET_ID,
  groupId,
  itemId,
  supermarketItemId,
} from './ids';
import {
  EL_JAMON_ITEMS,
  MERCADONA_ITEMS,
  REFERENCE_GROUPS,
  REFERENCE_STORES,
  SUPERCASH_ITEMS,
} from './index';
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
      const used = new Set([...EVERY_ITEM.map(({ it }) => it.group)]);
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
      // duplicate row, it is an insert that fails.
      const eans = EVERY_ITEM.map(({ it }) => it.ean).filter(Boolean);
      expect(new Set(eans).size).toBe(eans.length);
    });

    it('carries EANs that look like barcodes', () => {
      for (const { it } of EVERY_ITEM) {
        if (it.ean) expect(it.ean).toMatch(/^\d{8,14}$/);
      }
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
      const ids = [
        ...REFERENCE_GROUPS.map((g) => groupId(g.slug)),
        ...EVERY_ITEM.map(({ store, it }) => itemId(store, it.slug)),
        ...EVERY_ITEM.map(({ store, it }) => supermarketItemId(store, it.slug)),
      ];
      expect(new Set(ids).size).toBe(ids.length);
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

    it('leaves Mercadona to the seeder', () => {
      // Mercadona is not here because it is the one chain that may already
      // exist: the seeder looks it up by brand key and only creates it when no
      // harvest has. Declaring it beside El Jamón would make that a second
      // chain with the same name and different prices.
      expect(REFERENCE_STORES.map((s) => s.slug)).not.toContain('mercadona');
    });
  });
});
