import { PostalCodeSource } from '@portfolio/luna-shopper/contracts';
import {
  placeImportBlockers,
  type PlaceImportSubject,
} from './place-import-check';

/**
 * The completeness check a trusted import passes through (plan 0107, section
 * 3.2).
 *
 * It is a table of cases and nothing else, which is the visible proof that the
 * function is pure: no `TestingModule`, no repository fake, no catalog fake.
 */
function place(over: Partial<PlaceImportSubject> = {}): PlaceImportSubject {
  return {
    externalRef: 'lidl/1234',
    name: 'Lidl Córdoba Poniente',
    latitude: 37.8882,
    longitude: -4.8035,
    postalCode: '14013',
    postalCodeSource: PostalCodeSource.SOURCE,
    country: 'es',
    brandKey: 'Q151954',
    brandName: 'Lidl',
    ...over,
  };
}

describe('placeImportBlockers (plan 0107, section 3.2)', () => {
  it('lets a complete place through', () => {
    expect(placeImportBlockers(place())).toEqual([]);
  });

  it.each([
    ['externalRef', { externalRef: '   ' }, 'externalRef'],
    ['no name', { name: null }, 'name'],
    ['a blank name', { name: '  ' }, 'name'],
    ['no latitude', { latitude: null }, 'latitude'],
    ['no longitude', { longitude: null }, 'longitude'],
    ['no postal code', { postalCode: null }, 'postalCode'],
    ['no country', { country: null }, 'country'],
  ])('refuses %s', (_case, over, blocker) => {
    expect(
      placeImportBlockers(place(over as Partial<PlaceImportSubject>))
    ).toEqual([blocker]);
  });

  it('refuses a postal code that was derived rather than stated', () => {
    // The one field that is not merely present or absent. A derived code is the
    // nearest centroid to a pair of coordinates, and putting a shop in somebody
    // else's list with nobody looking is what the review queue exists for.
    expect(
      placeImportBlockers(
        place({
          postalCode: '14013',
          postalCodeSource: PostalCodeSource.DERIVED,
        })
      )
    ).toEqual(['postalCode']);
  });

  it('takes either half of the chain identity', () => {
    expect(placeImportBlockers(place({ brandName: null }))).toEqual([]);
    expect(placeImportBlockers(place({ brandKey: null }))).toEqual([]);
  });

  it('refuses a place that names no chain at all', () => {
    // The shop's own name is not a third rung here, however much the admin path
    // allows it: importing twelve shops that each fell back to their own name
    // writes twelve chains.
    expect(
      placeImportBlockers(place({ brandKey: null, brandName: null }))
    ).toEqual(['chain']);
  });

  it('names every field that is missing, not the first one', () => {
    // An operator reading the run's report gets the whole list, so one edit
    // answers the whole row rather than uncovering the next blocker.
    expect(
      placeImportBlockers(
        place({ name: null, postalCode: null, brandKey: null, brandName: null })
      )
    ).toEqual(['name', 'postalCode', 'chain']);
  });

  it('refuses a place whose coordinates are not numbers', () => {
    expect(
      placeImportBlockers(place({ latitude: Number.NaN, longitude: null }))
    ).toEqual(['latitude', 'longitude']);
  });
});
