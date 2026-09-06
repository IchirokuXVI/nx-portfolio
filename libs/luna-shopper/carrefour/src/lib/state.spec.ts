import overTheCeiling from './__fixtures__/listing-over-the-ceiling.json';
import listingPage from './__fixtures__/listing-page.json';
import productPage from './__fixtures__/product-page.json';
import { readDetail, readListing } from './state';
import { CARREFOUR_CEILING, CARREFOUR_PAGE_SIZE } from './types';

const state = (fixture: unknown): Record<string, unknown> =>
  fixture as Record<string, unknown>;

describe('readListing', () => {
  const listing = readListing(state(listingPage));

  it('reads the 24 cards one listing page holds', () => {
    expect(listing.cards).toHaveLength(CARREFOUR_PAGE_SIZE);
    expect(listing.pageSize).toBe(CARREFOUR_PAGE_SIZE);
  });

  it('keeps both totals apart, because they answer different questions', () => {
    // `total_results` is what the result set holds. `total_pages * page_size`
    // is what paging will hand over, and it stops at the ceiling. Comparing the
    // wrong one against the ceiling loses five products in six.
    expect(listing.totalResults).toBeGreaterThan(CARREFOUR_CEILING);
    expect(listing.pageableResults).toBe(CARREFOUR_CEILING);
  });

  it('names the first level categories and this page own children', () => {
    expect(listing.firstLevelCategories.length).toBeGreaterThan(1);
    for (const link of listing.firstLevelCategories) {
      expect(link.id).not.toBe('');
      expect(link.url).not.toBe('');
    }
  });

  it('reads a card with the fields a run writes', () => {
    const card = listing.cards[0];
    expect(typeof card.product_id).toBe('string');
    expect(typeof card.name).toBe('string');
    expect(card.price).toMatch(/€/);
  });

  it('names the children of a category that is over the ceiling', () => {
    const parent = readListing(state(overTheCeiling));
    expect(parent.totalResults).toBeGreaterThan(CARREFOUR_CEILING);
    expect(parent.secondLevelCategories.length).toBeGreaterThan(0);
  });

  it('answers empty values for a state it does not understand', () => {
    // The state is a large object owned by somebody else. A page a run does not
    // understand must record nothing and let the run carry on.
    const empty = readListing({});
    expect(empty.cards).toEqual([]);
    expect(empty.totalResults).toBe(0);
    expect(empty.firstLevelCategories).toEqual([]);
  });
});

describe('readDetail', () => {
  it('reads the EAN a listing card does not carry', () => {
    const detail = readDetail(state(productPage));
    expect(detail).not.toBeNull();
    expect(detail?.ean).toMatch(/^\d{13}$/);
  });

  it('names the same product the listing card did', () => {
    const detail = readDetail(state(productPage));
    const ids = readListing(state(listingPage)).cards.map((c) => c.product_id);
    expect(ids).toContain(detail?.externalId);
  });

  it('treats a missing EAN as a value and not as an error', () => {
    // Some pages carry none. The entry is written without one and the fuzzy
    // rung does its job (plan 0090, section 12.1).
    const detail = readDetail({
      pdp: { product: { product_id: '1', ean: '' } },
    });
    expect(detail).toEqual({ externalId: '1', ean: null });
  });

  it('answers null for a page that carries no product at all', () => {
    expect(readDetail({})).toBeNull();
  });
});
