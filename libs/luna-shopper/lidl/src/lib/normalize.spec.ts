import { UnitOfMeasure } from '@portfolio/luna-shopper/contracts';
import productApproximateWeight from './__fixtures__/product-approximate-weight.json';
import productShortCode from './__fixtures__/product-short-code.json';
import productSinglePrice from './__fixtures__/product-single-price.json';
import productTwoRegionPrices from './__fixtures__/product-two-region-prices.json';
import productUnpriced from './__fixtures__/product-unpriced.json';
import searchPage from './__fixtures__/search-page.json';
import storePage from './__fixtures__/store-page.json';
import { isGroceryCategory } from './categories';
import {
  nextListOffset,
  normalizeListPage,
  normalizeListRow,
  normalizeProduct,
  normalizeStorePage,
  openingHoursLine,
} from './normalize';
import { parseFlat, readProductState } from './nuxt-payload';
import { packCountIn } from './size';
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
    categoryBreadcrumbs: null,
    path: null,
    sizeFormat: null,
    listPrice: null,
    ian: null,
    image: null,
    imageList: [],
  };
}

describe('normalizeListPage', () => {
  const page = normalizeListPage(searchPage);

  it('reads the paging the response reports for itself', () => {
    expect(page.total).toBe(494);
    expect(page.offset).toBe(325);
    expect(page.fetchsize).toBe(5);
    expect(page.rows).toHaveLength(5);
    expect(page.itemCount).toBe(5);
  });

  it('counts every item the page carried, also a tile that is no product (plan 0256)', () => {
    const items = (searchPage as { items: unknown[] }).items;
    const withTiles = normalizeListPage({
      ...searchPage,
      items: [{ banner: { title: 'Ofertas' } }, ...items, {}],
    });

    expect(withTiles.rows).toHaveLength(5);
    expect(withTiles.itemCount).toBe(7);
  });

  it('counts no items on a page that carries none', () => {
    expect(normalizeListPage({ numFound: 3 }).itemCount).toBe(0);
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
      // The index states the list and files this row nowhere in the online
      // shop tree (plan 0268).
      categoryBreadcrumbs: [],
      path: '/p/vemondo-bebida-de-almendras-con-calcio/p11038145',
      sizeFormat: '4x1 / l',
      listPrice: 3.49,
      ian: '5704069',
      image:
        'https://www.lidl.es/assets/gcpdecd1bd9768046698465d4e0a882ebf5.png',
      imageList: [
        'https://www.lidl.es/assets/gcpdecd1bd9768046698465d4e0a882ebf5.png',
        'https://www.lidl.es/assets/gcpa6ae9d31fb0947fe8fbbd32474e6c71d.png',
      ],
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

  it('prints a size whose N is the pack count (plan 0162)', () => {
    const [almonds] = page.rows;
    expect(packCountIn(almonds.sizeFormat)).toBe(4);
  });

  describe('a brand field that holds no brand (plan 0178)', () => {
    /** The first row of the captured index, with the brand name replaced. */
    function rowPrinting(brand: string) {
      const [item] = (searchPage as { items: unknown[] }).items;
      const data = (item as { gridbox: { data: Record<string, unknown> } })
        .gridbox.data;
      return normalizeListRow({ ...data, brand: { name: brand } } as never);
    }

    it('reads the HALLOWEEN brand as null, since a season is not a brand', () => {
      expect(rowPrinting('HALLOWEEN')?.brand).toBeNull();
      expect(rowPrinting('Halloween')?.brand).toBeNull();
      expect(rowPrinting('NAVIDAD')?.brand).toBeNull();
    });

    it('still reads a real brand, and the dash as none', () => {
      expect(rowPrinting('Vemondo')?.brand).toBe('Vemondo');
      expect(rowPrinting('-')?.brand).toBeNull();
    });

    it('does not let a listed word on the index row fill a product in', () => {
      // The page states no brand, so the row's is the fallback: a row that
      // went through `normalizeListRow` carries null and the product does too.
      const row = rowPrinting('HALLOWEEN');
      const product = readFixture(productShortCode, '11029954', {
        brand: row?.brand ?? null,
      });
      expect(product?.brand).toBeNull();
    });
  });
});

describe('nextListOffset (plan 0256)', () => {
  const page = (itemCount: number, fetchsize: number | null) => ({
    rows: [],
    total: 679,
    offset: 0,
    fetchsize,
    itemCount,
  });

  it('steps by the items the page carried', () => {
    expect(nextListOffset(page(60, 60), 120, 100)).toBe(180);
  });

  it('steps by the echoed size when the page carried no items', () => {
    expect(nextListOffset(page(0, 60), 120, 100)).toBe(180);
  });

  it('steps by the asked size when the page stated neither', () => {
    expect(nextListOffset(page(0, null), 120, 100)).toBe(220);
    expect(nextListOffset(page(0, 0), 120, 100)).toBe(220);
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
    expect(product?.categorySlug).toBe('detergents');
  });

  it('weighs a tray printed "Aprox." and gives it no size (plan 0244)', () => {
    // Captured on 2026-11-05: a chorizo tray printed `Aprox.450 g`, one
    // price and no price per kilo, so a piece priced as one.
    const product = readFixture(productApproximateWeight, '11031963');

    expect(product?.sizeFormat).toBe('Aprox.450 g');
    expect(product?.approxWeight).toBe(450);
    expect(product?.unitSize).toBeNull();
    expect(product?.unit).toBeNull();
    expect(product?.prices.length).toBeGreaterThan(0);
  });

  it('never reads an eight digit code as an EAN', () => {
    const product = readFixture(productShortCode, '11029954');

    expect(product?.ean).toBeNull();
    expect(product?.shortCode).toBe('40881959');
    expect(product?.ian).toBe('80532');
    expect(product?.unitSize).toBe(400);
    expect(product?.unit).toBe(UnitOfMeasure.GRAM);
    expect(product?.approxWeight).toBeNull();
    expect(product?.sizeFormat).toBe('400 g');
    // A single size is not a pack (plan 0162).
    expect(product?.packCount).toBeNull();
    expect(product?.categorySlug).toBe('other-fruits');
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

describe('every path a product is filed under (plan 0268)', () => {
  const page = normalizeListPage(searchPage);
  const NEED_WORLD_QUESO = [
    'Mundos de necesidad',
    'Comida y cerca de la comida',
    'Quesos, productos lácteos y huevos',
    'Queso',
  ];

  it('reads the online shop breadcrumbs the index prints beside a row', () => {
    const kitchen = page.rows.find((row) => row.externalId === '11110760');

    // In `meta`, not in `data`: the breadcrumb is the one path the row has
    // in the online shop tree.
    expect(kitchen?.categoryBreadcrumbs).toEqual([
      ['Hogar y decoración', 'Cocina'],
    ]);
  });

  it('reads a row that prints no breadcrumb list as stating none', () => {
    const [almonds] = page.rows;
    const data = (
      searchPage as { items: Array<{ gridbox: { data: unknown } }> }
    ).items[0].gridbox.data;

    expect(almonds.categoryBreadcrumbs).toEqual([]);
    expect(normalizeListRow(data)?.categoryBreadcrumbs).toBeNull();
  });

  it('gives a product the breadcrumbs of its index row as a second path', () => {
    const kitchen = page.rows.find((row) => row.externalId === '11110760');
    // This page was captured before LIDL printed the list on a product page,
    // so the row's breadcrumbs are what is known.
    const product = readFixture(productShortCode, '11029954', {
      categoryBreadcrumbs: kitchen?.categoryBreadcrumbs ?? null,
    });

    expect(product?.categoryPaths).toEqual([
      product?.categoryPath,
      ['Hogar y decoración', 'Cocina'],
    ]);
    expect(product?.categoryPaths[0]).toEqual(product?.categoryPath);
    // The page did not state the list itself, so the paths prove nothing
    // about a path stored before.
    expect(product?.categoryPathsStated).toBe(false);
  });

  it('gives a product with no breadcrumb one path, and says it did not state its paths', () => {
    // Captured on 2026-11-05, when the page states the list, and it is empty.
    const product = readFixture(productApproximateWeight, '11031963');

    expect(product?.categoryPaths).toEqual([
      [
        'Mundos de necesidad',
        'Comida y cerca de la comida',
        'Carne y aves',
        'Carne de cerdo',
      ],
    ]);
    // An empty list states nothing (owner decision 95b).
    expect(product?.categoryPathsStated).toBe(false);
  });

  it('takes the page list over the row list, even when the page list is empty', () => {
    const product = readFixture(productApproximateWeight, '11031963', {
      categoryBreadcrumbs: [['Hogar y decoración', 'Cocina']],
    });

    expect(product?.categoryPaths).toHaveLength(1);
  });

  it('gives a product with no path at all no paths', () => {
    expect(
      normalizeProduct(
        { keyfacts: {} },
        { row: emptyRow('1'), observedAt: OBSERVED_AT }
      )?.categoryPaths
    ).toEqual([]);
  });

  it('keeps a hidden node and every breadcrumb, root first, without repeats', () => {
    const product = normalizeProduct(
      {
        keyfacts: {
          wonCategoryPrimary: NEED_WORLD_QUESO.join('/'),
        },
        wonCategoryBreadcrumbs: [
          [
            { id: '1', name: 'Alimentación', hiddenCategory: false },
            { id: '2', name: 'Quesos', hiddenCategory: true },
          ],
          [{ id: '3', name: 'Especial otoño', hiddenCategory: false }],
          [{ id: '3', name: 'Especial otoño', hiddenCategory: false }],
        ],
      },
      { row: emptyRow('1'), observedAt: OBSERVED_AT }
    );

    expect(product?.categoryPaths).toEqual([
      NEED_WORLD_QUESO,
      ['Alimentación', 'Quesos'],
      ['Especial otoño'],
    ]);
    expect(product?.categoryPathsStated).toBe(true);
  });

  it('keeps the readable paths of a list read in part, and says it did not state its paths', () => {
    const product = normalizeProduct(
      {
        keyfacts: { wonCategoryPrimary: NEED_WORLD_QUESO.join('/') },
        wonCategoryBreadcrumbs: [
          [{ id: '1', name: 'Alimentación', hiddenCategory: false }],
          [{ id: '4', name: '' }],
          'not a path',
        ],
      },
      { row: emptyRow('1'), observedAt: OBSERVED_AT }
    );

    expect(product?.categoryPaths).toEqual([
      NEED_WORLD_QUESO,
      ['Alimentación'],
    ]);
    // A part the code could not read may name a path a REPLACE would drop.
    expect(product?.categoryPathsStated).toBe(false);
  });

  it('says a path with one unreadable node was not read in full', () => {
    const product = normalizeProduct(
      {
        keyfacts: { wonCategoryPrimary: NEED_WORLD_QUESO.join('/') },
        wonCategoryBreadcrumbs: [
          [
            { id: '1', name: 'Alimentación' },
            { id: '2', title: 'Quesos' },
          ],
        ],
      },
      { row: emptyRow('1'), observedAt: OBSERVED_AT }
    );

    expect(product?.categoryPaths).toEqual([
      NEED_WORLD_QUESO,
      ['Alimentación'],
    ]);
    expect(product?.categoryPathsStated).toBe(false);
  });

  it('reads a list that is not empty and of which nothing is readable as no list', () => {
    // A renamed field: every node is of another shape.
    const product = normalizeProduct(
      {
        keyfacts: { wonCategoryPrimary: NEED_WORLD_QUESO.join('/') },
        wonCategoryBreadcrumbs: [
          [{ id: '1', label: 'Alimentación' }],
          [{ id: '2', label: 'Quesos' }],
        ],
      },
      {
        row: {
          ...emptyRow('1'),
          categoryBreadcrumbs: [['Hogar y decoración', 'Cocina']],
        },
        observedAt: OBSERVED_AT,
      }
    );

    // The row's list is the fall back, as for a page that prints none.
    expect(product?.categoryPaths).toEqual([
      NEED_WORLD_QUESO,
      ['Hogar y decoración', 'Cocina'],
    ]);
    expect(product?.categoryPathsStated).toBe(false);
  });

  it('reads an index row list of which nothing is readable as no list', () => {
    const row = normalizeListRow(
      { productId: '1' },
      { wonCategoryBreadcrumbs: [[{ id: '1', label: 'Cocina' }]] }
    );

    expect(row?.categoryBreadcrumbs).toBeNull();
  });

  it('says a page with a need world path and an empty list did not state its paths (owner decision 95b)', () => {
    const product = normalizeProduct(
      {
        keyfacts: { wonCategoryPrimary: NEED_WORLD_QUESO.join('/') },
        wonCategoryBreadcrumbs: [],
      },
      { row: emptyRow('1'), observedAt: OBSERVED_AT }
    );

    expect(product?.categoryPaths).toEqual([NEED_WORLD_QUESO]);
    // An empty list is not a statement: it cannot clear a stored path.
    expect(product?.categoryPathsStated).toBe(false);
  });

  it('says a page with a need world path and a real list read in full stated its paths', () => {
    const product = normalizeProduct(
      {
        keyfacts: { wonCategoryPrimary: NEED_WORLD_QUESO.join('/') },
        wonCategoryBreadcrumbs: [[{ id: '1', name: 'Alimentación' }]],
      },
      { row: emptyRow('1'), observedAt: OBSERVED_AT }
    );

    expect(product?.categoryPaths).toEqual([
      NEED_WORLD_QUESO,
      ['Alimentación'],
    ]);
    expect(product?.categoryPathsStated).toBe(true);
  });

  it('says a page whose list holds one empty breadcrumb did not state its paths', () => {
    const product = normalizeProduct(
      {
        keyfacts: { wonCategoryPrimary: NEED_WORLD_QUESO.join('/') },
        wonCategoryBreadcrumbs: [[]],
      },
      { row: emptyRow('1'), observedAt: OBSERVED_AT }
    );

    expect(product?.categoryPathsStated).toBe(false);
  });

  it('says a page that states no need world path did not state its paths', () => {
    const product = normalizeProduct(
      { keyfacts: {}, wonCategoryBreadcrumbs: [] },
      {
        row: { ...emptyRow('1'), categoryPath: NEED_WORLD_QUESO },
        observedAt: OBSERVED_AT,
      }
    );

    expect(product?.categoryPaths).toEqual([NEED_WORLD_QUESO]);
    expect(product?.categoryPathsStated).toBe(false);
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
