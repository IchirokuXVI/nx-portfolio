import { MercadonaClient } from './mercadona.client';

/**
 * The one opt in live test (plan 0038, section 9). **Never runs in CI**: it makes
 * real requests to a third party. It exists so a stale fixture says so, rather
 * than a shape change being discovered by a run that quietly stores nothing.
 *
 *   LUNA_LIVE_SOURCE_TEST=1 npx nx test luna-shopper/mercadona
 *
 * It asserts only that the field names still exist. It deliberately does not
 * assert a price, a product count or a category name: those change legitimately
 * every week, and a test that fails on the source doing its job gets disabled.
 */
const live = process.env['LUNA_LIVE_SOURCE_TEST'] === '1' ? describe : describe.skip;

const USER_AGENT =
  'LunaShopper/0.1 (+https://velista.app; personal price comparison; contact@velista.app)';

live('Mercadona, live', () => {
  jest.setTimeout(30_000);

  it('still answers a postal code with a warehouse header', async () => {
    const warehouse = await MercadonaClient.resolveWarehouse('14013', {
      userAgent: USER_AGENT,
    });
    expect(typeof warehouse).toBe('string');
    expect(warehouse.length).toBeGreaterThan(0);
  });

  it('still carries ean, brand and the price block on product detail', async () => {
    const warehouse = await MercadonaClient.resolveWarehouse('14013', {
      userAgent: USER_AGENT,
    });
    const client = new MercadonaClient({
      warehouse,
      userAgent: USER_AGENT,
      minIntervalMs: 250,
    });
    const raw = (await client.getProduct('4241')) as Record<string, unknown>;
    expect(raw).not.toBeNull();

    // The fields the whole plan rests on. `ean` and `brand` exist ONLY here,
    // which is why a discovery run pays one request per product.
    expect(Object.keys(raw)).toEqual(
      expect.arrayContaining(['id', 'ean', 'brand', 'display_name', 'price_instructions'])
    );
    const price = raw['price_instructions'] as Record<string, unknown>;
    expect(Object.keys(price)).toEqual(
      expect.arrayContaining([
        'unit_price',
        'bulk_price',
        'unit_size',
        'size_format',
        'reference_format',
      ])
    );
  });
});
