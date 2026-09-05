import { inject } from '@angular/core';
import { RESOURCE_GATEWAYS } from '@portfolio/luna-shopper-admin/data-access';
import {
  CONTENT_LOCALES,
  defineResource,
  localizedTextValue,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { POSTAL_CODE_SOURCE_OPTIONS } from './catalog-enums';
import { locationSource } from './catalog-sources';

/** One shop of one chain, as the gateway describes it. */
export type Location = Wire.CatalogSupermarketLocationView;

/**
 * The shops (plan 0005, section 3).
 *
 * **This resource lives at two URLs, and that is the gateway's shape rather
 * than a choice made here.** A chain's shops are listed and created under the
 * chain, at `/supermarkets/{id}/locations`, and one shop is read, changed and
 * deleted at `/locations/{id}`. So the collection is a function of the chain,
 * which is a filter on the list and a submitted field on the create, and the
 * chain is therefore **required** before anything can be read at all: there is
 * no route that answers "every shop of every chain".
 *
 * ## The postal code that was guessed
 *
 * `postalCodeSource` says where the code came from, and `DERIVED` means it was
 * inferred from the nearest centroid rather than known. There is no review
 * queue in this plan and does not need to be: the filter is most of the value
 * for almost none of the work, and the column is a column so an operator can
 * see which addresses are guesses without filtering at all.
 *
 * The three states are kept apart rather than collapsed into "missing":
 *
 * - a code with a source is **known**,
 * - a code whose source is `DERIVED` is a **guess**,
 * - a null code with a null source is neither, and is **deliberate**. A shop
 *   whose nearest centroid was beyond the bound keeps both null, because a
 *   wrong postcode is worse than none. It matches no value of the filter, since
 *   it has no source, and that is the honest answer rather than a gap.
 *
 * **Editing the postal code does not move the price scope.** That is stated on
 * the entity, it is stated on the gateway route, and it is a real trap: an
 * operator correcting an address may reasonably expect the pricing to follow,
 * and it does not. So it is said a third time, on the field, where it is being
 * done.
 */
export const LOCATIONS = defineResource<Location>({
  name: 'locations',
  segment: 'locations',
  labels: { one: 'catalog.locations.one', many: 'catalog.locations.many' },

  /**
   * A shop's name is usually its address, because that is what distinguishes
   * two Mercadonas in one city. The label is set by hand and most shops have
   * none.
   */
  title: (row) => {
    const label = localizedTextValue(row.label, CONTENT_LOCALES);
    if (label !== '') {
      return label;
    }
    return [row.address, row.city].filter((part) => part !== null).join(', ');
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
      resource: 'supermarkets',
      required: true,
      // The chain is in the URL a shop is created at, and
      // `UpdateSupermarketLocationDto` has no property for it. A shop does not
      // change chains; a shop that did would be a different shop.
      editable: 'create',
    },
    {
      kind: 'reference',
      name: 'priceScopeId',
      label: 'catalog.locations.priceScopeId',
      help: 'catalog.locations.priceScopeIdHelp',
      resource: 'price-scopes',
      // Left out of a create it is not a missing value: catalog gives the shop
      // a `STORE` scope of its own, which is exactly how it behaved before
      // scopes existed.
      nullable: true,
    },
    {
      kind: 'localized-text',
      name: 'label',
      label: 'catalog.locations.label',
      locales: CONTENT_LOCALES,
      nullable: true,
      maxLength: 200,
    },
    {
      kind: 'text',
      name: 'address',
      label: 'catalog.locations.address',
      nullable: true,
      maxLength: 300,
    },
    {
      kind: 'text',
      name: 'city',
      label: 'catalog.locations.city',
      nullable: true,
      maxLength: 120,
    },
    {
      kind: 'text',
      name: 'postalCode',
      label: 'catalog.locations.postalCode',
      // The trap, said where it is being done.
      help: 'catalog.locations.postalCodeHelp',
      nullable: true,
      maxLength: 16,
    },
    {
      kind: 'enum',
      name: 'postalCodeSource',
      label: 'catalog.locations.postalCodeSource',
      help: 'catalog.locations.postalCodeSourceHelp',
      options: POSTAL_CODE_SOURCE_OPTIONS,
      // Catalog decides it: typing a code by hand makes it `MANUAL`, and a
      // guess makes it `DERIVED`. It is on the form as a column to read, which
      // is what makes a guess visible while it is being corrected.
      editable: false,
    },
    {
      kind: 'text',
      name: 'country',
      label: 'catalog.locations.country',
      nullable: true,
      maxLength: 120,
    },
    {
      kind: 'number',
      name: 'latitude',
      label: 'catalog.locations.latitude',
      nullable: true,
      min: -90,
      max: 90,
    },
    {
      kind: 'number',
      name: 'longitude',
      label: 'catalog.locations.longitude',
      nullable: true,
      min: -180,
      max: 180,
    },
    {
      kind: 'text',
      name: 'externalRef',
      label: 'catalog.locations.externalRef',
      help: 'catalog.locations.externalRefHelp',
      nullable: true,
      maxLength: 120,
    },
    {
      kind: 'text',
      name: 'externalProvider',
      label: 'catalog.locations.externalProvider',
      nullable: true,
      maxLength: 32,
    },
  ],

  list: {
    columns: [
      'address',
      'city',
      'postalCode',
      'postalCodeSource',
      'priceScopeId',
    ],
    // The card is titled with the address, so what goes under it is the town and
    // the two columns this screen exists for: the postal code and whether
    // anybody actually knows it.
    compact: ['city', 'postalCode', 'postalCodeSource'],
  },

  note: 'catalog.locations.note',

  filters: [
    /**
     * The term a reference picker over shops types into (admin plan 0011,
     * section 4).
     *
     * It is first because it is what the picker reads, and a picker whose
     * target declares none does not fail: it drops the term, asks for the first
     * page, and answers every search with the same twenty shops. A chain with
     * ten does not notice. A chain with three hundred cannot be used at all.
     *
     * On the descriptor rather than on the screen that needed it, because the
     * descriptor is what the picker consults and there is exactly one of it.
     */
    {
      kind: 'search',
      param: 'query',
      label: 'catalog.locations.filter.query',
    },
    {
      kind: 'reference',
      param: 'supermarketId',
      label: 'catalog.locations.filter.supermarketId',
      resource: 'supermarkets',
    },
    {
      kind: 'enum',
      param: 'postalCodeSource',
      label: 'catalog.locations.filter.postalCodeSource',
      options: POSTAL_CODE_SOURCE_OPTIONS,
    },
    {
      kind: 'reference',
      param: 'priceScopeId',
      label: 'catalog.locations.filter.priceScopeId',
      resource: 'price-scopes',
    },
  ],

  // Nothing can be read until a chain is named, because there is no route that
  // lists shops across chains. The screen says so rather than drawing an empty
  // table, which would be a claim nothing had checked.
  requires: ['supermarketId'],

  actions: { create: true, edit: true, delete: true },

  gateway: () => inject(RESOURCE_GATEWAYS).for<Location>(locationSource()),
});
