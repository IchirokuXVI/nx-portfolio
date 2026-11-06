import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SourceCatalogEntry, SupermarketSource } from '../entities';
import {
  fetchLidl,
  fetchMercadona,
  isRefusal,
  PRICE_REFRESH_FETCHERS,
  type RefreshFetchRequest,
} from './price-refresh.fetchers';

/**
 * The two fetchers of plan 0216, section 6, against the fixtures their
 * libraries already commit, with no network: the fetch is a stub that answers
 * the recorded payload and records each URL it was asked.
 *
 * The fixtures are read as files rather than imported, so this spec reaches
 * into no other project's sources: it reads the bytes the source sent, which
 * is what the libraries assert their parsers against too.
 */

const WORKSPACE = join(__dirname, '..', '..', '..', '..', '..', '..');
const fixture = (library: string, name: string): unknown =>
  JSON.parse(
    readFileSync(
      join(
        WORKSPACE,
        'libs',
        'luna-shopper',
        library,
        'src',
        'lib',
        '__fixtures__',
        name
      ),
      'utf8'
    )
  );

function stub(answer: (url: string) => { status: number; body: string }) {
  const urls: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    const url = String(input);
    urls.push(url);
    const { status, body } = answer(url);
    return new Response(status === 404 || status === 403 ? 'no' : body, {
      status,
    });
  }) as unknown as typeof fetch;
  return { urls, fetchImpl };
}

const entry = (over: Partial<SourceCatalogEntry>): SourceCatalogEntry =>
  ({
    id: 'entry-1',
    externalId: '4241',
    name: 'A product',
    brand: null,
    sizeFormat: null,
    url: null,
    ...over,
  }) as SourceCatalogEntry;

const request = (
  over: Partial<RefreshFetchRequest> & Pick<RefreshFetchRequest, 'fetchImpl'>
): RefreshFetchRequest => ({
  entry: entry({}),
  source: { config: {} } as unknown as SupermarketSource,
  fetchKey: '4661',
  signal: new AbortController().signal,
  userAgent: 'LunaShopperTest/1.0',
  mercadonaBaseUrl: 'https://fixtures.test/api',
  ...over,
});

describe('price refresh fetchers (plan 0216, section 6)', () => {
  it('has one fetcher for each adapter that refreshes one product', () => {
    expect(Object.keys(PRICE_REFRESH_FETCHERS).sort()).toEqual([
      'lidl-api',
      'mercadona-api',
    ]);
  });

  describe('Mercadona', () => {
    it('reads one detail for the warehouse, in one request', async () => {
      const detail = JSON.stringify(
        fixture('mercadona', 'product-detail-es.json')
      );
      const { urls, fetchImpl } = stub(() => ({ status: 200, body: detail }));
      const read = await fetchMercadona(request({ fetchImpl }));

      expect(urls).toEqual([
        'https://fixtures.test/api/products/4241/?lang=es&wh=4661',
      ]);
      expect(read.found).toBe(true);
      if (!read.found) return;
      expect(read.observation).toMatchObject({
        externalId: '4241',
        detailFetched: false,
        soldByWeight: false,
      });
      expect(read.observation.prices).toEqual([
        {
          scopeKey: '4661',
          price: 8.75,
          currency: 'EUR',
          unitPrice: 8.75,
          unitPriceLabel: expect.anything(),
          validFrom: null,
          validUntil: null,
        },
      ]);
    });

    it('prices a product sold by weight by the kilo, as the listing does', async () => {
      const detail = JSON.stringify(
        fixture('mercadona', 'product-approximate-weight.json')
      );
      const { fetchImpl } = stub(() => ({ status: 200, body: detail }));
      const read = await fetchMercadona(
        request({ fetchImpl, entry: entry({ externalId: '50946' }) })
      );
      expect(read.found).toBe(true);
      if (!read.found) return;
      expect(read.observation.soldByWeight).toBe(true);
      // `bulk_price`, never the estimated piece price of 14.49.
      expect(read.observation.prices[0].price).toBe(9.41);
    });

    it('answers not stocked for a 404', async () => {
      const { urls, fetchImpl } = stub(() => ({ status: 404, body: '' }));
      expect(await fetchMercadona(request({ fetchImpl }))).toEqual({
        found: false,
      });
      expect(urls).toHaveLength(1);
    });

    it('throws a refusal for a 403, and asks once', async () => {
      const { urls, fetchImpl } = stub(() => ({ status: 403, body: '' }));
      const error = await fetchMercadona(request({ fetchImpl })).catch(
        (thrown: unknown) => thrown
      );
      expect(isRefusal(error)).toBe(true);
      expect(urls).toHaveLength(1);
    });
  });

  describe('LIDL', () => {
    const page = `<!DOCTYPE html><html><body><script type="application/json" id="__NUXT_DATA__">${JSON.stringify(
      fixture('lidl', 'product-short-code.json')
    )}</script></body></html>`;
    const grapes = entry({
      externalId: '11029954',
      name: 'Uva blanca sabores sin semillas',
      url: 'https://www.lidl.es/p/uva-blanca-sabores-sin-semillas/p11029954',
    });

    it('reads the page by the path of the stored address, in one request', async () => {
      const { urls, fetchImpl } = stub(() => ({ status: 200, body: page }));
      const read = await fetchLidl(
        request({ fetchImpl, entry: grapes, fetchKey: '27' })
      );

      expect(urls).toEqual([
        'https://www.lidl.es/p/uva-blanca-sabores-sin-semillas/p11029954',
      ]);
      expect(read.found).toBe(true);
      if (!read.found) return;
      // Every region the page names, each its own scope key, verbatim.
      const keys = read.observation.prices.map((price) => price.scopeKey);
      expect(keys).toContain('27');
      expect(keys.length).toBeGreaterThan(1);
      for (const price of read.observation.prices) {
        expect(price).toMatchObject({
          price: 1.69,
          currency: 'EUR',
          unitPrice: null,
          unitPriceLabel: null,
        });
      }
      // The page has no field for it, so the row keeps its own (plan 0181).
      expect(read.observation.soldByWeight).toBeUndefined();
    });

    it('reads the base URL from the chain row', async () => {
      const { urls, fetchImpl } = stub(() => ({ status: 200, body: page }));
      await fetchLidl(
        request({
          fetchImpl,
          entry: entry({
            ...grapes,
            url: 'https://lidl.fixtures.test/p/uva/p11029954',
          }),
          source: {
            config: { baseUrl: 'https://lidl.fixtures.test/' },
          } as unknown as SupermarketSource,
        })
      );
      expect(urls).toEqual(['https://lidl.fixtures.test/p/uva/p11029954']);
    });

    it('answers not stocked for a 404, and for a row with no address', async () => {
      const { urls, fetchImpl } = stub(() => ({ status: 404, body: '' }));
      expect(await fetchLidl(request({ fetchImpl, entry: grapes }))).toEqual({
        found: false,
      });
      expect(
        await fetchLidl(request({ fetchImpl, entry: entry({ url: null }) }))
      ).toEqual({ found: false });
      expect(urls).toHaveLength(1);
    });

    it('throws a refusal for a 403', async () => {
      const { fetchImpl } = stub(() => ({ status: 403, body: '' }));
      const error = await fetchLidl(
        request({ fetchImpl, entry: grapes })
      ).catch((thrown: unknown) => thrown);
      expect(isRefusal(error)).toBe(true);
    });
  });

  it('does not take any other error for a refusal', () => {
    expect(isRefusal(new Error('socket hang up'))).toBe(false);
  });
});
