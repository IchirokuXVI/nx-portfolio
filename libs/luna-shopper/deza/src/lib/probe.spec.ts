import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { probeDeza } from './probe';

/**
 * The DEZA probe against the committed pages and a fake fetch (plan 0219,
 * Tests). Nothing here touches the network.
 */

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

const LANDING = fixture('landing-page.html');

/** A fetch that answers a queue of pages, the last one forever. */
function stubFetch(pages: Array<{ status?: number; body?: string }>) {
  const methods: string[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit = {}) => {
    methods.push(init.method ?? 'GET');
    const page = pages[Math.min(methods.length - 1, pages.length - 1)];
    return new Response(page.body ?? '', { status: page.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, methods };
}

const run = (fetchImpl: typeof fetch) =>
  probeDeza({
    userAgent: 'LunaShopperTest/1.0',
    fetchImpl,
    sleepImpl: async () => undefined,
  });

describe('probeDeza', () => {
  it('passes both steps over the fixtures, in two requests', async () => {
    // The landing page carries the section tree and fifteen rows, so it
    // stands for the first query's answer too.
    const { fetchImpl, methods } = stubFetch([{ body: LANDING }]);

    const result = await run(fetchImpl);

    expect(result.steps.map((step) => [step.name, step.ok])).toEqual([
      ['categories', true],
      ['listing', true],
    ]);
    expect(result.requests).toBe(2);
    expect(methods).toEqual(['GET', 'POST']);
    expect(result.steps[1].sample['rows']).toBe(15);
  });

  it('reads a page with no section tree as a change of shape, with no second request', async () => {
    const moved = LANDING.replace(/id='search-art'/g, "id='buscar-art'");
    const { fetchImpl, methods } = stubFetch([{ body: moved }]);

    const result = await run(fetchImpl);

    expect(result.steps).toEqual([
      expect.objectContaining({
        name: 'categories',
        ok: false,
        problems: ['0 leaf sections were read, and the floor is 5'],
      }),
    ]);
    expect(methods).toHaveLength(1);
  });

  it('stops at a 403 on the first step with no second request', async () => {
    const { fetchImpl, methods } = stubFetch([{ status: 403 }]);

    const result = await run(fetchImpl);

    expect(result.steps).toEqual([
      expect.objectContaining({
        name: 'categories',
        ok: false,
        httpStatus: 403,
      }),
    ]);
    expect(methods).toHaveLength(1);
  });

  it('reads a listing whose rows lost their shops as a change of shape', async () => {
    // A row names its shops in the popup markup. A page without it is the
    // negative claim on every row at once, which the walk would write.
    const shopless = LANDING.replace(
      /pop-up-artic-tiendas/g,
      'pop-up-artic-otras'
    );
    const { fetchImpl } = stubFetch([{ body: LANDING }, { body: shopless }]);

    const result = await run(fetchImpl);

    expect(result.steps[1].ok).toBe(false);
    expect(result.steps[1].problems.join(' ')).toContain('a shop code');
  });
});
