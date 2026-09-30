import {
  mappingSettingsPath,
  shopMapPath,
  shopPagePath,
  shopWalkPath,
  shopWalksPath,
} from './shop-paths';

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

  it('addresses a shop’s walks and each walk’s pages (velista 0122)', () => {
    expect(shopWalksPath('en', '', 'loc-1')).toBe('/en/shops/loc-1/walks');
    expect(mappingSettingsPath('en', '/velista', 'loc-1')).toBe(
      '/velista/en/shops/loc-1/walks/settings'
    );
    expect(shopWalkPath('en', '', 'loc-1', 'w-1')).toBe(
      '/en/shops/loc-1/walks/w-1'
    );
    expect(shopWalkPath('en', '', 'loc-1', 'w-1', 'rewind')).toBe(
      '/en/shops/loc-1/walks/w-1/rewind'
    );
    expect(shopWalkPath('en', '', 'loc-1', 'w-1', 'record')).toBe(
      '/en/shops/loc-1/walks/w-1/record'
    );
  });
});
