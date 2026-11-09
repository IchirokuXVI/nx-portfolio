import { probeLidl } from './probe';

/**
 * The one opt in live test (plan 0089, section 12; plan 0219). **Never runs in
 * CI**: it makes real requests to a third party. It exists so a stale fixture
 * says so, rather than a shape change being discovered by a run that quietly
 * stores nothing.
 *
 *   LUNA_LIVE_SOURCE_TEST=1 npx nx test luna-shopper/lidl --testFile=live-source.spec.ts
 *
 * It runs the probe the harvester runs once a day: three or four requests, a
 * second apart. The assortment is a rolling window and a price expires every
 * Sunday, so the probe asserts field names and floors of one, never a value.
 */
const live =
  process.env['LUNA_LIVE_SOURCE_TEST'] === '1' ? describe : describe.skip;

const USER_AGENT =
  'LunaShopper/0.1 (+https://velista.app; personal price comparison; contact@velista.app)';

live('LIDL, live', () => {
  jest.setTimeout(120_000);

  it('passes every step of the probe', async () => {
    const result = await probeLidl({ userAgent: USER_AGENT });
    // Printed, so the person who ran it reads what each step saw.
    console.log(JSON.stringify(result, null, 2));

    expect(result.steps.filter((step) => !step.ok)).toEqual([]);
    // A second listing page only when the first held no grocery row. A run
    // that read no grocery product is red, so that someone looks (plan 0252).
    const names = result.steps.map((step) => step.name);
    expect([
      ['listing', 'product', 'shops'],
      ['listing', 'listing page 2', 'product', 'shops'],
    ]).toContainEqual(names);
  });
});
