import { probeDeza } from './probe';

/**
 * The opt in live test (plan 0219). **Never runs in CI**: it makes real
 * requests to a third party. It exists so a stale fixture says so, rather than
 * a markup change being discovered by a run that quietly stores nothing.
 *
 *   LUNA_LIVE_SOURCE_TEST=1 npx nx test luna-shopper/deza --testFile=live-source.spec.ts
 *
 * It runs the probe the harvester runs once a day: two requests, a second
 * apart. The probe asserts counts well under today's and the fields a walk
 * reads. DEZA prints no price, so nothing here asks for one.
 */
const live =
  process.env['LUNA_LIVE_SOURCE_TEST'] === '1' ? describe : describe.skip;

const USER_AGENT =
  'LunaShopper/0.1 (+https://velista.app; personal price comparison; contact@velista.app)';

live('DEZA, live', () => {
  jest.setTimeout(120_000);

  it('passes every step of the probe', async () => {
    const result = await probeDeza({ userAgent: USER_AGENT });
    // Printed, so the person who ran it reads what each step saw.
    console.log(JSON.stringify(result, null, 2));

    expect(result.steps.filter((step) => !step.ok)).toEqual([]);
    expect(result.steps.map((step) => step.name)).toEqual([
      'categories',
      'listing',
    ]);
  });
});
