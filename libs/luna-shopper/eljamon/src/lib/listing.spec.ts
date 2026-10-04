import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ELJAMON_PAGE_SIZE,
  pageCountOf,
  parseListingPage,
  parseTopCategories,
} from './listing';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

const first = parseListingPage(fixture('category-page-1.html'));
const second = parseListingPage(fixture('category-page-2.html'));

describe('parseListingPage', () => {
  it('reads the 20 rows of a page and the printed article count', () => {
    expect(first.rows).toHaveLength(ELJAMON_PAGE_SIZE);
    expect(first.articleCount).toBeGreaterThan(ELJAMON_PAGE_SIZE);
  });

  it('reads the filters JSON, decoded, with the page it belongs to', () => {
    const filters = JSON.parse(first.filters ?? '{}') as Record<
      string,
      unknown
    >;
    expect(filters).toMatchObject({
      categoryCode: '04',
      page: 1,
      pageSize: 20,
    });
  });

  it('reads page 2 as other products, which is what the filters POST is for', () => {
    expect(second.rows).toHaveLength(ELJAMON_PAGE_SIZE);
    const codes = new Set(first.rows.map((row) => row.code));
    expect(second.rows.some((row) => codes.has(row.code))).toBe(false);
  });

  it('reads a row that is not on offer', () => {
    const row = first.rows.find(
      (candidate) => candidate.previousPrice === null
    );
    expect(row).toBeDefined();
    expect(row?.price).toEqual(expect.any(Number));
    expect(row?.unitPrice).toEqual(expect.any(Number));
    expect(row?.url).toMatch(
      new RegExp(
        `^https://www\\.supermercadoseljamon\\.com/detalle/-/Producto/.+/${row?.code}$`
      )
    );
  });

  it('reads a row on offer: the struck through price and the current one', () => {
    const row = first.rows.find(
      (candidate) => candidate.previousPrice !== null
    );
    expect(row).toBeDefined();
    expect(row?.previousPrice).toBeGreaterThan(row?.price ?? Infinity);
  });

  it('reads a row sold by weight, priced per kilo', () => {
    const row = first.rows.find((candidate) =>
      candidate.description.endsWith(', kg')
    );
    expect(row?.unitPriceLabel).toBe('Kilo');
    expect(row?.unitPrice).toBe(row?.price);
  });

  it('reads the brand, and the unit label verbatim', () => {
    expect(first.rows.every((row) => row.brand !== '')).toBe(true);
    const labels = new Set(first.rows.map((row) => row.unitPriceLabel));
    expect([...labels]).toEqual(expect.arrayContaining(['Kilo', '100gr']));
  });

  it('reads a printed word that is never a brand as no brand (plan 0178)', () => {
    const rowPrinting = (brand: string) =>
      parseListingPage(
        `<div id="x_articulo_1" class="articulo"><p class="marca">${brand}</p>` +
          '<p class="nombre"> <a href="/detalle/-/Producto/queso-azul/1">' +
          ' queso azul, 200g </a> </p><p class="precio"> <span>3,49 €</span>' +
          ' </p></div>'
      ).rows[0];

    expect(rowPrinting('D.O.P.').brand).toBeNull();
    expect(rowPrinting('I.G.P.').brand).toBeNull();
    expect(rowPrinting('NAVIDAD').brand).toBeNull();
    expect(rowPrinting('DOÑA ANA').brand).toBe('DOÑA ANA');
  });

  it('parses a page with no rows as zero rows', () => {
    expect(parseListingPage('<html></html>')).toEqual({
      articleCount: null,
      filters: null,
      rows: [],
    });
  });

  it('reads a price with a non breaking space before the euro sign', () => {
    const html =
      '<div id="x_articulo_1" class="articulo"><p class="marca">DOÑA ANA</p>' +
      '<p class="nombre"> <a href="/detalle/-/Producto/arroz-bomba-1kg/1">' +
      ' arroz bomba, 1kg </a> </p><p class="precio"> <span class="tachado">' +
      '3,99\u00a0€</span> <span>3,49\u00a0€</span> </p>' +
      '<div class="texto-porKilo"> 3,49\u00a0€/Kilo </div></div>';
    expect(parseListingPage(html).rows).toEqual([
      {
        code: '1',
        description: 'arroz bomba, 1kg',
        brand: 'DOÑA ANA',
        url: '/detalle/-/Producto/arroz-bomba-1kg/1',
        price: 3.49,
        previousPrice: 3.99,
        unitPrice: 3.49,
        unitPriceLabel: 'Kilo',
      },
    ]);
  });
});

describe('pageCountOf', () => {
  it('counts pages of 20, and one page when nothing was printed', () => {
    expect(pageCountOf(1039)).toBe(52);
    expect(pageCountOf(20)).toBe(1);
    expect(pageCountOf(null)).toBe(1);
  });
});

describe('parseTopCategories', () => {
  it('reads the eleven top level categories of the home page', () => {
    const categories = parseTopCategories(fixture('home.html'));
    expect(categories).toHaveLength(11);
    expect(categories[0]).toEqual({
      code: '01',
      slug: 'la-despensa',
      name: 'DESPENSA',
      path: '/categorias/la-despensa/01',
    });
    expect(categories.map((category) => category.code)).toEqual([
      '01',
      '02',
      '03',
      '04',
      '05',
      '06',
      '07',
      '08',
      '09',
      '10',
      '11',
    ]);
  });
});
