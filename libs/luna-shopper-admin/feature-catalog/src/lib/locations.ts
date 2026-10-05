import { computed, inject, Injector } from '@angular/core';
import { RESOURCE_GATEWAYS } from '@portfolio/luna-shopper-admin/data-access';
import { RECORD_CONTEXT } from '@portfolio/luna-shopper-admin/feature-resource';
import {
  CONTENT_LOCALES,
  defineResource,
  localizedTextValue,
  type ResourceRow,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { POSTAL_CODE_SOURCE_OPTIONS, priceScopeMark } from './catalog-enums';
import { locationSource } from './catalog-sources';
import { ShopSectionsTab } from './chains/section-tabs';

/**
 * One shop of one chain, as the gateway describes it.
 *
 * `mapUrl` is no column. The page draws it as a row of its own, worked out
 * from the two coordinates, and a field has to be named by a property.
 */
export type Location = Wire.CatalogSupermarketLocationView & {
  readonly mapUrl?: string | null;
};

/** The key of the Sections tab of a shop: the `name` of the part. */
const SHOP_SECTIONS_TAB = 'sections';

/** Whether the postal code of a shop was inferred, and never checked. */
function postalCodeGuessed(row: Partial<Location>): boolean {
  return row.postalCodeSource === 'DERIVED';
}

/**
 * Where a shop is on OpenStreetMap, or `null` when a coordinate is missing
 * (admin plan 0056, target 8). A link and no map: a map is a field kind of
 * its own, and it brings a dependency.
 */
export function shopMapUrl(row: Partial<Location>): string | null {
  const { latitude, longitude } = row;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return null;
  }
  return (
    `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}` +
    `#map=18/${latitude}/${longitude}`
  );
}

/**
 * The kinds a shop's picker offers: every kind but `STORE` (admin plan 0028,
 * section 4.2).
 */
export const SHOP_PICKABLE_SCOPE_KINDS: readonly string[] = [
  'LOCAL_AREA',
  'REGION',
  'NATIONAL',
];

/**
 * Whether a price scope is this shop's own single shop scope, which the form
 * keeps (admin plan 0028, section 4.1).
 *
 * Catalog keys a shop's `STORE` scope on the shop's id (backend plan 0116), so
 * a list of ids cannot answer it: the scope's own kind and key can, which is
 * why the field asks with the scope's row. A shop that has no id yet is a
 * create, and holds nothing to keep.
 */
export function isOwnStoreScope(
  shop: Partial<Location>,
  scope: ResourceRow
): boolean {
  return (
    typeof shop.id === 'string' &&
    shop.id !== '' &&
    scope['kind'] === 'STORE' &&
    scope['externalKey'] === shop.id
  );
}

/** A column that holds something to read. */
function present(part: string | null | undefined): part is string {
  return part != null && part !== '';
}

/**
 * What a shop is called when it has no label, no address and no town (admin
 * plan 0049, target 3): its postal code, then the reference its source gave
 * it, then its id.
 *
 * Never nothing. Every one of those three columns can be null, and a shop
 * that had none of them was a row with no text in it: the tab above the list
 * counted two shops and the operator saw one. The id is the last answer for
 * the reason a shopping list with no name is called by its id: a row has to
 * be something a person can point at.
 */
function lastName(row: Location): string {
  return [row.postalCode, row.externalRef].find(present) ?? row.id;
}

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
 * ## The price scopes
 *
 * A shop sells at a stack of scopes, and the most specific one with a valid
 * price for a product answers (backend plan 0105). It always holds a `STORE`
 * scope of its own beside the others (backend plan 0116), which the form keeps
 * and never offers to remove, and which catalog adds by itself to a new shop
 * (admin plan 0028, section 4).
 *
 * **Editing the postal code does not move the price scope.** That is stated on
 * the entity, it is stated on the gateway route, and it is a real trap: an
 * operator correcting an address may reasonably expect the pricing to follow,
 * and it does not. So it is said a third time, on the field, where it is being
 * done.
 */
export const LOCATIONS = defineResource<Location>({
  name: 'locations',
  // The Shops tab of a chain, at `/chains/{chainId}/shops` (admin plan 0042).
  segment: 'shops',
  labels: {
    one: 'catalog.locations.one',
    many: 'catalog.locations.many',
    create: 'catalog.locations.add',
  },

  // The chain is in the address. It used to be a filter the operator had to
  // pick before the list would read anything.
  parent: {
    resource: 'supermarkets',
    param: 'chainId',
    filter: 'supermarketId',
  },

  /**
   * A shop's name is usually its address, because that is what distinguishes
   * two Mercadonas in one city. The label is set by hand and most shops have
   * none.
   */
  title: (row, locales) => {
    const label = localizedTextValue(row.label, locales);
    if (label !== '') {
      return label;
    }
    const place = [row.address, row.city].filter(present).join(', ');
    return place !== '' ? place : lastName(row);
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
      kind: 'references',
      name: 'priceScopeIds',
      label: 'catalog.locations.priceScopeIds',
      help: 'catalog.locations.priceScopeIdsHelp',
      resource: 'price-scopes',
      // A chain holds a handful of scopes a shop is ever put in, so one cached
      // resolve per id names the chips and the column.
      nameLookup: true,
      // The shop's own chain, and every kind but `STORE`: its own store scope
      // is already in the stack, and another shop's is never a sensible choice
      // (backend plan 0116, section 7, which refuses one anyway). Nothing is
      // offered until the chain is known, since a scope of another chain would
      // be refused too.
      scopeFrom: (row) =>
        typeof row.supermarketId === 'string' && row.supermarketId !== ''
          ? {
              supermarketId: row.supermarketId,
              kind: SHOP_PICKABLE_SCOPE_KINDS,
            }
          : null,
      locked: (row, scope) => isOwnStoreScope(row, scope),
      // How far each scope reaches, from the mark the price scope list
      // draws for the same kind.
      mark: (scope) => priceScopeMark(scope['kind']),
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
      // A guess is the one value of a shop a person has to look at.
      check: (row) =>
        postalCodeGuessed(row)
          ? { label: 'catalog.locations.postalCodeGuessed' }
          : null,
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
      // For display only: the two numbers above, as a place on a map.
      kind: 'text',
      name: 'mapUrl',
      label: 'catalog.locations.mapUrl',
      format: 'url',
      linkLabel: 'catalog.locations.openOnMap',
      editable: false,
      setBy: 'catalog.locations.mapFollows',
      read: (row) => shopMapUrl(row),
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
      // The key of a provider, copied letter by letter.
      format: 'code',
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
      'priceScopeIds',
    ],
    // The card is titled with the address, so what goes under it is the town and
    // the two columns this screen exists for: the postal code and whether
    // anybody actually knows it.
    compact: ['city', 'postalCode', 'postalCodeSource'],
    // The column beside the open shop: the address, then the town and the
    // postal code. The states below say the rest.
    brief: {
      heading: (row, locales) =>
        localizedTextValue(row.label, locales) ||
        row.address ||
        row.city ||
        lastName(row),
      line: ['city', 'postalCode'],
    },
  },

  /**
   * What a row says beside its address, at most two today.
   *
   * "Map" for a shop with a walk shown to shoppers, and "Postal code guessed"
   * for a code that was inferred and that nobody has checked, which is the
   * one a person has to look at.
   *
   * The mock has a third, "Own section order". The list read does not say
   * whether a shop's sections are its own or its chain's: only the read of one
   * shop's sections does. So the shop's Sections tab says it, and the row does
   * not guess.
   */
  rowStates: () => (row) => [
    ...(row.hasMap
      ? [{ label: 'catalog.locations.state.map', tone: 'neutral' as const }]
      : []),
    ...(postalCodeGuessed(row)
      ? [
          {
            label: 'catalog.locations.state.postalCodeGuessed',
            tone: 'waiting' as const,
          },
        ]
      : []),
  ],

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

  actions: { create: true, edit: true, delete: true },

  // What the page of a shop draws (admin plan 0056, section 3.2). Details is
  // the first tab. The chain is the parent and is named in no section: a new
  // shop shows it as a locked value, and a saved one sits under its chain.
  record: {
    sections: [
      { title: 'catalog.locations.section.name', fields: ['label'] },
      {
        title: 'catalog.locations.section.address',
        fields: [
          'address',
          'city',
          'postalCode',
          'country',
          'latitude',
          'longitude',
          'mapUrl',
        ],
      },
      {
        title: 'catalog.locations.section.prices',
        fields: ['priceScopeIds'],
      },
      {
        title: 'catalog.locations.section.source',
        fields: ['externalProvider', 'externalRef'],
      },
    ],
    children: [
      {
        as: 'tab',
        name: SHOP_SECTIONS_TAB,
        label: 'catalog.shops.tabs.sections',
        component: ShopSectionsTab,
      },
      // A list whose rows open, so `chainsRoutes` hands the route over.
      {
        as: 'tab',
        resource: 'location-items',
        by: 'supermarketLocationId',
        label: 'catalog.shops.tabs.products',
      },
    ],
    facts: { also: ['postalCodeSource'] },
    // Catalog deletes the order of its sections and its own scope with it.
    deleteBody: 'catalog.shops.deleteBody',
    /**
     * The sections the shop walks, counted off the shop's own row.
     *
     * Through `counts` and not a field: the count beside a tab is read from
     * the property a child names, and the length of a list is no property.
     * The page is found when the count is read and not when this is built,
     * since the page builds its counts while it is itself being built. The
     * row is a signal, so the count follows every read of the shop.
     */
    counts: () => {
      const injector = inject(Injector);
      return () =>
        computed(() => {
          const sections = injector.get(RECORD_CONTEXT).row()?.['sections'];
          return {
            [SHOP_SECTIONS_TAB]: Array.isArray(sections)
              ? sections.length
              : null,
          };
        });
    },
  },

  gateway: () => inject(RESOURCE_GATEWAYS).for<Location>(locationSource()),
});
