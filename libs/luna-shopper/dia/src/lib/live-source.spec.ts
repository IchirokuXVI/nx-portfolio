import { DiaClient } from './dia.client';

/**
 * The one opt in live test (plan 0174, section 11). **Never runs in CI**: it
 * makes real requests to a third party. It exists so a stale fixture says so,
 * rather than a change of the JSON being discovered by a run that quietly
 * stores nothing.
 *
 *   LUNA_LIVE_SOURCE_TEST=1 npx nx test luna-shopper/dia
 *
 * It asserts **field names only, never values**. Prices and the assortment
 * move every week, so a test that asserted either would fail on the source
 * doing its job. Seven requests, 750 ms apart.
 */
const live =
  process.env['LUNA_LIVE_SOURCE_TEST'] === '1' ? describe : describe.skip;

live('DIA, live', () => {
  jest.setTimeout(60_000);

  const client = new DiaClient({ minIntervalMs: 750 });

  it('still answers the menu and a priced listing row', async () => {
    const menu = await client.menu();
    expect(menu.leaves.length).toBeGreaterThan(0);
    expect(Object.keys(menu.leaves[0])).toEqual(
      expect.arrayContaining(['id', 'name', 'path', 'rootId', 'rootName'])
    );

    const page = await client.listing(menu.leaves[0].path);
    expect(page.rows.length).toBeGreaterThan(0);
    expect(Object.keys(page.rows[0])).toEqual(
      expect.arrayContaining([
        'skuId',
        'displayName',
        'brand',
        'url',
        'prices',
        'unitsInStock',
      ])
    );
    expect(Object.keys(page.rows[0].prices ?? {})).toEqual(
      expect.arrayContaining([
        'price',
        'strikethroughPrice',
        'pricePerUnit',
        'measureUnit',
        'isClubPrice',
        'isPromoPrice',
      ])
    );
  });

  it('still names the store of the anonymous session', async () => {
    const anonymous = await client.anonymousStore();
    expect(anonymous.postalCode).toEqual(expect.any(String));
    expect(anonymous.storeCode).toEqual(expect.any(String));
  });

  it('still publishes the shop file and a shop detail with a postal code', async () => {
    const file = await client.storeFile();
    expect(file.stores.length).toBeGreaterThan(0);
    expect(Object.keys(file.stores[0])).toEqual(
      expect.arrayContaining([
        'idTienda',
        'codigoTienda',
        'provinceCode',
        'latitude',
        'longitude',
      ])
    );

    const detail = await client.storeDetail(file.stores[0].idTienda);
    expect(Object.keys(detail ?? {})).toEqual(
      expect.arrayContaining(['storeCode', 'postalCode', 'street', 'hours'])
    );
  });
});
