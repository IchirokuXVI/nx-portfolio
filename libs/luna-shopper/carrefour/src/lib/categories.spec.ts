import overTheCeiling from './__fixtures__/listing-over-the-ceiling.json';
import listingPage from './__fixtures__/listing-page.json';
import {
  categoryIdFromUrl,
  isWalkableCategory,
  listingPath,
  pagesFor,
  walkFrontier,
} from './categories';
import { CARREFOUR_CEILING, CARREFOUR_PAGE_SIZE } from './types';

const state = (fixture: unknown): Record<string, unknown> =>
  fixture as Record<string, unknown>;

/**
 * A page state built from a real one with its numbers changed.
 *
 * The two ceiling cases are captured where the live site offers them and
 * synthesized where it does not. A node over the ceiling with **no** children
 * was not found anywhere in the tree on 2026-09-06, so the only honest way to
 * test what a run does with one is to make one.
 */
function pageOf(options: {
  totalResults: number;
  children?: Array<{ id: string; display_name: string; url: string }>;
  displayName?: string;
}): Record<string, unknown> {
  return {
    productCardList: {
      results: { items: [], total_results: options.totalResults },
    },
    pagination: {
      page_size: CARREFOUR_PAGE_SIZE,
      total_pages: Math.ceil(
        Math.min(options.totalResults, CARREFOUR_CEILING) / CARREFOUR_PAGE_SIZE
      ),
    },
    category: { display_name: options.displayName ?? 'A category' },
    horizontalNavigation: {
      firstLevelCategories: { items: [] },
      secondLevelCategories: { items: options.children ?? [] },
    },
  };
}

const link = (id: string, name: string) => ({
  id,
  display_name: name,
  url: `/supermercado/${name.toLowerCase()}/${id}/c`,
});

describe('isWalkableCategory', () => {
  it('walks a real category', () => {
    expect(
      isWalkableCategory({
        id: 'cat20003',
        name: 'Bebidas',
        url: '/supermercado/bebidas/cat20003/c',
      })
    ).toBe(true);
  });

  it('skips a shopper own purchase history, which is empty for us', () => {
    expect(
      isWalkableCategory({
        id: 'catmasterlist',
        name: 'Mis productos',
        url: '/supermercado/mis-productos/catmasterlist/c',
      })
    ).toBe(false);
  });

  it('skips a promotion view, which re lists products a category already holds', () => {
    // Walking one counts the same products twice.
    expect(
      isWalkableCategory({
        id: 'F-1234',
        name: 'Ofertas',
        url: '/supermercado/20-en-cupon/8058362358/s',
      })
    ).toBe(false);
  });
});

describe('listingPath and pagesFor', () => {
  it('pages by an offset in steps of the page size', () => {
    expect(listingPath('cat20003', 48)).toBe(
      '/supermercado/x/cat20003/c?offset=48'
    );
  });

  it('reads the category id out of a listing url', () => {
    expect(categoryIdFromUrl('/supermercado/la-despensa/cat20001/c')).toBe(
      'cat20001'
    );
    expect(
      categoryIdFromUrl('/supermercado/20-en-cupon/8058362358/s')
    ).toBeNull();
  });

  it('never asks for more pages than the source will serve', () => {
    expect(pagesFor(24)).toBe(1);
    expect(pagesFor(25)).toBe(2);
    expect(pagesFor(6339)).toBe(CARREFOUR_CEILING / CARREFOUR_PAGE_SIZE);
  });
});

describe('walkFrontier', () => {
  it('pages a first level category whole when it already fits', () => {
    // Five of the ten first level categories fit under the ceiling and are
    // never opened, which is what makes the walk cost 95 loads and not 633.
    const pages: Record<string, Record<string, unknown>> = {
      '/seed': pageOf({ totalResults: 0 }),
      [link('cat1', 'Congelados').url]: pageOf({ totalResults: 900 }),
    };
    (pages['/seed']['horizontalNavigation'] as Record<string, unknown>)[
      'firstLevelCategories'
    ] = { items: [link('cat1', 'Congelados')] };

    return walkFrontier(async (path) => pages[path] ?? null, '/seed').then(
      (frontier) => {
        expect(frontier.categories).toEqual([
          expect.objectContaining({
            id: 'cat1',
            totalResults: 900,
            path: ['Congelados'],
          }),
        ]);
        expect(frontier.capped).toEqual([]);
        // The seed and the one category, and nothing below it.
        expect(frontier.loads).toBe(2);
      }
    );
  });

  it('descends only past the ceiling, and pages the node it lands on', async () => {
    const parent = link('cat20001', 'Despensa');
    const childA = link('cat20009', 'Alimentacion');
    const childB = link('cat20011', 'Lacteos');
    const pages: Record<string, Record<string, unknown>> = {
      '/seed': pageOf({ totalResults: 0 }),
      [parent.url]: pageOf({ totalResults: 6339, children: [childA, childB] }),
      [childA.url]: pageOf({ totalResults: 800 }),
      [childB.url]: pageOf({ totalResults: 300 }),
    };
    (pages['/seed']['horizontalNavigation'] as Record<string, unknown>)[
      'firstLevelCategories'
    ] = { items: [parent] };

    const frontier = await walkFrontier(
      async (path) => pages[path] ?? null,
      '/seed'
    );
    expect(frontier.categories.map((c) => c.id)).toEqual([
      'cat20009',
      'cat20011',
    ]);
    // The path a run stamps on every product it finds there.
    expect(frontier.categories[0].path).toEqual(['Despensa', 'Alimentacion']);
    expect(frontier.capped).toEqual([]);
  });

  it('names a category the ceiling truncated, and never guesses past it', async () => {
    // A node over the ceiling with no children is the one case a run cannot
    // enumerate. None was found on 2026-09-06, which is a measurement and not a
    // guarantee, so one is reported by name rather than papered over.
    const orphan = link('cat9999', 'Vinos');
    const pages: Record<string, Record<string, unknown>> = {
      '/seed': pageOf({ totalResults: 0 }),
      [orphan.url]: pageOf({ totalResults: 2000, children: [] }),
    };
    (pages['/seed']['horizontalNavigation'] as Record<string, unknown>)[
      'firstLevelCategories'
    ] = { items: [orphan] };

    const frontier = await walkFrontier(
      async (path) => pages[path] ?? null,
      '/seed'
    );
    expect(frontier.categories).toEqual([]);
    expect(frontier.capped).toEqual([
      expect.objectContaining({
        id: 'cat9999',
        name: 'Vinos',
        totalResults: 2000,
      }),
    ]);
  });

  it('records a node that did not answer and steps over it', async () => {
    // Retrying into a refusal is how the block escalates.
    const missing = link('cat5', 'Mascotas');
    const pages: Record<string, Record<string, unknown>> = {
      '/seed': pageOf({ totalResults: 0 }),
    };
    (pages['/seed']['horizontalNavigation'] as Record<string, unknown>)[
      'firstLevelCategories'
    ] = { items: [missing] };

    const frontier = await walkFrontier(
      async (path) => pages[path] ?? null,
      '/seed'
    );
    expect(frontier.categories).toEqual([]);
    expect(frontier.unreadable).toEqual([missing.url]);
  });

  it('walks the real first level the live storefront names', async () => {
    // The seed is a captured page, so this asserts the walk reads a real
    // navigation block and skips the two node kinds it must skip.
    const seed = state(listingPage);
    const frontier = await walkFrontier(
      async (path) => (path === '/seed' ? seed : pageOf({ totalResults: 10 })),
      '/seed'
    );
    expect(frontier.categories.length).toBeGreaterThan(5);
    expect(frontier.categories.map((c) => c.id)).not.toContain('catmasterlist');
  });

  it('opens the real category the live storefront reports over the ceiling', async () => {
    const seed = state(listingPage);
    const parent = state(overTheCeiling);
    const parentId = 'cat20001';
    const frontier = await walkFrontier(async (path) => {
      if (path === '/seed') return seed;
      if (path.includes(`/${parentId}/c`)) return parent;
      return pageOf({ totalResults: 10 });
    }, '/seed');

    // Its own id is not in the frontier: it was opened, and its children are.
    expect(frontier.categories.map((c) => c.id)).not.toContain(parentId);
    expect(frontier.categories.some((c) => c.path[0] !== '')).toBe(true);
  });
});
