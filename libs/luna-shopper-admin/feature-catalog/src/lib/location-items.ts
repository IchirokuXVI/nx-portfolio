import { inject } from '@angular/core';
import { RESOURCE_GATEWAYS } from '@portfolio/luna-shopper-admin/data-access';
import {
  defineResource,
  naturalKey,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { LOCATION_ITEMS_PATH } from './catalog-paths';
import { LOCATION_ITEM_SEED } from './location-items-seed';

/** One product in one shop, as the gateway describes it. */
export type SupermarketLocationItem = Wire.CatalogSupermarketLocationItemView;

/** What addresses a row: the product and the shop, and nothing else. */
export const LOCATION_ITEM_KEY = ['itemId', 'supermarketLocationId'] as const;

/**
 * Where a product sits in one particular shop (plan 0005, section 1).
 *
 * The aisle position, and the per shop availability override. Both are things
 * only a person standing in that shop can know, which is why this is the one
 * catalog list that begins from a shop rather than from everything: aisle
 * positions are per shop by definition, and a listing across shops would be
 * rows nothing could read.
 *
 * **`available` here is not the `available` on a price**, and the labels say so
 * rather than showing two checkboxes with one name. A price's flag is scope
 * wide: the chain does not sell this at all. This one is a per shop override
 * meaning somebody checked this specific shop, and leaving it empty is a third
 * answer, "use whatever the scope says", which is not the same claim as "not
 * available here".
 *
 * **A row cannot be deleted, because the gateway offers no route to delete
 * one.** There is a `PUT` and a `GET` and nothing else. Clearing the position
 * and clearing the override empties the row of everything it asserts, which is
 * the repair available; the plan's exit criterion is not fully met here and it
 * is a missing backend route rather than a missing screen.
 */
export const LOCATION_ITEMS = defineResource<SupermarketLocationItem>({
  name: 'location-items',
  segment: 'location-items',
  labels: {
    one: 'catalog.locationItems.one',
    many: 'catalog.locationItems.many',
  },

  // The product's own name would need a request per row, which a list cannot
  // afford, so a row is titled by where it is: that is what this screen is
  // about, and the operator already chose the shop.
  title: (row) => row.positionInStore ?? row.itemId,

  identify: (row) => naturalKey(row, LOCATION_ITEM_KEY),

  fields: [
    {
      kind: 'text',
      name: 'id',
      label: 'catalog.locationItems.id',
      editable: false,
    },
    {
      kind: 'reference',
      name: 'itemId',
      label: 'catalog.locationItems.itemId',
      resource: 'items',
      required: true,
      // Half of what addresses the row. Changing it would be a different row
      // rather than a change to this one.
      createOnly: true,
    },
    {
      kind: 'reference',
      name: 'supermarketLocationId',
      label: 'catalog.locationItems.supermarketLocationId',
      resource: 'locations',
      required: true,
      createOnly: true,
    },
    {
      kind: 'text',
      name: 'positionInStore',
      label: 'catalog.locationItems.positionInStore',
      help: 'catalog.locationItems.positionInStoreHelp',
      maxLength: 120,
      nullable: true,
    },
    {
      kind: 'boolean',
      name: 'available',
      label: 'catalog.locationItems.available',
      help: 'catalog.locationItems.availableHelp',
      nullable: true,
    },
  ],

  list: {
    columns: ['itemId', 'positionInStore', 'available'],
    compact: ['positionInStore', 'available'],
  },

  filters: [
    {
      kind: 'reference',
      param: 'supermarketId',
      label: 'catalog.locationItems.supermarketId',
      resource: 'supermarkets',
      required: true,
      // The route takes a shop and no chain, but a shop cannot be searched for
      // without one: shops are addressed under their chain. So this narrows the
      // picker below it and is never sent.
      local: true,
    },
    {
      kind: 'reference',
      param: 'supermarketLocationId',
      label: 'catalog.locationItems.supermarketLocationId',
      resource: 'locations',
      required: true,
      scopedBy: 'supermarketId',
    },
  ],

  // No sorts, and no delete: the route accepts an `order` parameter and drops
  // it, and there is no `DELETE` at all.
  actions: { create: true, edit: true, delete: false },

  /**
   * The rows, written with a `PUT` and read out of a shop's list.
   *
   * There is no member route of any kind, so a row is found by listing the
   * shop's rows and matching the product within them. The shop is what the
   * route filters on; the product is not, which is why it is not among the
   * `keyFilters`.
   */
  gateway: () =>
    inject(RESOURCE_GATEWAYS).for<SupermarketLocationItem>({
      path: LOCATION_ITEMS_PATH,
      seed: LOCATION_ITEM_SEED,
      upsert: true,
      key: LOCATION_ITEM_KEY,
      keyFilters: ['supermarketLocationId'],
    }),
});
