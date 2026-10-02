import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIA_PAGE_SIZE, parseListing } from './listing';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, '__fixtures__', name), 'utf8'));

const first = parseListing(fixture('listing-page-1.json'));
const second = parseListing(fixture('listing-page-2.json'));
const last = parseListing(fixture('listing-last-page.json'));

describe('parseListing', () => {
  it('reads a full page and the pagination the leaf prints', () => {
    expect(first.rows).toHaveLength(DIA_PAGE_SIZE);
    expect(first).toMatchObject({
      pageNumber: 1,
      totalPages: 3,
      totalItems: 56,
      categoryId: 'L2108',
      categoryName: 'Cola',
      movedTo: null,
    });
  });

  it('reads the fields a price run needs from a row', () => {
    const row = first.rows[0];
    expect(row.skuId).toEqual(expect.any(String));
    expect(row.displayName).toEqual(expect.any(String));
    expect(row.url).toMatch(/^\/agua-y-refrescos\/cola\/p\//);
    expect(row.image).toMatch(/^\/product_images\//);
    expect(row.unitsInStock).toEqual(expect.any(Number));
    expect(row.prices).toMatchObject({
      currency: 'EUR',
      price: expect.any(Number),
      strikethroughPrice: expect.any(Number),
      pricePerUnit: expect.any(Number),
      measureUnit: 'LITRO',
      isClubPrice: false,
      isPromoPrice: false,
    });
  });

  it('reads another page of the same leaf with no row in common', () => {
    expect(second.pageNumber).toBe(2);
    const seen = new Set(first.rows.map((row) => row.skuId));
    expect(second.rows.some((row) => seen.has(row.skuId))).toBe(false);
  });

  it('reads the last page, which holds the rest of the printed count', () => {
    expect(last.pageNumber).toBe(last.totalPages);
    expect(first.rows.length + second.rows.length + last.rows.length).toBe(
      first.totalItems
    );
  });

  it('answers no rows for a page past the end, which is a 200', () => {
    const past = parseListing(fixture('listing-past-end.json'));
    expect(past.rows).toEqual([]);
    expect(past.totalPages).toBe(3);
  });

  it('reads the weight fields of a row sold by weight, and null elsewhere', () => {
    const weighed = parseListing(fixture('listing-weight.json')).rows.filter(
      (row) => row.weightInGrams !== null
    );
    expect(weighed.length).toBeGreaterThan(0);
    expect(weighed[0].averageWeight).toEqual(expect.any(Number));
    expect(first.rows[0].weightInGrams).toBeNull();
    expect(first.rows[0].averageWeight).toBeNull();
  });

  it('reads a null brand for a row that carries none', () => {
    const rows = parseListing(fixture('listing-weight.json')).rows;
    expect(rows.some((row) => row.brand === null)).toBe(true);
  });

  it('keeps only_club_dia on every promotion it reads', () => {
    const rows = parseListing(fixture('listing-club.json')).rows;
    const promoted = rows.filter((row) => row.promotions.length > 0);
    expect(promoted.length).toBeGreaterThan(0);
    for (const row of promoted) {
      for (const promotion of row.promotions) {
        expect(promotion.description).toEqual(expect.any(String));
        expect(typeof promotion.onlyClubDia).toBe('boolean');
      }
    }
  });

  it('skips a row with no id or no name, and answers nothing for no body', () => {
    expect(
      parseListing({
        plp_items: [{ display_name: 'no id' }, { sku_id: '1' }],
      }).rows
    ).toEqual([]);
    expect(parseListing(null).rows).toEqual([]);
  });
});
