import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIA_OFFERS_CATEGORY_ID, parseMenu } from './menu';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, '__fixtures__', name), 'utf8'));

const menu = parseMenu(fixture('menu.json'));

describe('parseMenu', () => {
  it('reads 29 roots, each with its Spanish name and path', () => {
    expect(menu.roots).toHaveLength(29);
    const fruits = menu.roots.find((root) => root.id === 'L105');
    expect(fruits).toMatchObject({ name: 'Frutas', path: '/frutas/c/L105' });
  });

  it('drops the "Todo" child, which repeats the id of its root', () => {
    const rootIds = new Set(menu.roots.map((root) => root.id));
    expect(menu.leaves.some((leaf) => rootIds.has(leaf.id))).toBe(false);
    expect(
      menu.leaves.some((leaf) => leaf.name.toLowerCase().startsWith('todo '))
    ).toBe(false);
  });

  it('gives every leaf its id, name, path and root', () => {
    expect(menu.leaves.length).toBeGreaterThan(240);
    const cola = menu.leaves.find((leaf) => leaf.id === 'L2108');
    expect(cola).toEqual({
      id: 'L2108',
      name: 'Cola',
      path: '/agua-y-refrescos/cola/c/L2108',
      rootId: 'L117',
      rootName: 'Agua y refrescos',
    });
    expect(new Set(menu.leaves.map((leaf) => leaf.id)).size).toBe(
      menu.leaves.length
    );
  });

  it('keeps the leaves that plan 0173 did not copy, so a walk reads them', () => {
    expect(menu.leaves.some((leaf) => leaf.id === 'L2302')).toBe(true);
    expect(menu.leaves.some((leaf) => leaf.id === 'L2040')).toBe(true);
  });

  it('names the offers category apart and lists it under no root', () => {
    expect(menu.offerCategoryId).toBe(DIA_OFFERS_CATEGORY_ID);
    expect(menu.roots.some((root) => root.id === DIA_OFFERS_CATEGORY_ID)).toBe(
      false
    );
  });

  it('answers an empty menu for a body it cannot read', () => {
    expect(parseMenu(null)).toEqual({
      roots: [],
      leaves: [],
      offerCategoryId: null,
    });
  });
});
