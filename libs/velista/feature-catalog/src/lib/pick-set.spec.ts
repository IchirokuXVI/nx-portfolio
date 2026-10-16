import { LINE_ITEM_SET_MAX } from '@portfolio/velista/models';
import { rebaseProductSet, tickProduct } from './pick-set';

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

  it('names the cap the line is held to, which is what it had when that is more', () => {
    const before = ids(LINE_ITEM_SET_MAX + 20);

    expect(tickProduct(before, 'new', before)).toEqual({
      kind: 'full',
      full: { count: LINE_ITEM_SET_MAX + 20, cap: LINE_ITEM_SET_MAX + 20 },
    });
  });
});

describe('rebaseProductSet (velista 0146, section 3)', () => {
  it('is the ticks as they are when the line has not moved', () => {
    expect(rebaseProductSet(['a', 'b'], ['b', 'c'], ['a', 'b'])).toEqual([
      'b',
      'c',
    ]);
  });

  it('keeps a product another device added, and the ticks of the person', () => {
    expect(
      rebaseProductSet(['a', 'b'], ['a', 'b', 'c'], ['a', 'b', 'x'])
    ).toEqual(['a', 'b', 'x', 'c']);
  });

  it('still takes out what the person unticked', () => {
    expect(rebaseProductSet(['a', 'b'], ['b'], ['a', 'b', 'x'])).toEqual([
      'b',
      'x',
    ]);
  });

  it('drops a product another device took off that the person did not tick', () => {
    expect(rebaseProductSet(['a', 'b'], ['a', 'b', 'c'], ['b'])).toEqual([
      'b',
      'c',
    ]);
  });

  it('keeps a product both added only once', () => {
    expect(rebaseProductSet(['a'], ['a', 'x'], ['a', 'x'])).toEqual(['a', 'x']);
  });
});
