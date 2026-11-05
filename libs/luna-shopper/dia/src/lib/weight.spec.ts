import { UnitOfMeasure } from '@portfolio/luna-shopper/contracts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseListing } from './listing';
import { splitSize } from './size';
import type { DiaListingRow, DiaRawPrices } from './types';
import { isSoldByWeight, weighedPrice, weightOf } from './weight';

const rowsOf = (name: string): DiaListingRow[] =>
  parseListing(
    JSON.parse(readFileSync(join(__dirname, '__fixtures__', name), 'utf8'))
  ).rows;

/** One captured row by its id, with its price narrowed. */
const captured = (file: string, skuId: string) => {
  const row = rowsOf(file).find((candidate) => candidate.skuId === skuId);
  if (!row?.prices) {
    throw new Error(`${file} holds no priced row ${skuId}`);
  }
  return { row, prices: row.prices, size: splitSize(row.displayName) };
};

const prices = (overrides: Partial<DiaRawPrices>): DiaRawPrices => ({
  currency: 'EUR',
  price: 1,
  strikethroughPrice: 1,
  pricePerUnit: 2,
  measureUnit: 'KILO',
  isClubPrice: false,
  isPromoPrice: false,
  discountPercentage: 0,
  ...overrides,
});

describe('a DIA piece of approximate weight (plan 0244, section 5.3)', () => {
  describe('sold by the kilo: `aprox.` and a price per KILO', () => {
    it('is what the captured row says it is', () => {
      const { row, prices: raw } = captured('listing-weight.json', '65');
      expect(row.displayName).toBe('Manzana roja granel 800 g aprox.');
      expect(raw).toMatchObject({
        price: 1.59,
        pricePerUnit: 1.99,
        measureUnit: 'KILO',
        isClubPrice: false,
      });
    });

    it('weighs the piece and gives it no size', () => {
      const { prices: raw, size } = captured('listing-weight.json', '65');
      expect(weightOf(size, raw)).toEqual({
        soldByWeight: true,
        approxWeight: 800,
        unitSize: null,
        sizeUnit: null,
      });
    });

    it('writes the price of a kilo and not the piece price', () => {
      const { row, prices: raw, size } = captured('listing-weight.json', '65');
      expect(weighedPrice(raw, row.promotions, size)).toMatchObject({
        price: 1.99,
        unitPrice: 1.99,
        unitPriceLabel: 'KILO',
      });
    });

    it('writes the price of a kilo of a promotion for everybody', () => {
      // Captured: 600 g aprox. at 4.19 the piece, 6.99 a kilo, 5.27 before.
      const {
        row,
        prices: raw,
        size,
      } = captured('listing-promotion.json', '50844');
      expect(weightOf(size, raw)).toMatchObject({
        soldByWeight: true,
        approxWeight: 600,
      });
      expect(weighedPrice(raw, row.promotions, size)).toMatchObject({
        price: 6.99,
        unitPrice: 6.99,
      });
    });

    it('writes the club row price of a kilo scaled by D2 of plan 0174', () => {
      // No captured club row prints `aprox.`, so the figures are literal:
      // 2.00 regular, 1.60 club, and DIA's 8.00 a kilo computed on 1.60.
      const size = splitSize('Queso tierno 250 g aprox.');
      const club = prices({
        price: 1.6,
        strikethroughPrice: 2,
        pricePerUnit: 8,
        isClubPrice: true,
      });
      const written = weighedPrice(club, [], size);
      expect(written.price).toBe(10);
      expect(written.unitPrice).toBe(10);
      expect(written.extra.unitPriceScaled).toBe(true);
      // The club figure is kept aside and never written as the price.
      expect(written.extra.loyalty).toMatchObject({ price: 1.6, unitPrice: 8 });
    });
  });

  describe('priced as one: `aprox.` and any other measure_unit', () => {
    it('weighs the piece, gives it no size and keeps its piece price', () => {
      const size = splitSize('Fuet extra 240 g aprox.');
      const piece = prices({
        price: 2.5,
        pricePerUnit: 2.5,
        measureUnit: 'UNIDAD',
      });
      expect(weightOf(size, piece)).toEqual({
        soldByWeight: false,
        approxWeight: 240,
        unitSize: null,
        sizeUnit: null,
      });
      expect(weighedPrice(piece, [], size).price).toBe(2.5);
    });

    it('is a piece priced as one when the row prints no price per kilo', () => {
      const size = splitSize('Manzana roja granel 800 g aprox.');
      const noFigure = prices({ price: 1.59, pricePerUnit: null });
      expect(isSoldByWeight(size, noFigure)).toBe(false);
      expect(weighedPrice(noFigure, [], size).price).toBe(1.59);
      expect(weightOf(size, noFigure).approxWeight).toBe(800);
    });

    it('is a piece priced as one when the row carries no prices at all', () => {
      const size = splitSize('Manzana roja granel 800 g aprox.');
      expect(weightOf(size, null)).toMatchObject({
        soldByWeight: false,
        approxWeight: 800,
        unitSize: null,
      });
    });
  });

  describe('a size the chain promises', () => {
    it('keeps its size and its pack price, though DIA compares it per KILO', () => {
      const {
        row,
        prices: raw,
        size,
      } = captured('listing-weight.json', '159310');
      expect(row.displayName).toBe('Pera conferencia bandeja 700 g');
      expect(weightOf(size, raw)).toEqual({
        soldByWeight: false,
        approxWeight: null,
        unitSize: 700,
        sizeUnit: UnitOfMeasure.GRAM,
      });
      expect(weighedPrice(raw, row.promotions, size)).toMatchObject({
        price: 1.79,
        unitPrice: 2.56,
      });
    });
  });

  it('answers sold by weight for every captured `aprox.` row priced per KILO', () => {
    const rows = [
      ...rowsOf('listing-weight.json'),
      ...rowsOf('listing-promotion.json'),
    ].filter((row) => /aprox\.?$/i.test(row.displayName));
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) {
      const size = splitSize(row.displayName);
      expect(row.prices?.measureUnit).toBe('KILO');
      expect(weightOf(size, row.prices)).toMatchObject({
        soldByWeight: true,
        unitSize: null,
      });
      expect(size.approxWeight).toBeGreaterThan(0);
      expect(
        row.prices && weighedPrice(row.prices, row.promotions, size).price
      ).toBe(row.prices?.pricePerUnit);
    }
  });
});
