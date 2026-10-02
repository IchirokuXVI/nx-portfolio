import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseListing } from './listing';
import { DIA_LOYALTY_PROGRAM, regularPrice } from './price';
import type { DiaListingRow, DiaRawPrices } from './types';

const rowsOf = (name: string): DiaListingRow[] =>
  parseListing(
    JSON.parse(readFileSync(join(__dirname, '__fixtures__', name), 'utf8'))
  ).rows;

/** The rows of a fixture that carry a price, with the price narrowed. */
const priced = (name: string) =>
  rowsOf(name).flatMap((row) =>
    row.prices ? [{ row, prices: row.prices }] : []
  );

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

describe('regularPrice', () => {
  it('writes the price of a plain row verbatim, with nothing beside it', () => {
    const plain = priced('listing-page-1.json').find(
      ({ row, prices: raw }) =>
        !raw.isClubPrice && !raw.isPromoPrice && row.promotions.length === 0
    );
    expect(plain).toBeDefined();
    if (!plain) {
      return;
    }
    expect(regularPrice(plain.prices, plain.row.promotions)).toEqual({
      price: plain.prices.price,
      currency: 'EUR',
      unitPrice: plain.prices.pricePerUnit,
      unitPriceLabel: 'LITRO',
      extra: {},
    });
  });

  it('writes the strikethrough price of a club row, never the club price', () => {
    const club = priced('listing-club.json').filter(
      ({ prices: raw }) => raw.isClubPrice
    );
    expect(club.length).toBeGreaterThan(0);
    for (const { row, prices: raw } of club) {
      // Section 4: a club row is always a promotion row, and its other price is
      // the higher one.
      expect(raw.isPromoPrice).toBe(true);
      expect(raw.strikethroughPrice).toBeGreaterThan(raw.price);

      const regular = regularPrice(raw, row.promotions);
      expect(regular.price).toBe(raw.strikethroughPrice);
      expect(regular.extra.loyalty).toEqual({
        program: DIA_LOYALTY_PROGRAM,
        price: raw.price,
        unitPrice: raw.pricePerUnit,
      });
      expect(regular.extra.previousPrice).toBeUndefined();
    }
  });

  it('scales the unit price of a club row by the ratio of the two prices (D2)', () => {
    const regular = regularPrice(
      prices({
        price: 0.69,
        strikethroughPrice: 0.77,
        pricePerUnit: 0.46,
        measureUnit: 'LITRO',
        isClubPrice: true,
        isPromoPrice: true,
      })
    );
    // 0.46 * 0.77 / 0.69 = 0.5133, and 0.77 for 1.5 litres is 0.5133 too.
    expect(regular.unitPrice).toBe(0.51);
    expect(regular.extra.unitPriceScaled).toBe(true);
    expect(regular.extra.loyalty?.unitPrice).toBe(0.46);
  });

  it('marks every scaled unit price in the fixture, within a cent of the truth', () => {
    for (const { row, prices: raw } of priced('listing-club.json')) {
      const regular = regularPrice(raw, row.promotions);
      if (!raw.isClubPrice) {
        expect(regular.extra.unitPriceScaled).toBeUndefined();
        expect(regular.unitPrice).toBe(raw.pricePerUnit);
        continue;
      }
      expect(regular.extra.unitPriceScaled).toBe(true);
      const ratio = raw.strikethroughPrice / raw.price;
      expect(
        Math.abs((regular.unitPrice ?? 0) - (raw.pricePerUnit ?? 0) * ratio)
      ).toBeLessThanOrEqual(0.005 + 1e-9);
    }
  });

  it('leaves a club row with no unit price with none, and marks nothing', () => {
    const regular = regularPrice(
      prices({
        price: 1,
        strikethroughPrice: 2,
        pricePerUnit: null,
        isClubPrice: true,
        isPromoPrice: true,
      })
    );
    expect(regular.unitPrice).toBeNull();
    expect(regular.extra.unitPriceScaled).toBeUndefined();
  });

  it('writes the price of a promotion for everybody, and keeps the previous one', () => {
    const promotion = priced('listing-promotion.json').find(
      ({ prices: raw }) => raw.isPromoPrice && !raw.isClubPrice
    );
    expect(promotion).toBeDefined();
    if (!promotion) {
      return;
    }
    const regular = regularPrice(promotion.prices, promotion.row.promotions);
    expect(regular.price).toBe(promotion.prices.price);
    expect(regular.unitPrice).toBe(promotion.prices.pricePerUnit);
    expect(regular.extra.previousPrice).toBe(
      promotion.prices.strikethroughPrice
    );
    expect(regular.extra.loyalty).toBeUndefined();
    expect(regular.extra.unitPriceScaled).toBeUndefined();
  });

  it('writes the price of a club only multi buy verbatim, with the promotion text', () => {
    const multibuy = priced('listing-multibuy.json').find(
      ({ row, prices: raw }) =>
        !raw.isClubPrice &&
        !raw.isPromoPrice &&
        row.promotions.some((promotion) => promotion.onlyClubDia)
    );
    expect(multibuy).toBeDefined();
    if (!multibuy) {
      return;
    }
    // Section 4: a multi buy leaves the two prices equal.
    expect(multibuy.prices.strikethroughPrice).toBe(multibuy.prices.price);
    const regular = regularPrice(multibuy.prices, multibuy.row.promotions);
    expect(regular.price).toBe(multibuy.prices.price);
    expect(Object.keys(regular.extra)).toEqual(['promotion']);
    expect(regular.extra.promotion?.entries).toEqual(
      multibuy.row.promotions.map((promotion) => ({
        description: promotion.description,
        short_description: promotion.shortDescription,
        only_club_dia: promotion.onlyClubDia,
      }))
    );
    expect(
      regular.extra.promotion?.entries.some((entry) => entry.only_club_dia)
    ).toBe(true);
  });

  it('keeps the promotions in an object, which the price history keeps', () => {
    const regular = regularPrice(prices({}), [
      { description: '2ª UD 50%', shortDescription: null, onlyClubDia: true },
    ]);
    expect(Array.isArray(regular.extra.promotion)).toBe(false);
    expect(regular.extra.promotion).toEqual({
      entries: [
        {
          description: '2ª UD 50%',
          short_description: null,
          only_club_dia: true,
        },
      ],
    });
  });

  it('keeps measure_unit verbatim as the unit price label', () => {
    expect(
      regularPrice(prices({ measureUnit: '100 ML.' })).unitPriceLabel
    ).toBe('100 ML.');
    expect(
      regularPrice(prices({ measureUnit: null })).unitPriceLabel
    ).toBeNull();
  });
});
