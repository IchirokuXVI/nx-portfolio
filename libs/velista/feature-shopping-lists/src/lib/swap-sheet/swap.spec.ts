import type { BasketPriceScope } from '@portfolio/velista/models';
import { basketGroupScope, swappedItemIds } from './swap';

describe('swappedItemIds', () => {
  it('replaces the product in place and keeps the others', () => {
    expect(swappedItemIds(['a', 'b', 'c'], 'b', 'x')).toEqual(['a', 'x', 'c']);
  });

  it('never repeats a product the line already holds', () => {
    expect(swappedItemIds(['a', 'b'], 'a', 'b')).toEqual(['b']);
  });
});

describe('basketGroupScope', () => {
  it('names the basket scopes, sorted, and none for a basket with none', () => {
    const scopes = new Map([
      ['s2', {} as BasketPriceScope],
      ['s1', {} as BasketPriceScope],
    ]);

    expect(basketGroupScope(scopes)).toEqual({ priceScopeIds: ['s1', 's2'] });
    expect(basketGroupScope(undefined)).toEqual({ priceScopeIds: [] });
  });
});
