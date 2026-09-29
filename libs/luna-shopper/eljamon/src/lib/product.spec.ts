import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBreadcrumb, parseProductPage } from './product';

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

  it('answers null for a page with no product JSON-LD, and does not throw', () => {
    expect(parseProductPage(fixture('home.html'))).toBeNull();
    expect(
      parseProductPage('<script type="application/ld+json">{oops</script>')
    ).toBeNull();
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
