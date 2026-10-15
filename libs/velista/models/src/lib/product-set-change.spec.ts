import { productSetChange, productSetChanged } from './product-set-change';

describe('productSetChange (velista 0146, section 3)', () => {
  it('finds a product added', () => {
    const change = productSetChange(['a'], ['a', 'b']);

    expect(change).toEqual({ added: ['b'], removed: [] });
    expect(productSetChanged(change)).toBe(true);
  });

  it('finds a product removed', () => {
    const change = productSetChange(['a', 'b'], ['b']);

    expect(change).toEqual({ added: [], removed: ['a'] });
    expect(productSetChanged(change)).toBe(true);
  });

  it('finds both at once, each in the order of its own side', () => {
    expect(productSetChange(['a', 'b', 'c'], ['c', 'e', 'd'])).toEqual({
      added: ['e', 'd'],
      removed: ['a', 'b'],
    });
  });

  it('finds nothing in the same set, in any order', () => {
    const change = productSetChange(['a', 'b'], ['b', 'a']);

    expect(change).toEqual({ added: [], removed: [] });
    expect(productSetChanged(change)).toBe(false);
  });

  it('counts a product removed and ticked again as no change', () => {
    const removed = ['a'];
    const ticked = [...removed, 'b'].filter((itemId) => itemId !== 'a');
    const again = [...ticked, 'a'];

    expect(productSetChange(['a', 'b'], again)).toEqual({
      added: [],
      removed: [],
    });
  });

  it('counts a line emptied, and a product twice in a set once', () => {
    expect(productSetChange(['a', 'b'], [])).toEqual({
      added: [],
      removed: ['a', 'b'],
    });
    expect(productSetChange([], ['a', 'a'])).toEqual({
      added: ['a'],
      removed: [],
    });
  });
});
