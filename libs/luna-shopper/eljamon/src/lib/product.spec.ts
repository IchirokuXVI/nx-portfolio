import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseListingPage } from './listing';
import {
  parseBreadcrumb,
  parseProductPage,
  sessionPartsDisagree,
} from './product';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

describe('parseProductPage', () => {
  const html = fixture('product.html');
  const product = parseProductPage(html);

  it('reads the JSON-LD although its availability is single quoted', () => {
    expect(html).toMatch(/"availability":\s*'InStock'/);
    expect(product).toMatchObject({
      code: expect.stringMatching(/^\d+$/),
      name: expect.stringContaining(','),
      brand: expect.any(String),
      price: expect.any(Number),
      image: expect.stringMatching(/^https:\/\//),
    });
  });

  it('reads the breadcrumb without Inicio and without the product', () => {
    expect(product?.categoryPath[0]).toBe('Frescos');
    expect(product?.categoryPath).not.toContain('Inicio');
    expect(product?.categoryPath).not.toContain(product?.name);
  });

  it('leaves a double quoted value alone although it holds a colon and a quote', () => {
    const page =
      '<script type="application/ld+json">{"@type": "Product", ' +
      `"name": "Jamón: 'el bueno', 100 g", "sku": "7", ` +
      `"offers": {"price": "2.5", "availability": 'InStock'}}</script>`;

    expect(parseProductPage(page)).toMatchObject({
      code: '7',
      name: "Jamón: 'el bueno', 100 g",
      price: 2.5,
    });
  });

  it('reads a printed word that is never a brand as no brand (plan 0178)', () => {
    const pagePrinting = (brand: string) =>
      parseProductPage(
        '<script type="application/ld+json">{"@type": "Product", ' +
          `"name": "queso azul, 200 g", "sku": "7", "brand": {"name": "${brand}"}, ` +
          `"offers": {"price": "2.5"}}</script>`
      );

    expect(pagePrinting('D.O.P.')?.brand).toBeNull();
    expect(pagePrinting('IGP')?.brand).toBeNull();
    expect(pagePrinting('DOÑA ANA')?.brand).toBe('DOÑA ANA');
  });

  it('answers null for a page with no product JSON-LD, and does not throw', () => {
    expect(parseProductPage(fixture('home.html'))).toBeNull();
    expect(
      parseProductPage('<script type="application/ld+json">{oops</script>')
    ).toBeNull();
  });
});

describe('a page whose session drew its breadcrumb for another product (plan 0169, notes of 2026-11-25)', () => {
  const clean = fixture('product.html');
  // Another product of the same capture: the first row of page 2 of Frescos.
  const other = parseListingPage(fixture('category-page-2.html')).rows[0];

  /**
   * CONSTRUCTED, not captured: `product.html` with its breadcrumb and its
   * `page-act` heading replaced by another product's, which is what the shop
   * answered to three concurrent requests in one session on 2026-11-25. It
   * mirrors the saved proof page `17-s3-par1-york.html`, whose JSON-LD,
   * `<title>` and `tituloProducto` heading are "fiambre york maxi, 450g" and
   * whose breadcrumb and first `<h1>` are "tortas de aceite con canela 4ud,
   * 120g". No fixture is edited: the page is built here from the clean one.
   */
  function contaminatedPage(): string {
    const breadcrumb =
      '<ul class="breadcrumbs lfr-component migas-custom">' +
      '<li class="first"><span><a href="/">Inicio</a></span></li>' +
      '<li ><span><a href="/c/04">Frescos</a></span><div class="separatore">.</div></li>' +
      '<li ><span><a href="/c/0402">Charcutería envasada</a></span><div class="separatore">.</div></li>' +
      `<li class="last"> <span> <a href="#">${other.description}</a> </span> </li></ul>`;
    const page = clean
      .replace(
        /<ul class="breadcrumbs[^"]*migas-custom[^"]*">[\s\S]*?<\/ul>/,
        breadcrumb
      )
      .replace(
        /(<div class="page-act">\s*<h1[^>]*>)[\s\S]*?(<\/h1>)/,
        `$1${other.description}$2`
      );
    // The construction changed both parts, and nothing else.
    expect(page).not.toBe(clean);
    expect(page).toContain(`<h1>${other.description}</h1>`);
    return page;
  }

  it('reads a clean page as clean, with its breadcrumb', () => {
    const product = parseProductPage(clean);
    expect(product?.contaminated).toBe(false);
    expect(product?.categoryPath.length).toBeGreaterThan(0);
    expect(sessionPartsDisagree(clean, product?.name ?? '')).toBe(false);
  });

  it('marks the page, answers no breadcrumb, and keeps every field of the JSON-LD', () => {
    const cleanProduct = parseProductPage(clean);
    const product = parseProductPage(contaminatedPage());

    expect(other.description).not.toBe(cleanProduct?.name);
    expect(product).toEqual({
      ...cleanProduct,
      categoryPath: [],
      contaminated: true,
    });
  });

  it('marks the page when only one of the two parts names another product', () => {
    const name = parseProductPage(clean)?.name ?? '';
    const headingOnly = clean.replace(
      /(<div class="page-act">\s*<h1[^>]*>)[\s\S]*?(<\/h1>)/,
      `$1${other.description}$2`
    );
    const breadcrumbOnly = clean.replace(
      /(<li class="last">[\s\S]*?<a href="#">)[\s\S]*?(<\/a>)/,
      `$1${other.description}$2`
    );
    expect(sessionPartsDisagree(headingOnly, name)).toBe(true);
    expect(sessionPartsDisagree(breadcrumbOnly, name)).toBe(true);
  });

  it('reads case, spaces, a separator dot and a twice encoded entity as the same name', () => {
    // The `<h1>` of the saved page `24-rand-17022371.html` prints
    // `0&amp;#37;` where the JSON-LD prints `0%`.
    const page =
      '<ul class="breadcrumbs lfr-component migas-custom">' +
      '<li class="first"><span><a href="/">Inicio</a></span></li>' +
      '<li ><span><a href="#">Lácteos</a></span></li>' +
      '<li class="last"> <span> <a href="#">Yogur  desnatado natural 0&#37;, pk-4 .</a> </span> </li></ul>' +
      '<div class="page-act">\n\t<h1>yogur desnatado natural 0&amp;#37;, pk-4</h1>\n</div>';
    expect(sessionPartsDisagree(page, 'yogur desnatado natural 0%, pk-4')).toBe(
      false
    );
  });

  it('finds no disagreement on a page that carries neither part', () => {
    expect(sessionPartsDisagree('<p></p>', 'anything, 1kg')).toBe(false);
  });
});

describe('a page that states another product code than the one asked (plan 0169, notes of 2026-11-26)', () => {
  const clean = fixture('product.html');
  const ownCode = /"sku":\s*"(\d+)"/.exec(clean)?.[1] ?? '';

  it('reads the captured page as its own product when its code is the asked one', () => {
    expect(ownCode).toMatch(/^\d+$/);
    const product = parseProductPage(clean, ownCode);
    expect(product?.otherProductCode).toBeNull();
    expect(product?.categoryPath.length).toBeGreaterThan(0);
  });

  it('names the code the page states, and answers no breadcrumb', () => {
    const product = parseProductPage(clean, '30050107');
    expect(product).toMatchObject({
      code: ownCode,
      otherProductCode: ownCode,
      categoryPath: [],
      // The session parts agree with the JSON-LD: this is a whole page of
      // another product, not a contaminated one.
      contaminated: false,
    });
  });

  it('reads the code from the JSON-LD url when the page states no sku', () => {
    const page =
      '<script type="application/ld+json">{"@type": "Product", ' +
      '"name": "palomitas saladas, 80g", ' +
      '"url": "https://www.supermercadoseljamon.com/detalle/-/Producto/palomitas-saladas-80g/33002037"' +
      '}</script>';
    expect(parseProductPage(page, '33002037')?.otherProductCode).toBeNull();
    expect(parseProductPage(page, '33005473')?.otherProductCode).toBe(
      '33002037'
    );
  });

  it('does not mark a page that states no code at all, and reads it as the asked code', () => {
    const page =
      '<script type="application/ld+json">{"@type": "Product", ' +
      '"name": "palomitas saladas, 80g"}</script>';
    expect(parseProductPage(page, '33002037')).toMatchObject({
      code: '33002037',
      otherProductCode: null,
    });
    // Asked for nothing, such a page is still no product, as before.
    expect(parseProductPage(page)).toBeNull();
  });

  it('marks nothing when no code was asked for', () => {
    expect(parseProductPage(clean)?.otherProductCode).toBeNull();
  });
});

describe('parseBreadcrumb', () => {
  it('reads every level between the first and the last item', () => {
    const html =
      '<ul class="breadcrumbs lfr-component migas-custom">' +
      '<li class="first"><span><a href="/">Inicio</a></span></li>' +
      '<li ><span><a href="/c/01">La despensa</a></span><div class="separatore">.</div></li>' +
      '<li ><span><a href="/c/0107">Aperitivos y snacks</a></span></li>' +
      '<li class="last"><span><a href="#">guindillas, 130g</a></span></li></ul>';
    expect(parseBreadcrumb(html)).toEqual([
      'La despensa',
      'Aperitivos y snacks',
    ]);
  });

  it('answers an empty path for a page with no breadcrumb', () => {
    expect(parseBreadcrumb('<p></p>')).toEqual([]);
  });
});
