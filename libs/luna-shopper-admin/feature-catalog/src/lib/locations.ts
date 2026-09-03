import { inject } from '@angular/core';
import {
  RESOURCE_GATEWAYS,
  type ResourceGatewaysI,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  CONTENT_LOCALES,
  defineResource,
  localizedTextValue,
  type ResourceGateway,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { POSTAL_CODE_SOURCES } from './catalog-enums';
import { LOCATIONS_PATH, locationsOfPath } from './catalog-paths';
import { LOCATION_SEED } from './locations-seed';

/** A shop, as the gateway describes it. */
export type SupermarketLocation = Wire.CatalogSupermarketLocationView;

/**
 * One chain's shops, and the postal code that was guessed (plan 0005, section 3).
 *
 * **`postalCodeSource` distinguishes three states, and the screen keeps them
 * apart.** `SOURCE` is what the shop itself published, `MANUAL` is what a person
 * typed, and `DERIVED` was inferred from the nearest centroid rather than known.
 * A shop with **no** postal code has no source either, and that is a deliberate
 * fourth answer rather than an error: a shop whose nearest centroid was beyond
 * the bound keeps both empty, because a wrong postcode is worse than none.
 *
 * The filter is the whole of the review queue this plan promises, and most of
 * its value for almost none of its work: listing the `DERIVED` rows is the
 * question "which of these addresses did we guess". A shop with neither a code
 * nor a source matches no value of it, which is right, since it is a different
 * problem with a different repair.
 *
 * **Editing a postal code does not move the shop's price scope.** That is stated
 * in the entity and it is a real trap: an operator correcting an address may
 * reasonably expect the pricing to follow, and it does not. The help under the
 * field says so where the mistake would be made.
 *
 * **The chain is a required filter, not a nicety.** There is no route that lists
 * shops across chains: a chain's shops are addressed under the chain. So the
 * list waits for one and says what it is waiting for, rather than asking for
 * something that could only be refused.
 */
export const LOCATIONS = defineResource<SupermarketLocation>({
  name: 'locations',
  segment: 'locations',
  labels: { one: 'catalog.locations.one', many: 'catalog.locations.many' },

  title: (row) => {
    const label = localizedTextValue(row.label, CONTENT_LOCALES);
    if (label !== '') {
      return label;
    }
    // A shop very often has no label of its own, so its address is its name.
    // Falling through to the city keeps a picker readable where even that is
    // missing, which is the ordinary state of a freshly discovered place.
    return row.address ?? row.city ?? row.id;
  },

  fields: [
    {
      kind: 'text',
      name: 'id',
      label: 'catalog.locations.id',
      editable: false,
    },
    {
      kind: 'reference',
      name: 'supermarketId',
      label: 'catalog.locations.supermarketId',
      help: 'catalog.locations.supermarketIdHelp',
      resource: 'supermarkets',
      required: true,
      // The chain is the path a shop is created under, and no update route
      // takes one. A shop cannot change chains: that is a different shop.
      createOnly: true,
    },
    {
      kind: 'localized-text',
      name: 'label',
      label: 'catalog.locations.label',
      help: 'catalog.locations.labelHelp',
      locales: CONTENT_LOCALES,
      maxLength: 200,
      nullable: true,
    },
    {
      kind: 'text',
      name: 'address',
      label: 'catalog.locations.address',
      nullable: true,
    },
    {
      kind: 'text',
      name: 'city',
      label: 'catalog.locations.city',
      nullable: true,
    },
    {
      kind: 'text',
      name: 'country',
      label: 'catalog.locations.country',
      help: 'catalog.locations.countryHelp',
      nullable: true,
    },
    {
      kind: 'text',
      name: 'postalCode',
      label: 'catalog.locations.postalCode',
      help: 'catalog.locations.postalCodeHelp',
      maxLength: 16,
      nullable: true,
    },
    {
      kind: 'enum',
      name: 'postalCodeSource',
      label: 'catalog.locations.postalCodeSource',
      help: 'catalog.locations.postalCodeSourceHelp',
      options: POSTAL_CODE_SOURCES,
      // The service decides it: typing a code makes the source MANUAL, and
      // there is no property on the update DTO to say otherwise. Shown, because
      // whether a code was guessed is the most useful thing on this screen.
      editable: false,
    },
    {
      kind: 'reference',
      name: 'priceScopeId',
      label: 'catalog.locations.priceScopeId',
      help: 'catalog.locations.priceScopeIdHelp',
      resource: 'price-scopes',
      nullable: true,
    },
    {
      kind: 'number',
      name: 'latitude',
      label: 'catalog.locations.latitude',
      min: -90,
      max: 90,
      nullable: true,
    },
    {
      kind: 'number',
      name: 'longitude',
      label: 'catalog.locations.longitude',
      min: -180,
      max: 180,
      nullable: true,
    },
    {
      kind: 'text',
      name: 'externalRef',
      label: 'catalog.locations.externalRef',
      help: 'catalog.locations.externalRefHelp',
      nullable: true,
    },
    {
      kind: 'text',
      name: 'externalProvider',
      label: 'catalog.locations.externalProvider',
      maxLength: 32,
      nullable: true,
    },
  ],

  list: {
    columns: ['address', 'city', 'postalCode', 'postalCodeSource', 'label'],
    // The postal code and where it came from survive to a phone, because that
    // pair is the reason this screen has a review filter at all: a code with no
    // source beside it cannot be judged.
    compact: ['address', 'postalCode', 'postalCodeSource'],
  },

  filters: [
    {
      kind: 'reference',
      param: 'supermarketId',
      label: 'catalog.locations.supermarketId',
      resource: 'supermarkets',
      required: true,
    },
    {
      kind: 'enum',
      param: 'postalCodeSource',
      label: 'catalog.locations.postalCodeSource',
      options: POSTAL_CODE_SOURCES,
    },
    {
      kind: 'reference',
      param: 'priceScopeId',
      label: 'catalog.locations.priceScopeId',
      resource: 'price-scopes',
      scopedBy: 'supermarketId',
    },
  ],

  // No sorts. The route accepts an `order` parameter and drops it.

  actions: { create: true, edit: true, delete: true },

  /**
   * The shops, addressed under two different paths.
   *
   * A chain's shops are listed and created at `/supermarkets/{id}/locations`,
   * and one shop is read, changed and deleted at `/locations/{id}`. So the
   * collection's path is built from the chain filter and the member's is not,
   * and `supermarketId` is a path segment rather than a parameter the list
   * route declares.
   */
  gateway: () => locationGateway(inject(RESOURCE_GATEWAYS)),
});

/** The shops' gateway, typed, for the screens that count them. */
export function locationGateway(
  gateways: ResourceGatewaysI
): ResourceGateway<SupermarketLocation> {
  return gateways.for<SupermarketLocation>({
    path: LOCATIONS_PATH,
    seed: LOCATION_SEED,
    collectionPath: (scope) => locationsOfPath(scope['supermarketId'] ?? ''),
    pathFilters: ['supermarketId'],
  });
}
