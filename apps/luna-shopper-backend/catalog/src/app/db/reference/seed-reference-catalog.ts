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
import { EL_JAMON_ITEMS, SUPERCASH_ITEMS } from './authored';
import { REFERENCE_GROUPS } from './groups';
import {
  groupId,
  itemId,
  locationId,
  priceScopeId,
  supermarketId,
  supermarketItemId,
} from './ids';
import { MERCADONA_ITEMS } from './mercadona';
import { REFERENCE_STORES } from './stores';
import type { AuthoredItem } from './types';

/** What one run changed, so the caller can print it and a test can assert it. */
export interface ReferenceSeedReport {
  groups: number;
  stores: number;
  /** Products this run created. */
  items: number;
  /** Prices this run wrote. */
  prices: number;
  /**
   * Products a harvest already carried, so only their group was set. Zero in a
   * database that has never run a discovery, which is the normal case.
   */
  adopted: number;
  /** Prices left alone because a person had typed one in. */
  preserved: number;
}

const MERCADONA_BRAND_KEY = 'Q377705';

/**
 * Writes the reference catalog (plan 0067, section 6).
 *
 * Idempotent by derived id and safe to run on every boot, which is what it is
 * for: an upsert per row keyed on a uuid that comes out of the slug, so the
 * second run rewrites the same rows rather than adding more. It never deletes,
 * which is the one way it differs from the demo world seeder: that one owns its
 * whole graph and can clear it, while this one lives in a database that may also
 * hold a full harvest and every list a user has built on top of it.
 *
 * What lands is **the products on the receipts and nothing else**: 116 from
 * Mercadona, 16 from El Jamón, 107 from SuperCash. Not an assortment — a
 * developer does not need 4,196 products to click through, and getting them
 * would mean either an eighteen minute harvest or a three megabyte dump in the
 * repository.
 *
 * The one thing it adapts to is whether a harvest is present, and it decides
 * that per product, by EAN. See `seedMercadona`.
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
      adopted: 0,
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
            // The chain has one scope, so it is unambiguously the default;
            // without it "show me El Jamón" with no location has no answer.
            defaultPriceScopeId: scId,
          },
        ],
        ['id']
      );
      await m.getRepository(PriceScope).upsert(
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
      await writeItems(
        m,
        store.slug,
        priceScopeId(store.slug),
        storeItems(store.slug),
        report
      );
    }

    // --- 3. Mercadona -----------------------------------------------------
    await seedMercadona(m, report);

    return report;
  });
}

function storeItems(slug: string): AuthoredItem[] {
  return slug === 'el-jamon' ? EL_JAMON_ITEMS : SUPERCASH_ITEMS;
}

/**
 * Mercadona, which is the only half that has to work two ways (section 3).
 *
 * Its chain and warehouse scope are created if absent, so a fresh database gets
 * a Mercadona to hang prices on without a harvest ever having run. Then, per
 * product:
 *
 * - **A harvested row already has this EAN.** That row is the product. Only its
 *   `productGroupId` is set, and its official price is left alone: it is newer
 *   than an August receipt, and `supermarket_items` holds one row per item per
 *   scope, so writing over it would destroy the better number rather than add to
 *   it. Counted as `adopted`.
 * - **Nothing has this EAN.** This entry becomes the product, named as the
 *   normalized name says and priced from the receipt.
 *
 * The EAN is what makes both work, and `uq_items_ean` is why it has to be a
 * lookup rather than an insert: the constraint is UNIQUE where not null, so
 * creating a row for a barcode a harvest already holds is an error, not a
 * duplicate. That also fixes an ordering: a catalog dump is restored BEFORE this
 * seed, never after.
 */
async function seedMercadona(
  m: EntityManager,
  report: ReferenceSeedReport
): Promise<void> {
  const repo = m.getRepository(Supermarket);
  const chain = await repo.findOne({
    where: { externalBrandKey: MERCADONA_BRAND_KEY },
  });

  let scopeId: string;
  if (chain) {
    // A harvest created it, with warehouse scopes of its own. Its default is
    // the scope to price against; the earliest is the fallback for a database
    // whose harvest predates that column being set.
    scopeId =
      chain.defaultPriceScopeId ??
      (
        await m.getRepository(PriceScope).findOne({
          where: { supermarketId: chain.id },
          order: { createdAt: 'ASC' },
        })
      )?.id ??
      '';
    if (!scopeId) return;
  } else {
    const id = supermarketId('mercadona');
    scopeId = priceScopeId('mercadona');
    await repo.upsert(
      [
        {
          id,
          name: { en: 'Mercadona', es: 'Mercadona' },
          websiteUrl: 'https://www.mercadona.es',
          externalBrandKey: MERCADONA_BRAND_KEY,
          defaultPriceScopeId: scopeId,
        },
      ],
      ['id']
    );
    await m.getRepository(PriceScope).upsert(
      [
        {
          id: scopeId,
          supermarketId: id,
          // The warehouse the Córdoba receipts were priced by. A WAREHOUSE
          // scope rather than a STORE one even here, because that is how the
          // chain actually prices and a later harvest has to land on the same
          // shape rather than beside it.
          kind: 'WAREHOUSE' as PriceScope['kind'],
          externalKey: '4661',
          label: {
            en: 'Córdoba — warehouse 4661',
            es: 'Córdoba — almacén 4661',
          },
        },
      ],
      ['id']
    );
    await m.getRepository(SupermarketLocation).upsert(
      [
        {
          id: locationId('mercadona'),
          supermarketId: id,
          priceScopeId: scopeId,
          label: {
            en: 'Córdoba — Libertador Andrés de Santa Cruz',
            es: 'Córdoba — Libertador Andrés de Santa Cruz',
          },
          address: 'C/ Libertador Andrés de Santa Cruz, s/n',
          city: 'Córdoba',
          country: 'ES',
          postalCode: '14013',
        },
      ],
      ['id']
    );
    report.stores++;
  }

  const eans = MERCADONA_ITEMS.map((i) => i.ean).filter(
    (e): e is string => !!e
  );
  const harvested = await m
    .getRepository(Item)
    .find({ where: { ean: In(eans) }, select: { id: true, ean: true } });
  const byEan = new Map(harvested.map((h) => [h.ean as string, h.id]));

  for (const it of MERCADONA_ITEMS) {
    const existing = it.ean ? byEan.get(it.ean) : undefined;
    if (existing) {
      await m
        .getRepository(Item)
        .update({ id: existing }, { productGroupId: groupId(it.group) });
      report.adopted++;
    }
  }

  const fresh = MERCADONA_ITEMS.filter((it) => !(it.ean && byEan.has(it.ean)));
  await writeItems(m, 'mercadona', scopeId, fresh, report);
}

/**
 * Creates a set of products and their receipt prices.
 *
 * The price rule is plan 0038 section 6.5, and it bites harder here than
 * anywhere else it applies: this runs on every boot, so without the check one
 * price corrected by hand through the admin surface would survive exactly until
 * the next restart.
 */
async function writeItems(
  m: EntityManager,
  storeSlug: string,
  scopeId: string,
  items: AuthoredItem[],
  report: ReferenceSeedReport
): Promise<void> {
  if (!items.length) return;

  const itemRows = items.map((it) => ({
    id: itemId(storeSlug, it.slug),
    name: it.name,
    brand: it.brand ?? null,
    imageUrl: null,
    sku: null,
    ean: it.ean ?? null,
    unitSize: null,
    category: it.category,
    defaultUnit: it.defaultUnit,
    productGroupId: groupId(it.group),
  }));
  await m.getRepository(Item).upsert(itemRows, ['id']);
  report.items += itemRows.length;

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
      // A counter product's receipt figure is per kilogram, which is not what
      // one of them costs, so it goes to the per unit fields and `price` stays
      // null rather than claiming a pack price nobody paid.
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
