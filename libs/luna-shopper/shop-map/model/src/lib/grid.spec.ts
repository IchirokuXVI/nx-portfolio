import {
  cornerShop,
  invalidShops,
  supermarketShop,
} from './__fixtures__/fixtures';
import { anchorFace, distancesFrom, isBlocking, walkableGrid } from './grid';
import type { FixtureKind, ShopMapAnchor } from './types';

describe('isBlocking', () => {
  it.each<[FixtureKind, boolean]>([
    ['shelf', true],
    ['fridge', true],
    ['freezer', true],
    ['counter', true],
    ['checkout', true],
    ['wall', true],
    ['pillar', true],
    ['entrance', false],
    ['exit', false],
  ])('%s blocks walking: %s', (kind, blocks) => {
    expect(isBlocking(kind)).toBe(blocks);
  });
});

describe('walkableGrid', () => {
  it('answers rows of columns, false under every blocking fixture', () => {
    const grid = walkableGrid(cornerShop);
    expect(grid).toHaveLength(7);
    expect(grid.every((row) => row.length === 8)).toBe(true);
    expect(grid.flat().filter((free) => !free)).toHaveLength(10);
    expect(grid[1][1]).toBe(false);
    expect(grid[1][6]).toBe(false);
    expect(grid[2][2]).toBe(true);
  });

  it('keeps entrance and exit cells walkable', () => {
    const grid = walkableGrid(supermarketShop);
    expect(grid[15][12]).toBe(true);
    expect(grid[15][1]).toBe(true);
  });

  it('clips a fixture that runs off the grid', () => {
    const grid = walkableGrid(invalidShops['OUT_OF_BOUNDS']);
    expect(grid[1]).toEqual([true, false, true, true, false]);
  });
});

describe('distancesFrom', () => {
  const dist = distancesFrom(cornerShop, { x: 3, y: 6 });

  it.each([
    [{ x: 3, y: 6 }, 0],
    [{ x: 2, y: 4 }, 3],
    [{ x: 2, y: 2 }, 5],
    [{ x: 5, y: 2 }, 6],
    [{ x: 1, y: 1 }, Infinity],
  ])('answers the steps to %j: %d', (cell, steps) => {
    expect(dist[cell.y][cell.x]).toBe(steps);
  });

  it('reaches nothing from a blocked cell', () => {
    const blocked = distancesFrom(cornerShop, { x: 1, y: 1 });
    expect(blocked.flat().every((d) => d === Infinity)).toBe(true);
  });

  it('marks the far side of a wall unreachable', () => {
    const split = distancesFrom(invalidShops['DISCONNECTED'], { x: 2, y: 4 });
    expect(split[0][0]).toBe(Infinity);
    expect(split[3][0]).toBe(3);
  });
});

describe('anchorFace', () => {
  const at = (
    x: number,
    y: number,
    face?: ShopMapAnchor['face']
  ): ShopMapAnchor => ({ id: 'a', kind: 'product', at: { x, y }, face });

  it.each([
    ['the face it states', cornerShop, at(5, 1, 's'), { x: 5, y: 2 }],
    ['the first free neighbour', cornerShop, at(1, 2), { x: 2, y: 2 }],
    [
      'a free neighbour when the stated face is blocked',
      supermarketShop,
      at(3, 5, 'n'),
      { x: 4, y: 5 },
    ],
    [
      'its own cell when it sits on the floor',
      cornerShop,
      at(6, 3),
      { x: 6, y: 3 },
    ],
    [
      'a reachable neighbour before an unreachable one',
      invalidShops['DISCONNECTED'],
      at(2, 2),
      { x: 2, y: 3 },
    ],
    [
      'nothing when every neighbour is blocked',
      invalidShops['ANCHOR_UNREACHABLE'],
      at(1, 1),
      null,
    ],
  ])('stands on %s', (_, doc, anchor, cell) => {
    expect(anchorFace(doc, anchor)).toEqual(cell);
  });
});
