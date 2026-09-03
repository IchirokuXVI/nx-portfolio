import {
  ALL_POSTAL_CODE_CENTROIDS,
  SPAIN,
  SPAIN_POSTAL_CODE_CENTROIDS,
} from './dataset';

/**
 * The committed file itself (plan 0060, section 3). Not the reducer, which has
 * its own spec: this is the check that what is checked in is the shape the
 * migration will load, at the size the plan expects.
 */
describe('the shipped Spanish dataset', () => {
  it('holds roughly eleven thousand codes, every one unique and inside Spain', () => {
    // Section 3's figure, confirmed against the real download: 11,150 codes on
    // 2026-09-02. A refresh that halves or doubles it is worth a look.
    expect(SPAIN_POSTAL_CODE_CENTROIDS.length).toBeGreaterThan(10_000);
    expect(SPAIN_POSTAL_CODE_CENTROIDS.length).toBeLessThan(13_000);

    const codes = new Set(SPAIN_POSTAL_CODE_CENTROIDS.map((c) => c.postalCode));
    expect(codes.size).toBe(SPAIN_POSTAL_CODE_CENTROIDS.length);

    for (const c of SPAIN_POSTAL_CODE_CENTROIDS) {
      expect(c.country).toBe(SPAIN);
      expect(c.postalCode).toMatch(/^\d{5}$/);
      // Spain including the Canaries: 27° to 44° north, 19° west to 5° east.
      expect(c.latitude).toBeGreaterThan(27);
      expect(c.latitude).toBeLessThan(44.5);
      expect(c.longitude).toBeGreaterThan(-19);
      expect(c.longitude).toBeLessThan(5);
    }
  });

  it('is sorted by postal code, which is what keeps a refresh a readable diff', () => {
    const codes = SPAIN_POSTAL_CODE_CENTROIDS.map((c) => c.postalCode);
    expect(codes).toEqual([...codes].sort());
  });

  it('places 14013 in Córdoba', () => {
    const cordoba = SPAIN_POSTAL_CODE_CENTROIDS.find(
      (c) => c.postalCode === '14013'
    );
    expect(cordoba?.latitude).toBeCloseTo(37.89, 1);
    expect(cordoba?.longitude).toBeCloseTo(-4.77, 1);
  });

  it('is the whole of what we ship today', () => {
    expect(ALL_POSTAL_CODE_CENTROIDS).toBe(SPAIN_POSTAL_CODE_CENTROIDS);
  });
});
