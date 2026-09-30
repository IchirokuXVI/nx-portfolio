import { shopMapPath, shopPagePath } from './shop-paths';

/** Velista `0121`: where a shop's pages live, under either mount. */
describe('shop paths', () => {
  it('addresses a shop’s own page', () => {
    expect(shopPagePath('en', '', 'loc-1')).toBe('/en/shops/loc-1');
    expect(shopPagePath('es', '/velista', 'loc-1')).toBe(
      '/velista/es/shops/loc-1'
    );
  });

  it('addresses its map, with the basket it counts from when there is one', () => {
    expect(shopMapPath('en', '', 'loc-1')).toBe('/en/shops/loc-1/map');
    expect(shopMapPath('en', '', 'loc-1', 'live')).toBe(
      '/en/shops/loc-1/map?basket=live'
    );
  });
});
