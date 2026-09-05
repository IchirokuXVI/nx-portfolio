import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { leafSections, parseSectionTree } from './sections';

const landing = readFileSync(
  join(__dirname, '__fixtures__', 'landing-page.html'),
  'utf8'
);

describe('parseSectionTree', () => {
  const tree = parseSectionTree(landing);

  it('reads the nine top level sections out of the search form', () => {
    expect(tree.map((section) => section.name)).toEqual([
      'FRIO',
      'PAN',
      'ALIMENTACION',
      'BEBIDAS',
      'NO ALIMENTACION',
      'BAZAR',
      'DELICADEZA',
      'KIOSCO',
      'PERFUMERIA DIVA',
    ]);
  });

  it('drops TODAS, which is the chain’s name for no section at all', () => {
    expect(tree.some((section) => section.code === '')).toBe(false);
    expect(tree.every((section) => section.code.startsWith('W'))).toBe(true);
  });

  it('holds 62 sections below the top level (plan 0085, section 1)', () => {
    const below = (nodes = tree): number =>
      nodes.reduce(
        (total, node) => total + node.children.length + below(node.children),
        0
      );
    expect(below()).toBe(62);
    expect(tree.length + below()).toBe(71);
  });

  it('crawls 63 sections, because two top level ones have no children', () => {
    // The plan counts 62 "leaves", meaning every node below the top level. What
    // a run enumerates is every node with **no** children, which is one more:
    // DELICADEZA and KIOSCO are top level and childless, so they are crawled
    // themselves, and Fruteria is a leaf's parent rather than a leaf.
    const leaves = leafSections(tree);
    expect(leaves).toHaveLength(63);
    expect(leaves.map((leaf) => leaf.name)).toEqual(
      expect.arrayContaining(['DELICADEZA', 'KIOSCO'])
    );
    expect(leaves.map((leaf) => leaf.name)).not.toContain('Fruteria');
  });

  it('gives each node the code the POST wants and the path it sits on', () => {
    const carniceria = leafSections(tree).find(
      (leaf) => leaf.name === 'Carniceria'
    );
    expect(carniceria).toEqual({
      code: 'W011000009',
      name: 'Carniceria',
      path: ['FRIO', 'Carniceria'],
      children: [],
    });
  });

  it('nests a third level under the section that has one', () => {
    const fruteria = tree
      .flatMap((section) => section.children)
      .find((section) => section.name === 'Fruteria');
    expect(fruteria?.children.length).toBeGreaterThan(0);
    expect(fruteria?.children[0].path.slice(0, 2)).toEqual([
      'ALIMENTACION',
      'Fruteria',
    ]);
  });

  it('answers nothing rather than throwing when the form is not there', () => {
    expect(parseSectionTree('<html><body>nothing here</body></html>')).toEqual(
      []
    );
  });
});
