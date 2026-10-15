import { asksForShop, type ShopAskFacts } from './shop-ask';

/** The facts of a first buy that asks: no shop anywhere, and nothing answered. */
const ASKS: ShopAskFacts = {
  shopChosen: false,
  basketHasShop: false,
  neverAsk: false,
  answeredForTrip: false,
};

/**
 * The rule of velista `0141`, section 1: the question comes only when nothing says
 * where the buy happens and nothing says not to ask.
 */
describe('asksForShop', () => {
  it('asks when no shop is chosen and nothing was answered', () => {
    expect(asksForShop(ASKS)).toBe(true);
  });

  it('does not ask when a shop is chosen in the view', () => {
    expect(asksForShop({ ...ASKS, shopChosen: true })).toBe(false);
  });

  it('does not ask on a basket that has its own shop', () => {
    expect(asksForShop({ ...ASKS, basketHasShop: true })).toBe(false);
  });

  it('does not ask on a device that said "Don\'t ask again"', () => {
    expect(asksForShop({ ...ASKS, neverAsk: true })).toBe(false);
  });

  it('does not ask again in a trip that already answered', () => {
    expect(asksForShop({ ...ASKS, answeredForTrip: true })).toBe(false);
  });
});
