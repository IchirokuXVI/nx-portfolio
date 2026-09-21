import {
  BASKET_PATHS,
  basketPath,
  filterSheetPath,
  settleSheetPath,
  shopPickerPath,
} from './basket-paths';

const LOCALE = 'en';
const MOUNT = '/velista';
const ID = 'b4b1f0e2-1f5a-4c2e-9a4d-6f0e2b7c1d33';

/**
 * Every URL over the basket, built from a {@link BasketAddress} (velista `0091`,
 * section 2.3).
 *
 * One page is routed twice: at `shopping-lists/:basketId`, which every link and
 * every shared basket uses, and at `shopping-lists/live`, which is the caller's
 * own. So every URL a sheet builds has to come out right on both, and the only
 * thing that decides which is the address the store holds.
 */
describe('the basket URLs', () => {
  describe('the page itself', () => {
    it('names a basket by its id', () => {
      expect(basketPath(LOCALE, MOUNT, { basketId: ID })).toBe(
        `/velista/en/shopping-lists/${ID}`
      );
    });

    it('names the caller’s own by a word', () => {
      // The same URL for every person, which is what a dashboard card and an
      // installed app's shortcut need.
      expect(basketPath(LOCALE, MOUNT, 'live')).toBe(
        '/velista/en/shopping-lists/live'
      );
    });

    it('agrees with the route table', () => {
      expect(BASKET_PATHS.live).toBe('shopping-lists/live');
    });

    it('lands on the history when the store has let the basket go', () => {
      // Unreachable in practice, since a sheet is destroyed with the page it
      // covers. A destination rather than a throw: a dismissal that cannot fail
      // is worth more here than a report of a state nobody can reach.
      expect(basketPath(LOCALE, MOUNT, null)).toBe(
        '/velista/en/shopping-lists'
      );
    });

    it('builds the standalone form with no mount in front', () => {
      expect(basketPath(LOCALE, '', 'live')).toBe('/en/shopping-lists/live');
    });
  });

  describe('the sheets over it', () => {
    it('addresses the settle sheet under either basket', () => {
      expect(settleSheetPath(LOCALE, MOUNT, { basketId: ID }, 'row-1')).toBe(
        `/velista/en/shopping-lists/${ID}/sheet/rows/row-1/settle`
      );
      expect(settleSheetPath(LOCALE, MOUNT, 'live', 'row-1')).toBe(
        '/velista/en/shopping-lists/live/sheet/rows/row-1/settle'
      );
    });

    it('addresses the filter sheet under either basket', () => {
      expect(filterSheetPath(LOCALE, MOUNT, { basketId: ID })).toBe(
        `/velista/en/shopping-lists/${ID}/sheet/filter`
      );
      expect(filterSheetPath(LOCALE, MOUNT, 'live')).toBe(
        '/velista/en/shopping-lists/live/sheet/filter'
      );
    });

    it('addresses the shop picker under either basket', () => {
      expect(shopPickerPath(LOCALE, MOUNT, { basketId: ID })).toBe(
        `/velista/en/shopping-lists/${ID}/sheet/filter/shop`
      );
      expect(shopPickerPath(LOCALE, MOUNT, 'live')).toBe(
        '/velista/en/shopping-lists/live/sheet/filter/shop'
      );
    });

    it('stamps the marker rather than letting a caller write it', () => {
      // A URL written by hand is the one that can quietly opt out of the rule,
      // and the rule is what stops a sheet and a page competing for one address.
      expect(filterSheetPath(LOCALE, MOUNT, 'live')).toContain(
        '/shopping-lists/live/sheet/'
      );
    });
  });
});
