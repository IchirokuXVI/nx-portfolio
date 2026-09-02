import { PriceSourceKind } from '@portfolio/luna-shopper/contracts';
import type { DataSource, EntityManager } from 'typeorm';
import { In } from 'typeorm';
import {
  Item,
  PriceScope,
  ProductGroup,
  Supermarket,
  SupermarketItem,
  SupermarketLocation,
} from '../../entities';
import {
  EL_JAMON_ITEMS,
  MERCADONA_AUTHORED,
  SUPERCASH_ITEMS,
} from './authored';
import { REFERENCE_GROUPS } from './groups';
import {
  groupId,
  itemId,
  locationId,
  priceScopeId,
  supermarketId,
  supermarketItemId,
} from './ids';
import { MERCADONA_ASSIGNMENTS } from './mercadona';
import { REFERENCE_STORES } from './stores';
import type { AuthoredItem } from './types';

/** What one run changed, so the caller can print it and a test can assert it. */
export interface ReferenceSeedReport {
  groups: number;
  stores: number;
  items: number;
  prices: number;
  /** Harvested Mercadona rows this run put into a group. */
  assigned: number;
  /** Assignments whose EAN no harvest in this database carries. */
  unmatched: number;
  /** Prices left alone because a person had typed one in. */
  preserved: number;
}

const STORE_ITEMS: [string, AuthoredItem[]][] = [
  ['el-jamon', EL_JAMON_ITEMS],
  ['supercash', SUPERCASH_ITEMS],
];

/**
 * Writes the reference catalog (plan 0067, section 6).
 *
 * Idempotent by derived id, and safe to run on every boot, which is what it is
 * for: an upsert per row keyed on a uuid that comes out of the slug, so the
 * second run rewrites the same 274 rows rather than adding 274 more. It never
 * deletes, which is the one way it differs from the demo world seeder: that one
 * owns its whole graph and can clear it, while this one lives in a database that
 * may also hold 4,196 harvested products and every list a user has built on top
 * of them.
 *
 * It does three separable things, and each degrades on its own:
 *
 * 1. **Groups.** Always written. They are the normalization and they depend on
 *    nothing else being present.
 * 2. **El Jamón and SuperCash.** Their chains, stores, products and receipt
 *    prices, none of which any other source produces.
 * 3. **Mercadona group assignment.** Sets `productGroupId` on harvested rows,
 *    matched by EAN. In a database with no harvest this matches nothing and
 *    reports it, rather than failing: a developer who has never run a discovery
 *    still gets the groups and the two receipt stores, which is most of the
 *    value and all of the part that is testable.
 */
export async function seedReferenceCatalog(
  dataSource: DataSource
): Promise<ReferenceSeedReport> {
  if (!dataSource.isInitialized) {
    await dataSource.initialize();
  }

  return dataSource.transaction(async (m: EntityManager) => {
    const report: ReferenceSeedReport = {
      groups: 0,
      stores: 0,
      items: 0,
      prices: 0,
      assigned: 0,
      unmatched: 0,
      preserved: 0,
    };

    // --- 1. The groups ----------------------------------------------------
    const groupRows = REFERENCE_GROUPS.map((g) => ({
      id: groupId(g.slug),
      slug: g.slug,
      name: g.name,
      referenceUnit: g.referenceUnit,
      synonyms: g.synonyms,
    }));
    await m.getRepository(ProductGroup).upsert(groupRows, ['id']);
    report.groups = groupRows.length;

    // --- 2. The two receipt chains ----------------------------------------
    for (const store of REFERENCE_STORES) {
      const sId = supermarketId(store.slug);
      const scId = priceScopeId(store.slug);
      await m.getRepository(Supermarket).upsert(
        [
          {
            id: sId,
            name: store.name,
            websiteUrl: store.websiteUrl ?? null,
            externalBrandKey: store.externalBrandKey ?? null,
            // The chain has one scope, so it is unambiguously the default; without
            // it "show me El Jamón" with no location has no answer at all.
            defaultPriceScopeId: scId,
          },
        ],
        ['id']
      );
      await m
        .getRepository(PriceScope)
        .upsert(
          [
            {
              id: scId,
              supermarketId: sId,
              kind: store.scopeKind,
              externalKey: store.slug,
              label: store.scopeLabel,
            },
          ],
          ['id']
        );
      await m.getRepository(SupermarketLocation).upsert(
        [
          {
            id: locationId(store.slug),
            supermarketId: sId,
            priceScopeId: scId,
            label: store.location.label,
            address: store.location.address,
            city: store.location.city,
            country: store.location.country,
            postalCode: store.location.postalCode,
          },
        ],
        ['id']
      );
      report.stores++;
    }

    // --- 3. Authored products and their receipt prices ---------------------
    // Mercadona's eight go against the harvest's own Córdoba scope, so they sit
    // beside the 4,196 rather than under a second Mercadona of their own. If no
    // harvest has ever run there is no scope to hang them on, and they are
    // skipped: an item priced in no shop is worse than an absent one.
    const mercadonaScope = await findMercadonaScope(m);
    const priced: [string, string, AuthoredItem[]][] = [
      ...STORE_ITEMS.map(
        ([slug, items]) =>
          [slug, priceScopeId(slug), items] as [string, string, AuthoredItem[]]
      ),
      ...(mercadonaScope
        ? ([['mercadona', mercadonaScope, MERCADONA_AUTHORED]] as [
            string,
            string,
            AuthoredItem[],
          ][])
        : []),
    ];

    for (const [storeSlug, scopeId, items] of priced) {
      const itemRows = items.map((it) => ({
        id: itemId(storeSlug, it.slug),
        name: it.name,
        brand: it.brand ?? null,
        imageUrl: null,
        sku: null,
        ean: null,
        unitSize: null,
        category: it.category,
        defaultUnit: it.defaultUnit,
        productGroupId: groupId(it.group),
      }));
      await m.getRepository(Item).upsert(itemRows, ['id']);
      report.items += itemRows.length;

      // A price a person typed in is never overwritten (plan 0038, section
      // 6.5). This seed is an automated source like any other, and it runs on
      // every boot, so without this check one hand correction would survive
      // exactly until the next restart.
      const ids = items.map((it) => supermarketItemId(storeSlug, it.slug));
      const existing = await m.getRepository(SupermarketItem).find({
        where: { id: In(ids) },
        select: { id: true, priceSourceKind: true },
      });
      const admin = new Set(
        existing
          .filter((r) => r.priceSourceKind === PriceSourceKind.ADMIN)
          .map((r) => r.id)
      );

      const priceRows = items
        .map((it) => ({ it, id: supermarketItemId(storeSlug, it.slug) }))
        .filter(({ id }) => !admin.has(id))
        .map(({ it, id }) => ({
          id,
          itemId: itemId(storeSlug, it.slug),
          priceScopeId: scopeId,
          // A counter product's receipt figure is per kilogram, which is not
          // what one of them costs, so it goes to the per unit fields and
          // `price` stays null rather than claiming a pack price nobody paid.
          price: it.perKilo ? null : it.price,
          currency: 'EUR',
          unitPrice: it.price,
          unitPriceLabel: it.perKilo ? 'kg' : 'ud',
          priceObservedAt: new Date(`${it.observedAt}T00:00:00.000Z`),
          priceSourceKind: PriceSourceKind.USER_RECEIPT,
          available: true,
        }));
      await m.getRepository(SupermarketItem).upsert(priceRows, ['id']);
      report.prices += priceRows.length;
      report.preserved += admin.size;
    }

    // --- 4. Mercadona group assignment, by EAN ----------------------------
    for (const a of MERCADONA_ASSIGNMENTS) {
      const result = await m
        .getRepository(Item)
        .update({ ean: a.ean }, { productGroupId: groupId(a.group) });
      if (result.affected) report.assigned += result.affected;
      else report.unmatched++;
    }

    return report;
  });
}

/**
 * The scope the harvest priced Mercadona in, if one exists.
 *
 * Found through the chain's Wikidata QID rather than its name, for the reason
 * the `externalBrandKey` column exists: a name match splits one chain into
 * several and merges others. The chain's own default is preferred, and its first
 * scope is the fallback for a database whose harvest predates that column being
 * set.
 */
async function findMercadonaScope(m: EntityManager): Promise<string | null> {
  const mercadona = await m
    .getRepository(Supermarket)
    .findOne({ where: { externalBrandKey: 'Q377705' } });
  if (!mercadona) return null;
  if (mercadona.defaultPriceScopeId) return mercadona.defaultPriceScopeId;
  const scope = await m
    .getRepository(PriceScope)
    .findOne({
      where: { supermarketId: mercadona.id },
      order: { createdAt: 'ASC' },
    });
  return scope?.id ?? null;
}
