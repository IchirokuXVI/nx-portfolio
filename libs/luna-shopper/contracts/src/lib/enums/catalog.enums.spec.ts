import { DEFAULT_SCOPE_PRIORITY, PriceScopeKind } from './catalog.enums';

/**
 * The four tiers (plan 0116, section 2).
 *
 * Lower is more specific, so a shop prices itself before its local area, its
 * local area before its chain region, and the region before the whole chain.
 */
describe('DEFAULT_SCOPE_PRIORITY', () => {
  it('orders STORE before LOCAL_AREA before REGION before NATIONAL', () => {
    const ranked = [
      PriceScopeKind.NATIONAL,
      PriceScopeKind.REGION,
      PriceScopeKind.LOCAL_AREA,
      PriceScopeKind.STORE,
    ].sort((a, b) => DEFAULT_SCOPE_PRIORITY[a] - DEFAULT_SCOPE_PRIORITY[b]);

    expect(ranked).toEqual([
      PriceScopeKind.STORE,
      PriceScopeKind.LOCAL_AREA,
      PriceScopeKind.REGION,
      PriceScopeKind.NATIONAL,
    ]);
    expect(DEFAULT_SCOPE_PRIORITY[PriceScopeKind.LOCAL_AREA]).toBe(200);
  });

  it('has no POSTAL_CODE kind any more', () => {
    expect(Object.values(PriceScopeKind)).not.toContain('POSTAL_CODE');
  });
});
