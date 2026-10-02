import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIA_CATEGORY_NAMES, DIA_CATEGORY_SLUGS } from './categories';
import { CATEGORY_LEAF_SLUGS } from './category-leaves';
import { parseMenu } from './menu';

const RESEARCH = join(
  __dirname,
  '../../../../../apps/luna-shopper-backend/harvester/docs/research/dia/data'
);

const diaMap = JSON.parse(
  readFileSync(join(RESEARCH, 'dia-map.json'), 'utf8')
) as Record<string, string>;

describe('DIA_CATEGORY_SLUGS', () => {
  it('names only leaves of the reference taxonomy', () => {
    const unknown = Object.entries(DIA_CATEGORY_SLUGS).filter(
      ([, slug]) => !CATEGORY_LEAF_SLUGS.has(slug)
    );
    expect(unknown).toEqual([]);
  });

  it('agrees with dia-map.json for every id that maps to a leaf', () => {
    const expected = Object.fromEntries(
      Object.entries(diaMap).filter(([, slug]) => CATEGORY_LEAF_SLUGS.has(slug))
    );
    expect(DIA_CATEGORY_SLUGS).toEqual(expected);
  });

  it('sends Frutas de temporada, which plan 0173 did not copy, to other-fruits', () => {
    expect(DIA_CATEGORY_SLUGS['L2040']).toBe('other-fruits');
    expect(DIA_CATEGORY_NAMES['L2040']).toBe('Frutas de temporada');
  });

  it('holds no root id, because a product is listed under a leaf', () => {
    expect(DIA_CATEGORY_SLUGS['L105']).toBeUndefined();
    expect(DIA_CATEGORY_SLUGS['L117']).toBeUndefined();
  });

  it('records the Spanish name of the ids it maps', () => {
    // A node the research reached only through a redirect has no name, so the
    // rule is "most", and a renamed leaf can only be noticed for these.
    const named = Object.keys(DIA_CATEGORY_SLUGS).filter(
      (id) => DIA_CATEGORY_NAMES[id] !== undefined
    );
    expect(named.length).toBeGreaterThan(240);
    expect(DIA_CATEGORY_NAMES['L2108']).toBe('Cola');
  });

  it('knows the leaves it leaves unmapped on purpose, such as Novedades', () => {
    expect(DIA_CATEGORY_SLUGS['L2302']).toBeUndefined();
    expect(DIA_CATEGORY_NAMES['L2302']).toBe('Novedades');
  });

  it('maps or knows almost every leaf of the menu fixture', () => {
    const menu = parseMenu(
      JSON.parse(
        readFileSync(join(__dirname, '__fixtures__', 'menu.json'), 'utf8')
      )
    );
    const unmapped = menu.leaves.filter(
      (leaf) => DIA_CATEGORY_SLUGS[leaf.id] === undefined
    );
    // Novedades and the seasonal selections map to nothing on purpose: their
    // products all sit in copied leaves (plan 0174, section 7).
    expect(unmapped.length).toBeLessThan(15);
    // A leaf DIA added after the research is neither mapped nor known, and a
    // run names it as unmapped for an operator. On 2026-10-02 that was the
    // Christmas leaf, L2353, which appeared after 2026-09-29.
    const unknown = menu.leaves.filter(
      (leaf) => DIA_CATEGORY_NAMES[leaf.id] === undefined
    );
    expect(unknown.length).toBeLessThan(5);
  });
});
