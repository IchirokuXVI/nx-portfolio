import { ElJamonClient } from './eljamon.client';

/**
 * The one opt in live test (plan 0169, section 9). **Never runs in CI**: it
 * makes real requests to a third party. It exists so a stale fixture says so,
 * rather than a markup change being discovered by a run that quietly stores
 * nothing.
 *
 *   LUNA_LIVE_SOURCE_TEST=1 npx nx test luna-shopper/eljamon
 *
 * It asserts **field names only, never values**. Prices and the assortment
 * move every week, so a test that asserted either would fail on the source
 * doing its job.
 */
const live =
  process.env['LUNA_LIVE_SOURCE_TEST'] === '1' ? describe : describe.skip;

const USER_AGENT =
  'LunaShopper/0.1 (+https://velista.app; personal price comparison; contact@velista.app)';

live('El Jamón, live', () => {
  jest.setTimeout(60_000);

  const client = new ElJamonClient({
    userAgent: USER_AGENT,
    minIntervalMs: 750,
  });

  it('still starts a session and lists the top level categories', async () => {
    const categories = await client.topCategories();
    expect(categories.length).toBeGreaterThan(0);
    expect(Object.keys(categories[0])).toEqual(
      expect.arrayContaining(['code', 'slug', 'name', 'path'])
    );
  });

  it('still prints a priced listing row and a product page with JSON-LD', async () => {
    const [category] = await client.topCategories();
    let first = null;
    for await (const row of client.walkCategory(category)) {
      first = row;
      break;
    }
    expect(first).not.toBeNull();
    expect(Object.keys(first ?? {})).toEqual(
      expect.arrayContaining(['code', 'description', 'brand', 'url', 'price'])
    );
    expect(first?.price).toEqual(expect.any(Number));

    const product = await client.getProduct(first?.url ?? '');
    expect(product).not.toBeNull();
    expect(Object.keys(product ?? {})).toEqual(
      expect.arrayContaining(['code', 'name', 'brand', 'price', 'categoryPath'])
    );
  });

  it('still answers the store locator with shops that carry a postal code', async () => {
    const list = await client.listStores();
    expect(list.stores.length).toBeGreaterThan(0);
    expect(Object.keys(list.stores[0])).toEqual(
      expect.arrayContaining([
        'externalRef',
        'postalCode',
        'latitude',
        'street',
      ])
    );
  });
});
