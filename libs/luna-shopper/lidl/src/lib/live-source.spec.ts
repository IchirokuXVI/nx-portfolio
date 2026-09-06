import { LidlClient } from './lidl.client';

/**
 * The one opt in live test (plan 0089, section 12). **Never runs in CI**: it
 * makes real requests to a third party. It exists so a stale fixture says so,
 * rather than a shape change being discovered by a run that quietly stores
 * nothing.
 *
 *   LUNA_LIVE_SOURCE_TEST=1 npx nx test luna-shopper/lidl
 *
 * It asserts **field names only, never values**. The assortment is a rolling
 * window and a price expires every Sunday, so a test that asserted either would
 * fail on the source doing its job, and a test that does that gets disabled.
 */
const live =
  process.env['LUNA_LIVE_SOURCE_TEST'] === '1' ? describe : describe.skip;

const USER_AGENT =
  'LunaShopper/0.1 (+https://velista.app; personal price comparison; contact@velista.app)';

live('LIDL, live', () => {
  jest.setTimeout(60_000);

  const client = new LidlClient({ userAgent: USER_AGENT, minIntervalMs: 700 });

  it('still answers the in-store index with rows that carry an id', async () => {
    const page = (await client.captureSearchPage(0)) as Record<string, unknown>;

    expect(Object.keys(page)).toEqual(
      expect.arrayContaining(['numFound', 'offset', 'fetchsize', 'items'])
    );
    const rows = page['items'] as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    const data = (rows[0]['gridbox'] as Record<string, unknown>)['data'];
    expect(Object.keys(data as object)).toEqual(
      expect.arrayContaining(['productId', 'category', 'canonicalPath', 'price'])
    );
  });

  it('still carries eans and the region price map on a product page', async () => {
    const rows: Array<{ path: string | null; externalId: string }> = [];
    for await (const row of client.walkInStore()) {
      rows.push(row);
      if (rows.length >= 1) {
        break;
      }
    }
    const product = await client.getProduct(rows[0] as never);

    // The two fields that make a request per product worth paying for. They
    // exist only on the page, never in the index.
    expect(product).not.toBeNull();
    expect(product).toHaveProperty('prices');
    expect(product).toHaveProperty('ean');
    expect(product).toHaveProperty('inStore');
  });

  it('still names a price region on every store it returns', async () => {
    const page = (await client.captureStorePage(5)) as Record<string, unknown>;
    const stores = page['items'] as Array<Record<string, unknown>>;

    expect(stores.length).toBeGreaterThan(0);
    for (const store of stores) {
      expect(Object.keys(store)).toEqual(
        expect.arrayContaining(['objectNumber', 'address', 'marketingData'])
      );
      const marketing = store['marketingData'] as Record<string, unknown>;
      // Section 4.1 rests on this being present with no gaps: a shop states its
      // own region, so nothing derives one from a postal code.
      expect(marketing['offerRegion']).toBeDefined();
    }
  });
});
