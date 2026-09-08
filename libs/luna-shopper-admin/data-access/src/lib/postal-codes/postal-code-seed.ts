import type { Wire } from '@portfolio/luna-shopper-admin/models';

/**
 * What catalog and core say about a postal code, with nothing listening.
 *
 * It is keyed on the codes {@link POSTAL_CODE_DISCOVERY_SEED} uses, so the queue
 * screen and its detail page agree with each other: 14013 is the code that has
 * been looked at and has shops, 28013 is the one nobody has reached yet, and
 * 99999 is the typo that is in nobody's centroid table.
 *
 * The demand is deliberately uneven. A code twelve people typed and a code
 * derived onto twelve profiles are different facts, and a seed where main and
 * near were always equal would hide the reason they are counted apart.
 */
export const POSTAL_CODE_USAGE_SEED: readonly Wire.AdminCorePostalCodeUsageView[] =
  [
    {
      postalCode: '14013',
      mainProfiles: 9,
      nearbyProfiles: 4,
      suppressedProfiles: 1,
      mainUsers: 7,
      nearbyUsers: 4,
    },
    {
      // The one an operator should look at first: nine households typed it and
      // nobody has run a discovery for it yet.
      postalCode: '28013',
      mainProfiles: 12,
      nearbyProfiles: 0,
      suppressedProfiles: 0,
      mainUsers: 11,
      nearbyUsers: 0,
    },
    {
      postalCode: '41001',
      mainProfiles: 2,
      nearbyProfiles: 6,
      suppressedProfiles: 2,
      mainUsers: 2,
      nearbyUsers: 5,
    },
    {
      postalCode: '14900',
      mainProfiles: 1,
      nearbyProfiles: 0,
      suppressedProfiles: 0,
      mainUsers: 1,
      nearbyUsers: 0,
    },
  ];

/**
 * The shipped centroid table, for the codes this app's seeds mention.
 *
 * 99999 is **absent**, which is the point of it: a code that is not in the
 * national table is a typo, and the detail page says that rather than drawing an
 * empty neighbours list that reads as "nothing nearby".
 */
export const SHIPPED_POSTAL_CODE_SEED: readonly Wire.CatalogAdminPostalCodeView[] =
  [
    {
      country: 'es',
      postalCode: '14013',
      latitude: 37.8688,
      longitude: -4.7793,
      locationCount: 3,
    },
    {
      country: 'es',
      postalCode: '14012',
      latitude: 37.8934,
      longitude: -4.7845,
      locationCount: 1,
    },
    {
      country: 'es',
      postalCode: '14011',
      latitude: 37.8821,
      longitude: -4.7963,
      locationCount: 0,
    },
    {
      country: 'es',
      postalCode: '14004',
      latitude: 37.8752,
      longitude: -4.7881,
      locationCount: 2,
    },
    {
      // Twelve people typed it and catalog holds nothing in it, which is the
      // sentence velista shows them.
      country: 'es',
      postalCode: '28013',
      latitude: 40.4183,
      longitude: -3.7057,
      locationCount: 0,
    },
    {
      country: 'es',
      postalCode: '41001',
      latitude: 37.3903,
      longitude: -5.9945,
      locationCount: 1,
    },
    {
      country: 'es',
      postalCode: '14900',
      latitude: 37.2664,
      longitude: -4.5566,
      locationCount: 0,
    },
    {
      country: 'es',
      postalCode: '08001',
      latitude: 41.3799,
      longitude: 2.1673,
      locationCount: 4,
    },
  ];
