import { lineStepOf, lineUnitOf, soldAs } from '@portfolio/velista/models';
import { catalogItemById, CatalogMemory } from './catalog-memory';

/**
 * The fakes carry two products with a step (velista `0186`, section 1): a loose
 * product by the kilo stepped by 100 g and one stepped by 5 g, so a backend-less run
 * and the specs meet a product step as well as the default.
 */
describe('CatalogMemory: products with a step', () => {
  it.each([
    ['item-rice-loose', 100],
    ['item-coffee-loose', 5],
  ])('holds %s, sold loose by the kilo, stepped by %i g', (id, step) => {
    const item = catalogItemById(id);

    expect(item?.quantityStep).toBe(step);
    expect(item?.unit).toBe('KILOGRAM');
    expect(item?.size).toBeNull();
    expect(
      lineUnitOf(soldAs(item?.unit ?? null, item?.size ?? null, null))
    ).toBe('GRAM');
    expect(
      lineStepOf({ unit: 'GRAM', itemIds: [id] }, (itemId) =>
        catalogItemById(itemId)
      )
    ).toBe(step);
  });

  it('keeps the default step on every other product', async () => {
    const items = await new CatalogMemory().itemsByIds([
      'item-milk-hacendado',
      'item-bread-sourdough',
      'item-eggs-dozen',
    ]);

    expect(items?.map((item) => item.quantityStep)).toEqual([null, null, null]);
  });

  it('finds them by name, as the typeahead asks', async () => {
    const found = await new CatalogMemory().suggest('granel');

    expect(
      found.flatMap((row) => (row.kind === 'item' ? [row.item.id] : []))
    ).toEqual(['item-rice-loose', 'item-coffee-loose']);
  });
});
