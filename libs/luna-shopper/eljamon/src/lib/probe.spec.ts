import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { probeElJamon } from './probe';

/**
 * The El Jamón probe against the committed pages and a fake site (plan 0219,
 * Tests). Nothing here touches the network.
 */

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

const LOCATOR = 'https://locator.example/admin-ajax.php';

type Route = (url: URL) => { status?: number; body: string } | undefined;

function fakeSite(override: Route = () => undefined) {
  const urls: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    const url = new URL(String(input));
    urls.push(url.toString());
    const answer = override(url) ?? storefront(url);
    return new Response(answer.body, { status: answer.status ?? 200 });
  }) as typeof fetch;
  return { fetchImpl, urls };
}

function storefront(url: URL): { status?: number; body: string } {
  if (url.toString().startsWith(LOCATOR)) {
    return { body: fixture('stores.html') };
  }
  if (url.pathname === '/') {
    return { body: fixture('home.html') };
  }
  if (url.pathname.startsWith('/delegate/seleccionarCodPostal')) {
    return { body: '' };
  }
  if (url.pathname.startsWith('/categorias/')) {
    return { body: fixture('category-page-1.html') };
  }
  if (url.pathname.startsWith('/detalle/')) {
    return { body: fixture('product.html') };
  }
  return { status: 404, body: '' };
}

/** Page 1 of the fixture, whose first `lost` articles print no price. */
function listingWithout(lost: number): string {
  const page = fixture('category-page-1.html');
  const starts = [
    ...page.matchAll(/<div id="[^"]*_articulo_\d+" class="articulo">/g),
  ].map((match) => match.index ?? 0);
  if (starts.length < 10) {
    throw new Error('The listing fixture holds fewer than ten articles.');
  }
  const blocks = starts.map((at, n) => page.slice(at, starts[n + 1]));
  return (
    page.slice(0, starts[0]) +
    blocks
      .map((block, n) =>
        n < lost
          ? block.replace(/<p class="precio">/g, '<p class="sin-precio">')
          : block
      )
      .join('')
  );
}

const run = (fetchImpl: typeof fetch) =>
  probeElJamon({
    userAgent: 'LunaShopperTest/1.0',
    locatorUrl: LOCATOR,
    fetchImpl,
    sleepImpl: async () => undefined,
  });

describe('probeElJamon', () => {
  it('passes every step over the fixtures, in five requests', async () => {
    const { fetchImpl, urls } = fakeSite();

    const result = await run(fetchImpl);

    expect(result.steps.map((step) => [step.name, step.ok])).toEqual([
      ['categories', true],
      ['listing', true],
      ['product', true],
      ['shops', true],
    ]);
    expect(result.requests).toBe(5);
    expect(urls).toHaveLength(5);
    expect(result.steps[0].sample['categories']).toBe(11);
  });

  it('names a field the product page lost and makes no later request', async () => {
    // The JSON-LD block is where the product page prints its price.
    const stripped = fixture('product.html').replace(
      /"price"\s*:\s*"?[\d.,]+"?/g,
      '"cost": 0'
    );
    const { fetchImpl, urls } = fakeSite((url) =>
      url.pathname.startsWith('/detalle/') ? { body: stripped } : undefined
    );

    const result = await run(fetchImpl);

    expect(result.steps).toHaveLength(3);
    expect(result.steps[2].ok).toBe(false);
    expect(result.steps[2].problems.join(' ')).toContain('price');
    expect(urls.some((url) => url.startsWith(LOCATOR))).toBe(false);
  });

  it('stops at a 403 on the first step with no second request', async () => {
    const { fetchImpl, urls } = fakeSite(() => ({ status: 403, body: '' }));

    const result = await run(fetchImpl);

    expect(result.steps).toEqual([
      expect.objectContaining({
        name: 'categories',
        ok: false,
        httpStatus: 403,
      }),
    ]);
    expect(urls).toHaveLength(1);
  });

  it('reads an empty listing as a change of shape, and makes no request for page 2', async () => {
    const { fetchImpl, urls } = fakeSite((url) =>
      url.pathname.startsWith('/categorias/')
        ? { body: '<html><body>nothing here</body></html>' }
        : undefined
    );

    const result = await run(fetchImpl);

    expect(result.steps[1]).toEqual(
      expect.objectContaining({
        name: 'listing',
        ok: false,
        problems: ['no rows were read'],
      })
    );
    expect(urls).toHaveLength(3);
  });

  it('fails the 80 per cent rule when most rows lost their price', async () => {
    const { fetchImpl, urls } = fakeSite((url) =>
      url.pathname.startsWith('/categorias/')
        ? { body: listingWithout(12) }
        : undefined
    );

    const result = await run(fetchImpl);

    expect(result.steps[1]).toEqual(
      expect.objectContaining({
        name: 'listing',
        ok: false,
        problems: ['8 of 20 rows carried a price above zero'],
      })
    );
    expect(urls).toHaveLength(3);
  });

  it('passes the 80 per cent rule when a few rows lost their price', async () => {
    const { fetchImpl } = fakeSite((url) =>
      url.pathname.startsWith('/categorias/')
        ? { body: listingWithout(2) }
        : undefined
    );

    const result = await run(fetchImpl);

    expect(result.steps[1]).toEqual(
      expect.objectContaining({ name: 'listing', ok: true })
    );
    expect(result.steps[1].sample['rows']).toBe(20);
    expect(result.steps.every((step) => step.ok)).toBe(true);
  });

  it('reads a locator page with no locations object as a problem', async () => {
    const { fetchImpl, urls } = fakeSite((url) =>
      url.toString().startsWith(LOCATOR)
        ? { body: '<html><body>Mapa</body></html>' }
        : undefined
    );

    const result = await run(fetchImpl);

    expect(result.steps[3]).toEqual(
      expect.objectContaining({
        name: 'shops',
        ok: false,
        httpStatus: null,
        error: null,
        problems: [
          'The El Jamón store locator answered without a locations object.',
        ],
      })
    );
    expect(result.failure).toBeUndefined();
    expect(urls).toHaveLength(5);
  });
});
