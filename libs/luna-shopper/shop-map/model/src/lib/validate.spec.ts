import {
  copyOf,
  cornerShop,
  expectedCornerShop,
  expectedInvalid,
  expectedSupermarket,
  invalidShops,
  supermarketShop,
} from './__fixtures__/fixtures';
import { emptyShopMap } from './empty';
import { PROBLEM_ORDER, validateShopMap } from './validate';

describe('validateShopMap', () => {
  it('accepts the corner shop and the supermarket', () => {
    expect(validateShopMap(cornerShop)).toEqual(expectedCornerShop.problems);
    expect(validateShopMap(supermarketShop)).toEqual(
      expectedSupermarket.problems
    );
  });

  it('has an invalid fixture for every rule', () => {
    expect(Object.keys(invalidShops).sort()).toEqual([...PROBLEM_ORDER].sort());
  });

  it.each(PROBLEM_ORDER.map((code) => [code]))(
    'refuses the %s fixture with exactly its own problem',
    (code) => {
      expect(validateShopMap(invalidShops[code])).toEqual(
        expectedInvalid[code]
      );
    }
  );

  it.each([
    ['a width of zero', { w: 0 }],
    ['a fractional cell', { x: 1.5 }],
    ['a negative cell', { x: -1 }],
  ])('counts a fixture with %s as out of bounds', (_, change) => {
    const doc = copyOf(cornerShop);
    Object.assign(doc.fixtures[0], change);
    expect(validateShopMap(doc)).toContainEqual({
      code: 'OUT_OF_BOUNDS',
      id: 'shelf-left',
    });
  });

  it('does not ask for a checkout', () => {
    expect(cornerShop.fixtures.some((f) => f.kind === 'checkout')).toBe(false);
    expect(validateShopMap(cornerShop)).toEqual([]);
  });

  it('lets an entrance overlap a shelf, since only blocking fixtures clash', () => {
    const doc = copyOf(cornerShop);
    doc.fixtures.push({ id: 'side', kind: 'exit', x: 3, y: 5, w: 1, h: 2 });
    expect(validateShopMap(doc)).toEqual([]);
  });

  it('accepts a note anchor on the floor', () => {
    const doc = emptyShopMap(3, 3);
    doc.anchors.push({ id: 'n', kind: 'note', at: { x: 1, y: 1 }, text: 'Hi' });
    expect(validateShopMap(doc)).toEqual([]);
  });

  it('reports a split floor once, with the first cell reading row by row', () => {
    const doc = copyOf(invalidShops['DISCONNECTED']);
    doc.fixtures.push({ id: 'post', kind: 'pillar', x: 4, y: 0, w: 1, h: 1 });
    expect(
      validateShopMap(doc).filter((p) => p.code === 'DISCONNECTED')
    ).toEqual([{ code: 'DISCONNECTED', cell: { x: 0, y: 0 } }]);
  });

  it('lists problems in the order of the rules', () => {
    const doc = copyOf(invalidShops['ANCHOR_UNNAMED']);
    doc.fixtures = doc.fixtures.filter((f) => f.kind !== 'entrance');
    doc.fixtures.push({ id: 'far', kind: 'shelf', x: 9, y: 9, w: 1, h: 1 });
    expect(validateShopMap(doc).map((p) => p.code)).toEqual([
      'OUT_OF_BOUNDS',
      'NO_ENTRANCE',
      'ANCHOR_UNNAMED',
      'ANCHOR_UNNAMED',
    ]);
  });
});
