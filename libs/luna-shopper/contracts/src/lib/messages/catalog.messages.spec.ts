import { UNIT_BASES } from './catalog.messages';

/**
 * What a unit price may be a price per (plan 0157, section 1, and plan 0264).
 *
 * A wash is no basis to compare prices on: the count is the brand's own claim
 * (plan 0264, D4). A value added here reaches the document, the back office
 * and velista at once, so a change to the list must change this line.
 */
describe('UNIT_BASES', () => {
  it('holds exactly a kilogram, a litre, a unit and a dozen, and no wash', () => {
    expect([...UNIT_BASES]).toEqual(['KILOGRAM', 'LITER', 'UNIT', 'DOZEN']);
  });
});
