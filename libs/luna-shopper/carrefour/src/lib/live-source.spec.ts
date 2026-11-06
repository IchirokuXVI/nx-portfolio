import { probeCarrefour } from './probe';

/**
 * The opt in live test (plan 0219). **Never runs in CI**: it makes real
 * requests to a third party, and it starts headless Chromium through
 * Playwright, as the `capture-fixtures` target does.
 *
 *   LUNA_LIVE_SOURCE_TEST=1 npx nx test luna-shopper/carrefour --testFile=live-source.spec.ts
 *
 * It runs the probe the harvester runs once a day: two pages, at least two
 * seconds apart, and no retry of a refusal (plan 0090, sections 5 and 11). The
 * probe asserts counts well under today's and the fields a walk reads, never a
 * price.
 */
const live =
  process.env['LUNA_LIVE_SOURCE_TEST'] === '1' ? describe : describe.skip;

const USER_AGENT =
  'LunaShopper/0.1 (+https://velista.app; personal price comparison; contact@velista.app)';

live('Carrefour, live', () => {
  jest.setTimeout(240_000);

  it('passes every step of the probe', async () => {
    const result = await probeCarrefour({ userAgent: USER_AGENT });
    // Printed, so the person who ran it reads what each step saw.
    console.log(JSON.stringify(result, null, 2));

    expect(result.steps.filter((step) => !step.ok)).toEqual([]);
    expect(result.steps.map((step) => step.name)).toEqual([
      'listing',
      'product',
    ]);
  });
});
