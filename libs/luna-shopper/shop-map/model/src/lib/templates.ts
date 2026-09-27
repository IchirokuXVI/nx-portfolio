import type { ShopMapFixture } from './types';

/**
 * A template of `count` shelf pairs, each pair two shelves back to back, with
 * `gap` cells of aisle between one pair and the next. The shelves run the full
 * `rows` and the group is centred across `cols`, with its top left at cell
 * (0, 0), so a caller places it by offsetting every fixture.
 *
 * Ids are derived from the position (`aisle-1-a`, `aisle-1-b`, ...), never
 * random, so the same call answers the same fixtures; a caller placing a
 * template twice renames them.
 */
export function parallelAisles(
  cols: number,
  rows: number,
  count: number,
  gap: number
): ShopMapFixture[] {
  const whole = [cols, rows, count, gap].every(Number.isInteger);
  if (!whole || rows < 1 || count < 1 || gap < 1) {
    throw new RangeError(
      `parallelAisles needs whole sizes, count and gap of at least 1, got ${cols}x${rows}, ${count}, ${gap}`
    );
  }
  const width = 2 * count + gap * (count - 1);
  if (width > cols) {
    throw new RangeError(
      `${count} shelf pairs with a gap of ${gap} need ${width} columns, got ${cols}`
    );
  }
  const offset = Math.floor((cols - width) / 2);
  const fixtures: ShopMapFixture[] = [];
  for (let i = 0; i < count; i++) {
    const x = offset + i * (2 + gap);
    for (const [side, dx] of [
      ['a', 0],
      ['b', 1],
    ] as const) {
      fixtures.push({
        id: `aisle-${i + 1}-${side}`,
        kind: 'shelf',
        x: x + dx,
        y: 0,
        w: 1,
        h: rows,
      });
    }
  }
  return fixtures;
}
