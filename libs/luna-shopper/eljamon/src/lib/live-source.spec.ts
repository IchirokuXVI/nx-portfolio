import { probeElJamon } from './probe';

/**
 * The one opt in live test (plan 0169, section 9; plan 0219). **Never runs in
 * CI**: it makes real requests to a third party. It exists so a stale fixture
 * says so, rather than a markup change being discovered by a run that quietly
 * stores nothing.
 *
 *   LUNA_LIVE_SOURCE_TEST=1 npx nx test luna-shopper/eljamon --testFile=live-source.spec.ts
 *
 * It runs the probe the harvester runs once a day: five requests, a second
 * apart. The probe asserts field names and floors well under today's counts,
 * never a price, because prices and the assortment move every week.
 */
const live =
  process.env['LUNA_LIVE_SOURCE_TEST'] === '1' ? describe : describe.skip;

const USER_AGENT =
  'LunaShopper/0.1 (+https://velista.app; personal price comparison; contact@velista.app)';

live('El Jamón, live', () => {
  jest.setTimeout(120_000);

  it('passes every step of the probe', async () => {
    const result = await probeElJamon({ userAgent: USER_AGENT });
    // Printed, so the person who ran it reads what each step saw.
    console.log(JSON.stringify(result, null, 2));

    expect(result.steps.filter((step) => !step.ok)).toEqual([]);
    expect(result.steps.map((step) => step.name)).toEqual([
      'categories',
      'listing',
      'product',
      'shops',
    ]);
  });
});
