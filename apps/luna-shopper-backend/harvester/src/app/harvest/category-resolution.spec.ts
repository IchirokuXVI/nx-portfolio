import { categorySlugsFor, UNCATEGORISED_SLUG } from './category-resolution';

/**
 * Which slugs a product created from a source row is filed under (plan 0166,
 * section 7; plan 0174, section 7).
 *
 * A DIA row is filed by the DIA leaf ids it was listed under, because our tree
 * is a copy of DIA's. Every other chain still goes through the Mercadona
 * table, by the row's printed path.
 */
describe('categorySlugsFor', () => {
  describe('a dia-api row', () => {
    const dia = (extra: Record<string, unknown> | null) => ({
      adapterKey: 'dia-api',
      extra,
    });

    it('lands on one slug per DIA id, in walk order', () => {
      expect(
        categorySlugsFor(
          undefined,
          ['Agua y refrescos', 'Cola'],
          dia({ diaCategoryIds: ['L2108', 'L2286'] })
        )
      ).toEqual(['cola', 'water-and-soft-drink-packs']);
    });

    it('keeps a slug once when two ids map to it', () => {
      // Frutas de temporada was not copied, and maps to the leaf its only
      // products belong under.
      expect(
        categorySlugsFor(
          undefined,
          [],
          dia({ diaCategoryIds: ['L2040', 'L2040'] })
        )
      ).toEqual(['other-fruits']);
    });

    it('skips an id the table does not hold and keeps the ones it does', () => {
      expect(
        categorySlugsFor(
          undefined,
          [],
          dia({ diaCategoryIds: ['L2302', 'L2108', 'L9999'] })
        )
      ).toEqual(['cola']);
    });

    it('is uncategorised when no id maps, or the row carries none', () => {
      expect(
        categorySlugsFor(undefined, [], dia({ diaCategoryIds: ['L2302'] }))
      ).toEqual([UNCATEGORISED_SLUG]);
      expect(categorySlugsFor(undefined, [], dia({}))).toEqual([
        UNCATEGORISED_SLUG,
      ]);
      expect(categorySlugsFor(undefined, [], dia(null))).toEqual([
        UNCATEGORISED_SLUG,
      ]);
      expect(
        categorySlugsFor(undefined, [], dia({ diaCategoryIds: 'L2108' }))
      ).toEqual([UNCATEGORISED_SLUG]);
    });

    it('does not read the printed path, which names DIA sections in Spanish', () => {
      // `Agua` on its own would resolve through the Mercadona table. A DIA row
      // is filed by id alone.
      expect(
        categorySlugsFor(undefined, ['Agua y refrescos', 'Agua'], dia({}))
      ).toEqual([UNCATEGORISED_SLUG]);
    });

    it('keeps at most ten slugs, which is what catalog accepts', () => {
      const ids = [
        'L2001',
        'L2004',
        'L2005',
        'L2007',
        'L2008',
        'L2009',
        'L2010',
        'L2011',
        'L2012',
        'L2013',
        'L2014',
        'L2015',
      ];
      const slugs = categorySlugsFor(
        undefined,
        [],
        dia({ diaCategoryIds: ids })
      );
      expect(slugs).toHaveLength(10);
      expect(slugs[0]).toBe('cooked-ham');
    });

    it('lets an override win, as for every chain', () => {
      expect(
        categorySlugsFor(['milk'], [], dia({ diaCategoryIds: ['L2108'] }))
      ).toEqual(['milk']);
      expect(
        categorySlugsFor([], [], dia({ diaCategoryIds: ['L2108'] }))
      ).toEqual([]);
    });
  });

  describe('every other adapter', () => {
    it('answers the same with a source as it did with none', () => {
      const path = ['Aceite, especias y salsas', 'Aceite, vinagre y sal'];
      const before = categorySlugsFor(undefined, path);
      for (const adapterKey of [
        'mercadona-api',
        'deza-web',
        'carrefour-web',
        'lidl-api',
        'eljamon-web',
        'manual',
        null,
        undefined,
      ]) {
        expect(
          categorySlugsFor(undefined, path, {
            adapterKey,
            // DIA ids on another chain's row mean nothing.
            extra: { diaCategoryIds: ['L2108'] },
          })
        ).toEqual(before);
      }
      expect(before).toHaveLength(1);
    });

    it('is uncategorised for a path the table cannot place, or no path', () => {
      expect(categorySlugsFor(undefined, ['No such section'])).toEqual([
        UNCATEGORISED_SLUG,
      ]);
      expect(categorySlugsFor(undefined, null)).toEqual([UNCATEGORISED_SLUG]);
      expect(
        categorySlugsFor(undefined, undefined, { adapterKey: 'deza-web' })
      ).toEqual([UNCATEGORISED_SLUG]);
    });

    it('passes an override through, an empty one included', () => {
      expect(categorySlugsFor(['milk', 'eggs'], ['Anything'])).toEqual([
        'milk',
        'eggs',
      ]);
      expect(categorySlugsFor([], ['Anything'])).toEqual([]);
    });
  });
});
