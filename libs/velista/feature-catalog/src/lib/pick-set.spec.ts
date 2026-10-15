import { LINE_ITEM_SET_MAX } from '@portfolio/velista/models';
import { tickProduct } from './pick-set';

function ids(count: number, prefix = 'p'): string[] {
  return Array.from({ length: count }, (_, at) => `${prefix}${at}`);
}

describe('tickProduct (velista 0146, section 3)', () => {
  it('adds a product at the end of the set', () => {
    expect(tickProduct(['a'], 'b', ['a'])).toEqual({
      kind: 'ticked',
      ticked: ['a', 'b'],
    });
  });

  it('takes a ticked product out', () => {
    expect(tickProduct(['a', 'b'], 'a', ['a', 'b'])).toEqual({
      kind: 'ticked',
      ticked: ['b'],
    });
  });

  it('takes the last product out, which leaves an empty set', () => {
    expect(tickProduct(['a'], 'a', ['a'])).toEqual({
      kind: 'ticked',
      ticked: [],
    });
  });

  it('refuses a tick past the cap, and says how full the set is', () => {
    const full = ids(LINE_ITEM_SET_MAX);

    expect(tickProduct(full, 'one-more', full)).toEqual({
      kind: 'full',
      full: { count: LINE_ITEM_SET_MAX, cap: LINE_ITEM_SET_MAX },
    });
  });

  it('lets a line over the cap shrink and tick back to what it had, and no further', () => {
    const before = ids(LINE_ITEM_SET_MAX + 4);
    const shrunk = before.slice(1);

    expect(tickProduct(before, before[0], before).kind).toBe('ticked');
    expect(tickProduct(shrunk, 'new', before)).toEqual({
      kind: 'ticked',
      ticked: [...shrunk, 'new'],
    });
    expect(tickProduct(before, 'new', before).kind).toBe('full');
  });
});
