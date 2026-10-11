import { toLine } from './mappers';

/**
 * The two fields of backend plan `0199` on a line (velista `0135`, sections 3.1
 * and 3.2), mapped from `unknown`.
 */
describe('toLine, the favourite and the supermarket', () => {
  const wire = { id: 'ln-1', listId: 'list-1', content: 'Shampoo' };

  it('reads both from the wire', () => {
    const line = toLine({
      ...wire,
      itemIds: ['item-a'],
      favoriteItemId: 'item-a',
      preferredSupermarketId: 'chain-1',
    });

    expect(line?.favoriteItemId).toBe('item-a');
    expect(line?.preferredSupermarketId).toBe('chain-1');
  });

  it('reads an explicit null as none', () => {
    const line = toLine({
      ...wire,
      favoriteItemId: null,
      preferredSupermarketId: null,
    });

    expect(line?.favoriteItemId).toBeNull();
    expect(line?.preferredSupermarketId).toBeNull();
  });

  it('reads a server that predates the fields as none', () => {
    const line = toLine(wire);

    expect(line?.favoriteItemId).toBeNull();
    expect(line?.preferredSupermarketId).toBeNull();
  });

  it('drops a value that is not a string', () => {
    const line = toLine({
      ...wire,
      favoriteItemId: 7,
      preferredSupermarketId: { id: 'chain-1' },
    });

    expect(line?.favoriteItemId).toBeNull();
    expect(line?.preferredSupermarketId).toBeNull();
  });
});
