import { ItemCategory, UnitOfMeasure } from '@portfolio/luna-shopper/contracts';
import searchPage from './__fixtures__/search-page.json';
import productShortCode from './__fixtures__/product-short-code.json';
import productSinglePrice from './__fixtures__/product-single-price.json';
import productTwoRegionPrices from './__fixtures__/product-two-region-prices.json';
import productUnpriced from './__fixtures__/product-unpriced.json';
import storePage from './__fixtures__/store-page.json';
import { isGroceryCategory } from './categories';
import {
  normalizeListPage,
  normalizeProduct,
  normalizeStorePage,
  openingHoursLine,
} from './normalize';
import { parseFlat, readProductState } from './nuxt-payload';
import type { LidlListRow } from './types';

/**
 * Every fixture is a whole response, verbatim, captured on 2026-09-06 by
 * `tools/capture-fixtures.ts` and never hand edited. `__fixtures__/README.md`
 * names the case each one pins.
 */

const OBSERVED_AT = new Date('2026-09-06T12:00:00Z');

/** One product, read the way {@link LidlClient.getProduct} reads it. */
function readFixture(
  fixture: unknown,
  externalId: string,
  row: Partial<LidlListRow> = {}
) {
  const state = readProductState(parseFlat(fixture as unknown[]), externalId);
  return normalizeProduct(state, {
    row: { ...emptyRow(externalId), ...row },
    observedAt: OBSERVED_AT,
  });
}

function emptyRow(externalId: string): LidlListRow {
  return {
    externalId,
    name: '',
    brand: null,
    siteCategory: '',
    categoryPath: [],
    path: null,
    sizeFormat: null,
    listPrice: null,
    ian: null,
  };
}

describe('normalizeListPage', () => {
  const page = normalizeListPage(searchPage);

  it('reads the paging the response reports for itself', () => {
    expect(page.total).toBe(494);
    expect(page.offset).toBe(325);
    expect(page.fetchsize).toBe(5);
    expect(page.rows).toHaveLength(5);
  });

  it('reads the fields the index carries', () => {
    const [almonds] = page.rows;
    expect(almonds).toEqual({
      externalId: '11038145',
      name: 'Bebida de almendras con calcio',
      brand: 'Vemondo',
      siteCategory: 'Food',
      categoryPath: [
        'Mundos de necesidad',
        'Comida y cerca de la comida',
        'Quesos, productos lácteos y huevos',
        'Leche y nata',
      ],
      path: '/p/vemondo-bebida-de-almendras-con-calcio/p11038145',
      sizeFormat: '4x1 / l',
      listPrice: 3.49,
      ian: '5704069',
    });
  });

  it('carries both what a run keeps and what it drops', () => {
    // The window this fixture was cut from holds grocery beside the weekly
    // bazar, which is what makes section 5's filter testable at all.
    const kept = page.rows.filter((row) => isGroceryCategory(row.siteCategory));
    expect(kept.map((row) => row.externalId)).toEqual([
      '11038145',
      '11150509',
      '11000491',
    ]);
    expect(page.rows.length - kept.length).toBeGreaterThan(0);
  });
});

describe('normalizeProduct', () => {
  it('reads one price and the regions that pay it', () => {
    const product = readFixture(productSinglePrice, '11671605');

    expect(product?.ean).toBe('8412129048078');
    expect(product?.shortCode).toBeNull();
    expect(product?.inStore).toBe(true);
    expect(product?.prices).toHaveLength(1);

    const [price] = product?.prices ?? [];
    expect(price.price).toBe(3.99);
    expect(price.currency).toBe('EUR');
    expect(price.validFrom).toEqual(new Date('2026-09-03T22:00:00Z'));
    expect(price.validUntil).toEqual(new Date('2026-09-06T21:59:59Z'));
    // Every region pointing at the one price id is grouped under it, which is
    // what lets a run make one ingest call per scope rather than per product.
    expect(price.regions.length).toBeGreaterThan(50);
    expect(price.regions).toContainEqual({ id: '1', name: 'A Coruña' });
  });

  it('drops a region the chain publishes no price for', () => {
    const product = readFixture(productSinglePrice, '11671605');
    const priced = new Set(
      product?.prices.flatMap((price) => price.regions.map((r) => r.id))
    );

    // The product carries two price ids and only one of them has a current
    // price, so some regions are named and unpriced. **They are dropped, not
    // written as zero**: a shopper there is shown nothing rather than a price
    // the chain never published (section 4).
    expect(product?.prices).toHaveLength(1);
    expect(priced.size).toBeLessThan(59);
  });

  it('keeps two regional prices apart', () => {
    const product = readFixture(productTwoRegionPrices, '11096990');
    const prices = [...(product?.prices ?? [])].sort(
      (a, b) => a.price - b.price
    );

    expect(prices).toHaveLength(2);
    expect(prices.map((price) => price.price)).toEqual([74.99, 77.99]);
    // The two groups are disjoint: a region pays one price, never both.
    const cheap = new Set(prices[0].regions.map((region) => region.id));
    const dear = prices[1].regions.map((region) => region.id);
    expect(dear.some((id) => cheap.has(id))).toBe(false);
  });

  it('writes no price for a product the window holds and prices nowhere', () => {
    const product = readFixture(productUnpriced, '11008087');

    // 21 of the week's products look like this. They are a real product with a
    // real EAN and no price, which the catalog is allowed to hold.
    expect(product?.prices).toEqual([]);
    expect(product?.ean).toBe('8410436428972');
    expect(product?.category).toBe(ItemCategory.HOUSEHOLD);
  });

  it('never reads an eight digit code as an EAN', () => {
    const product = readFixture(productShortCode, '11029954');

    expect(product?.ean).toBeNull();
    expect(product?.shortCode).toBe('40881959');
    expect(product?.ian).toBe('80532');
    expect(product?.unitSize).toBe(400);
    expect(product?.unit).toBe(UnitOfMeasure.GRAM);
    expect(product?.sizeFormat).toBe('400 g');
    expect(product?.category).toBe(ItemCategory.PRODUCE);
  });

  it('falls back to the index row for what the page does not state', () => {
    const product = readFixture(productShortCode, '11029954', {
      brand: 'Solevita',
      name: 'Uva blanca',
    });

    // The page states no brand for most grocery, and the index does.
    expect(product?.brand).toBe('Solevita');
    expect(product?.url).toBe(
      'https://www.lidl.es/p/uva-blanca-sabores-sin-semillas/p11029954'
    );
    expect(product?.observedAt).toEqual(OBSERVED_AT);
  });

  it('reads a page with no payload as no product', () => {
    expect(readFixture([], '11029954')).toBeNull();
    expect(readFixture(productShortCode, '404040')).toBeNull();
  });
});

describe('normalizeStorePage', () => {
  const page = normalizeStorePage(storePage);

  it('reads the shop and the region it names', () => {
    expect(page.total).toBe(730);
    expect(page.stores[0]).toEqual({
      externalRef: 'ES00215',
      name: 'Fraga',
      street: 'Avda. Madrid 34',
      city: 'Fraga',
      postalCode: '22520',
      state: 'Aragón',
      latitude: 41.5223,
      longitude: 0.33812,
      regionId: '21',
      regionName: 'Huesca',
      zone: 'PEN',
      openingHours: 'Mo-Sa 09:00-21:30; Su off',
    });
  });

  it('reads a region for every shop, with nothing derived from the postcode', () => {
    // Section 4.1: the shop states its own region, so the postal code is not in
    // the path. Two of these five shops share a region and sit in one province.
    expect(page.stores.every((store) => store.regionId !== null)).toBe(true);
    expect(new Set(page.stores.map((store) => store.regionId)).size).toBe(4);
  });
});

describe('openingHoursLine', () => {
  it('collapses a run of identical days', () => {
    const hours = openingHoursLine({
      items: [
        day('2026-09-07', '09:00', '21:30'),
        day('2026-09-08', '09:00', '21:30'),
        day('2026-09-09', '09:00', '21:30'),
        day('2026-09-10', '09:00', '21:30'),
        day('2026-09-11', '09:00', '21:30'),
        day('2026-09-12', '09:00', '21:30'),
        { date: '2026-09-13', timeRanges: [] },
      ],
    });
    expect(hours).toBe('Mo-Sa 09:00-21:30; Su off');
  });

  it('keeps a day that differs', () => {
    const hours = openingHoursLine({
      items: [
        day('2026-09-07', '09:00', '21:30'),
        day('2026-09-08', '12:00', '19:00'),
        day('2026-09-09', '09:00', '21:30'),
      ],
    });
    expect(hours).toBe('Mo 09:00-21:30; Tu 12:00-19:00; We 09:00-21:30');
  });

  it('is null when the service states nothing', () => {
    expect(openingHoursLine({ items: [] })).toBeNull();
    expect(openingHoursLine(null)).toBeNull();
  });
});

function day(date: string, from: string, to: string) {
  return {
    date,
    timeRanges: [{ from: `${date}T${from}:00`, to: `${date}T${to}:00` }],
  };
}
