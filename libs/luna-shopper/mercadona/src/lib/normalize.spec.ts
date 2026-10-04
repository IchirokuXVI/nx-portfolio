import { UnitOfMeasure } from '@portfolio/luna-shopper/contracts';
import categoriesTree from './__fixtures__/categories-tree.json';
import categoryExpanded from './__fixtures__/category-expanded.json';
import cheeseListing from './__fixtures__/category-listing-cheese.json';
import approximateWeight from './__fixtures__/product-approximate-weight.json';
import boxOfCapsules from './__fixtures__/product-box-of-capsules.json';
import capsules from './__fixtures__/product-capsules-per-unit.json';
import oliveOil from './__fixtures__/product-detail-es.json';
import fixedPackInStoreBarcode from './__fixtures__/product-fixed-pack-in-store-barcode.json';
import inconsistent from './__fixtures__/product-inconsistent-bulk-price.json';
import noEan from './__fixtures__/product-no-ean.json';
import packOfPads from './__fixtures__/product-pack-of-pads.json';
import packOfWipes from './__fixtures__/product-pack-of-wipes.json';
import referenceFormat from './__fixtures__/product-reference-format-100ml.json';
import rollOfServices from './__fixtures__/product-roll-of-services.json';
import singleRazor from './__fixtures__/product-single-razor.json';
import sizeFormatM from './__fixtures__/product-size-format-m.json';
import {
  normalizeCategories,
  normalizeCategoryProducts,
  normalizeProduct,
  unavailableProduct,
} from './normalize';
import { isImportableSizeFormat, mapSizeFormat } from './units';

const OBSERVED_AT = new Date('2026-08-30T09:00:00.000Z');

describe('normalizeProduct', () => {
  it('maps the ordinary product whole, its category read from the deepest node', () => {
    // The deepest node ("Aceite, vinagre y sal") is a child the table lists
    // under its section, so the product lands on that leaf rather than on the
    // section's own answer (plan 0166, section 7).
    expect(normalizeProduct(oliveOil, { observedAt: OBSERVED_AT })).toEqual({
      externalId: '4241',
      ean: '8480000135636',
      name: { es: 'Aceite de oliva 0,4º Hacendado' },
      brand: 'Hacendado',
      soldByWeight: false,
      unitSize: 1,
      unit: UnitOfMeasure.LITER,
      packCount: null,
      categorySlug: 'oils',
      categoryPath: ['Aceite, especias y salsas', 'Aceite, vinagre y sal'],
      price: 8.75,
      unitPrice: 8.75,
      unitPriceLabel: 'L',
      currency: 'EUR',
      available: true,
      sourceUrl:
        'https://tienda.mercadona.es/product/4241/aceite-de-oliva-04-hacendado-botella',
      observedAt: OBSERVED_AT,
    });
  });

  it('carries the English name when one was fetched (section 6.2)', () => {
    const product = normalizeProduct(oliveOil, {
      observedAt: OBSERVED_AT,
      englishName: 'Light olive oil Hacendado',
    });
    expect(product.name).toEqual({
      es: 'Aceite de oliva 0,4º Hacendado',
      en: 'Light olive oil Hacendado',
    });
  });

  it('leaves `en` absent rather than empty when the source has no English string', () => {
    // Section 11: falling back to Spanish beats refusing to import. The caller
    // decides what to do about it; the shape must not lie by carrying ''.
    const product = normalizeProduct(oliveOil, { englishName: '   ' });
    expect(product.name.en).toBeUndefined();
  });

  describe('bulk_price is stored verbatim and never recomputed (section 2.4)', () => {
    it('keeps the value even when it equals unit_price / unit_size', () => {
      const product = normalizeProduct(referenceFormat);
      expect(product.price).toBe(1.8);
      expect(product.unitSize).toBe(0.4);
      // 1.80 / 0.4 is 4.50, so deriving would agree here. It is still not derived.
      expect(product.unitPrice).toBe(4.5);
    });

    it('keeps a value normalized per pack unit rather than per kilo', () => {
      // 2.60 / 20 capsules is 0.13. Deriving from unit_size (0.11) gives 23.6.
      const product = normalizeProduct(capsules);
      expect(product.price).toBe(2.6);
      expect(product.unitSize).toBe(0.11);
      expect(product.unitPrice).toBe(0.13);
    });

    it('keeps a value that matches neither derivation', () => {
      // One of the 110 products (2.6%) that disagree with their own stated size:
      // 2.45 / 0.15 is 16.33, and the chain says 16.75. The chain wins.
      const product = normalizeProduct(inconsistent);
      expect(product.price).toBe(2.45);
      expect(product.unitSize).toBe(0.15);
      expect(product.unitPrice).toBe(16.75);
      expect(product.unitPrice).not.toBeCloseTo(2.45 / 0.15, 2);
    });
  });

  it('keeps reference_format as the source wrote it, label and number disagreeing', () => {
    // `100 ml` sits on a number that is per LITRE. It is a price tag for a human
    // and cannot be parsed into a unit, which is why it is stored as text.
    const product = normalizeProduct(referenceFormat);
    expect(product.unitPriceLabel).toBe('100 ml');
    expect(product.unit).toBe(UnitOfMeasure.LITER);
  });

  it('reads a missing EAN and an empty brand as null, not as empty strings', () => {
    const product = normalizeProduct(noEan);
    expect(product.ean).toBeNull();
    expect(product.brand).toBeNull();
  });

  it('states no size and no unit for size_format "m": a length is not a size (plan 0183)', () => {
    const product = normalizeProduct(sizeFormatM);
    expect(product.unit).toBeNull();
    expect(product.unitSize).toBeNull();
    expect(isImportableSizeFormat('m')).toBe(false);
  });

  describe('the pack count (plan 0162, section 1)', () => {
    /** The capsule fixture with its price block changed, for the cases no capture shows. */
    const capsulesWith = (fields: Record<string, unknown>) => ({
      ...capsules,
      price_instructions: { ...capsules.price_instructions, ...fields },
    });

    it('reads pack_size when is_pack is true', () => {
      // `pack_size` and `total_units` are both 20 on this product: a box of
      // twenty capsules, and the two fields agree.
      expect(normalizeProduct(capsules).packCount).toBe(20);
    });

    it('reads total_units when is_pack is true and pack_size is not set', () => {
      expect(
        normalizeProduct(capsulesWith({ pack_size: null })).packCount
      ).toBe(20);
    });

    it('states no count when pack_size and total_units disagree', () => {
      expect(
        normalizeProduct(capsulesWith({ total_units: 24 })).packCount
      ).toBeNull();
    });

    it('states no count when is_pack is false, whatever the other two say', () => {
      expect(normalizeProduct(oliveOil).packCount).toBeNull();
      expect(
        normalizeProduct(capsulesWith({ is_pack: false })).packCount
      ).toBeNull();
    });

    it('states no count when is_pack is absent', () => {
      const { is_pack: _dropped, ...rest } = capsules.price_instructions;
      expect(
        normalizeProduct({ ...capsules, price_instructions: rest }).packCount
      ).toBeNull();
    });

    it('states no count for 1 or a number outside the bounds', () => {
      for (const count of [1, 0, 1001, 2.5]) {
        expect(
          normalizeProduct(
            capsulesWith({ pack_size: count, total_units: count })
          ).packCount
        ).toBeNull();
      }
    });

    describe('a box priced as one piece (plan 0177)', () => {
      /** Product 11801 with its price block changed, for the cases around it. */
      const boxWith = (fields: Record<string, unknown>) => ({
        ...boxOfCapsules,
        price_instructions: { ...boxOfCapsules.price_instructions, ...fields },
      });

      it('is what the captured product says it is', () => {
        // The fields the rule reads, pinned, so a recapture that moves one of
        // them fails here rather than quietly changing what the rule means.
        expect(boxOfCapsules.price_instructions).toMatchObject({
          is_pack: false,
          pack_size: null,
          total_units: 16,
          unit_size: 0.16,
          size_format: 'kg',
          reference_format: 'ud',
        });
      });

      it('reads total_units as the count of a box the chain compares per piece', () => {
        const product = normalizeProduct(boxOfCapsules);
        expect(product.packCount).toBe(16);
        // The size is what the box weighs, and the count is beside it.
        expect(product.unitSize).toBe(0.16);
        expect(product.unit).toBe(UnitOfMeasure.KILOGRAM);
      });

      it('reads nothing when the comparison price is not per piece', () => {
        expect(
          normalizeProduct(boxWith({ reference_format: 'kg' })).packCount
        ).toBeNull();
      });

      it('reads nothing when the size is itself a count', () => {
        expect(
          normalizeProduct(boxWith({ size_format: 'ud' })).packCount
        ).toBeNull();
      });

      it('reads nothing when total_units is not set, or is 1', () => {
        expect(
          normalizeProduct(boxWith({ total_units: null })).packCount
        ).toBeNull();
        expect(
          normalizeProduct(boxWith({ total_units: 1 })).packCount
        ).toBeNull();
      });
    });

    it('reads the same count from a category listing', () => {
      const [cheese] = normalizeCategoryProducts(categoryExpanded);
      expect(cheese.packCount).toBeNull();
      const [pack] = normalizeCategoryProducts({
        ...categoryExpanded,
        products: [capsules],
        categories: [],
      });
      expect(pack.packCount).toBe(20);
    });
  });

  it('describes a 404 as unavailable and priceless, never as a stale price', () => {
    // Section 2.6: a 404 from a detail call means "not stocked in this
    // warehouse". It is a value, not an error.
    expect(unavailableProduct('4241', OBSERVED_AT)).toMatchObject({
      externalId: '4241',
      available: false,
      price: null,
      unitPrice: null,
      observedAt: OBSERVED_AT,
    });
  });
});

describe('the category tree', () => {
  it('normalizes the two levels', () => {
    const roots = normalizeCategories(categoriesTree);
    expect(roots).toHaveLength(2);
    expect(roots[0]).toMatchObject({
      id: 12,
      name: 'Aceite, especias y salsas',
    });
    expect(roots[0].children.map((c) => c.id)).toEqual([112, 113]);
  });

  it('yields a category response as products carrying the path that reached them', () => {
    const products = normalizeCategoryProducts(categoryExpanded);
    // Three entries, because 7012 is filed under two branches; deduplication is
    // the walk's job, not the normalizer's.
    expect(products).toHaveLength(3);
    expect(products[0]).toMatchObject({
      externalId: '7012',
      displayName: 'Queso curado mezcla Hacendado',
      price: 3.95,
      unitPrice: 11.29,
      unitPriceLabel: 'kg',
      unit: UnitOfMeasure.KILOGRAM,
      // Nodes rather than names: the level 2 id is what section 5.6 splits
      // cheese from cured meat on, and a path of names cannot carry it.
      categoryPath: [
        { id: 51, name: 'Charcutería y quesos' },
        { id: 53, name: 'Queso curado, semicurado y tierno' },
      ],
    });
  });

  it('starts the path at the ancestors it is given, so the walk can supply the root', () => {
    // The response for a level 2 category does not contain its level 1 parent,
    // and the category map is keyed on the 26 level 1 names. The walk passes the
    // root down; without it every product resolves to null.
    const [product] = normalizeCategoryProducts(categoryExpanded, [
      { id: 4, name: 'Charcutería y quesos' },
    ]);
    expect(product.categoryPath[0]).toEqual({
      id: 4,
      name: 'Charcutería y quesos',
    });
  });
});

describe('the unit a size is in (plan 0177)', () => {
  // Mercadona prints the unit alone and never a centilitre: `kg`, `l`, `ud`
  // and `m` are the four values of the whole assortment. A run writes `unit`
  // as the row's `sizeUnit`, so these are the three it can state.
  it('is the litre of a product sized in l', () => {
    expect(normalizeProduct(oliveOil)).toMatchObject({
      unitSize: 1,
      unit: UnitOfMeasure.LITER,
    });
  });

  it('is the kilogram of a product sized in kg', () => {
    expect(normalizeProduct(inconsistent)).toMatchObject({
      unitSize: 0.15,
      unit: UnitOfMeasure.KILOGRAM,
    });
  });

  it('is the unit of a product sized in ud', () => {
    expect(normalizeProduct(noEan)).toMatchObject({
      unitSize: 1,
      unit: UnitOfMeasure.UNIT,
    });
  });
});

describe('a size of one unit (plan 0183)', () => {
  /** The pad fixture with its price block changed, for the cases no capture shows. */
  const padsWith = (fields: Record<string, unknown>) => ({
    ...packOfPads,
    price_instructions: { ...packOfPads.price_instructions, ...fields },
  });

  it('is what the captured pack of pads says it is', () => {
    expect(packOfPads.id).toBe('16566');
    expect(packOfPads.price_instructions).toMatchObject({
      unit_size: 1,
      size_format: 'ud',
      total_units: 10,
      unit_name: 'ud.',
      unit_price: '3.20',
      reference_price: '0.320',
      reference_format: 'ud',
      is_pack: false,
      pack_size: null,
    });
  });

  it('reads the real count of a pack of pads from total_units', () => {
    expect(normalizeProduct(packOfPads)).toMatchObject({
      unitSize: 10,
      unit: UnitOfMeasure.UNIT,
      packCount: null,
    });
  });

  it('reads the real count of a pack of wipes from total_units', () => {
    expect(packOfWipes.price_instructions).toMatchObject({
      unit_size: 1,
      size_format: 'ud',
      total_units: 15,
      unit_price: '0.80',
      reference_price: '0.054',
    });
    expect(normalizeProduct(packOfWipes)).toMatchObject({
      unitSize: 15,
      unit: UnitOfMeasure.UNIT,
    });
  });

  it('keeps 1 for a single razor, whose comparison price is its own price', () => {
    expect(singleRazor.price_instructions).toMatchObject({
      unit_size: 1,
      size_format: 'ud',
      total_units: null,
      unit_price: '3.00',
      reference_price: '3.000',
    });
    expect(normalizeProduct(singleRazor)).toMatchObject({
      unitSize: 1,
      unit: UnitOfMeasure.UNIT,
    });
  });

  it('keeps 1 for one roll whose total_units counts sheets and not pieces', () => {
    expect(rollOfServices.price_instructions).toMatchObject({
      unit_size: 1,
      size_format: 'ud',
      total_units: 600,
      unit_name: 'servicios',
      unit_price: '3.75',
      reference_price: '3.750',
    });
    expect(normalizeProduct(rollOfServices).unitSize).toBe(1);
  });

  it('states no size when the comparison price matches neither reading', () => {
    expect(
      normalizeProduct(
        padsWith({ reference_price: '0.800', bulk_price: '0.80' })
      ).unitSize
    ).toBeNull();
    expect(
      normalizeProduct(
        padsWith({ total_units: null, reference_price: '0.320' })
      ).unitSize
    ).toBeNull();
  });

  it('states no size when the payload carries no comparison price at all', () => {
    expect(
      normalizeProduct(padsWith({ reference_price: null, bulk_price: null }))
        .unitSize
    ).toBeNull();
  });

  it('falls back to bulk_price when reference_price is absent', () => {
    expect(
      normalizeProduct(padsWith({ reference_price: undefined })).unitSize
    ).toBe(10);
  });

  it('leaves every other size as the chain stated it', () => {
    // A size that is already a count, and a weight, are not placeholders.
    expect(normalizeProduct(padsWith({ unit_size: 20 })).unitSize).toBe(20);
    expect(normalizeProduct(boxOfCapsules).unitSize).toBe(0.16);
  });

  it('reads the same count from a category listing', () => {
    const [listed] = normalizeCategoryProducts({
      id: 190,
      name: 'Higiene íntima',
      products: [packOfPads],
    });
    expect(listed).toMatchObject({ unitSize: 10, unit: UnitOfMeasure.UNIT });
  });
});

describe('a product sold by weight (plan 0181)', () => {
  it('is what the captured piece of cheese says it is', () => {
    // The fixture's own fields, so a recapture that changes the product fails
    // here and not in the rule below.
    expect(approximateWeight.ean).toBe('2105600509460');
    expect(approximateWeight.price_instructions).toMatchObject({
      approx_size: true,
      unit_size: 1.54,
      size_format: 'kg',
      unit_price: '14.49',
      bulk_price: '9.41',
      reference_format: 'kg',
      selling_method: 0,
    });
  });

  it('is what the captured fixed pack says it is', () => {
    expect(fixedPackInStoreBarcode.ean).toBe('2105972846927');
    expect(fixedPackInStoreBarcode.price_instructions).toMatchObject({
      approx_size: false,
      unit_size: 0.05,
      size_format: 'kg',
      unit_price: '0.55',
      bulk_price: '11.00',
      reference_format: 'kg',
      selling_method: 0,
    });
  });

  it('prices an approximate weight piece by the kilo and gives it no size', () => {
    const product = normalizeProduct(approximateWeight);
    expect(product).toMatchObject({
      externalId: '50946',
      soldByWeight: true,
      // `bulk_price`, verbatim. Not the 14.49 of one estimated piece.
      price: 9.41,
      unitPrice: 9.41,
      unitSize: null,
      unit: UnitOfMeasure.KILOGRAM,
      packCount: null,
    });
  });

  it('keeps the piece price of a fixed pack, in-store barcode or not', () => {
    const product = normalizeProduct(fixedPackInStoreBarcode);
    expect(product).toMatchObject({
      externalId: '84692',
      ean: '2105972846927',
      soldByWeight: false,
      price: 0.55,
      unitPrice: 11,
      unitSize: 0.05,
      unit: UnitOfMeasure.KILOGRAM,
    });
  });

  describe('the listing, which is where a price comes from', () => {
    /** The raw listing row of one product, wherever the category nests it. */
    const rawRow = (id: string) =>
      cheeseListing.categories
        .flatMap((category) => category.products)
        .find((product) => product.id === id);
    const listed = (id: string) =>
      normalizeCategoryProducts(cheeseListing).find(
        (product) => product.externalId === id
      );

    it('is what the captured listing says it is', () => {
      // `GET /categories/54/` as served on 2026-10-04. The listing row carries
      // the price block whole, `approx_size` included, and no `ean`.
      const weighed = rawRow('50946');
      expect(weighed).not.toHaveProperty('ean');
      expect(weighed?.price_instructions).toMatchObject({
        approx_size: true,
        unit_size: 1.54,
        size_format: 'kg',
        unit_price: '14.49',
        bulk_price: '9.41',
      });
      // A second piece of the same cheese, and a fixed pack beside them.
      expect(rawRow('50943')?.price_instructions).toMatchObject({
        approx_size: true,
        unit_size: 0.42,
        unit_price: '4.07',
        bulk_price: '9.70',
      });
      expect(rawRow('23561')?.price_instructions).toMatchObject({
        approx_size: false,
        unit_size: 0.35,
        size_format: 'kg',
        unit_price: '3.00',
        bulk_price: '8.57',
      });
    });

    it('prices each piece sold by weight by the kilo, with no size', () => {
      expect(listed('50946')).toMatchObject({
        soldByWeight: true,
        price: 9.41,
        unitPrice: 9.41,
        unitSize: null,
        // The chain's own token, untouched: it is what the row already holds.
        sizeFormat: 'kg',
      });
      expect(listed('50943')).toMatchObject({
        soldByWeight: true,
        price: 9.7,
        unitPrice: 9.7,
        unitSize: null,
      });
    });

    it('keeps the pack price and the size of a fixed pack', () => {
      expect(listed('23561')).toMatchObject({
        soldByWeight: false,
        price: 3,
        unitPrice: 8.57,
        unitSize: 0.35,
        sizeFormat: 'kg',
      });
    });

    it('answers the price of a kilo for every row the listing calls approximate', () => {
      const raw = cheeseListing.categories.flatMap(
        (category) => category.products
      );
      const approximate = raw.filter(
        (product) => product.price_instructions.approx_size
      );
      expect(approximate.length).toBeGreaterThan(0);
      expect(approximate.length).toBeLessThan(raw.length);
      for (const product of approximate) {
        expect(listed(product.id)).toMatchObject({
          soldByWeight: true,
          unitSize: null,
          price: Number(product.price_instructions.bulk_price),
        });
      }
    });
  });

  it('reads the same from a detail payload laid into a listing', () => {
    const [weighed, fixed] = normalizeCategoryProducts({
      id: 54,
      name: 'Queso curado, semicurado y tierno',
      products: [approximateWeight, fixedPackInStoreBarcode],
    });
    expect(weighed).toMatchObject({
      soldByWeight: true,
      price: 9.41,
      unitPrice: 9.41,
      unitSize: null,
      // The chain's own token, untouched: it is what the row already holds.
      sizeFormat: 'kg',
    });
    expect(fixed).toMatchObject({
      soldByWeight: false,
      price: 0.55,
      unitPrice: 11,
      unitSize: 0.05,
      sizeFormat: 'kg',
    });
  });

  it('never recomputes the price of a kilo', () => {
    // 14.49 over 1.54 is 9.409. The chain says 9.41, and that is what is kept.
    const product = normalizeProduct({
      ...approximateWeight,
      price_instructions: {
        ...approximateWeight.price_instructions,
        bulk_price: '9.99',
      },
    });
    expect(product.price).toBe(9.99);
  });

  it('is not sold by weight when the approximate size is not in kilos', () => {
    // No captured product shows this. The price of a kilo is `bulk_price`
    // only when the size format is `kg`, so anything else keeps its price.
    const product = normalizeProduct({
      ...approximateWeight,
      price_instructions: {
        ...approximateWeight.price_instructions,
        size_format: 'ud',
      },
    });
    expect(product.soldByWeight).toBe(false);
    expect(product.price).toBe(14.49);
  });

  it('is not sold by weight when the payload does not say', () => {
    // Every fixture authored before the field was known carries none.
    expect(normalizeProduct(oliveOil).soldByWeight).toBe(false);
  });
});

describe('mapSizeFormat', () => {
  it.each([
    ['kg', UnitOfMeasure.KILOGRAM],
    ['l', UnitOfMeasure.LITER],
    ['ud', UnitOfMeasure.UNIT],
  ] as const)('maps %s', (format, expected) => {
    expect(mapSizeFormat(format)).toBe(expected);
  });

  it('maps m to nothing: two products do not earn a METER value', () => {
    expect(mapSizeFormat('m')).toBeNull();
  });
});
