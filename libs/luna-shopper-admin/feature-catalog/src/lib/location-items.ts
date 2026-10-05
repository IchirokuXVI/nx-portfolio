import { inject } from '@angular/core';
import { RESOURCE_GATEWAYS } from '@portfolio/luna-shopper-admin/data-access';
import {
  compositeIdOf,
  defineResource,
  localizedTextValue,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { LOCATION_ITEM_KEY, locationItemSource } from './catalog-sources';

/** Where a product sits in one particular shop, as the gateway describes it. */
export type LocationItem = Wire.CatalogSupermarketLocationItemView;

/**
 * The per shop half of a product (plan 0005, section 4, last paragraph).
 *
 * It exists because the price moved to the scope and left `positionInStore`
 * with nowhere to live: a warehouse cannot answer which aisle a product is in,
 * so the question needed a home rather than nowhere.
 *
 * **`available` here is not the `available` on a price, and the two are not
 * shown as one checkbox.** On a price it is scope wide: this product is sold at
 * this scope. Here it is a nullable claim about one shop, and null means "use
 * whatever the scope says", which is a different claim from "not available
 * here". Two columns making two different claims, so they carry two different
 * labels and this one says what its empty state means.
 *
 * **Neither is written from its form.** Backend plan 0084 gave the per shop
 * column provenance and took it off `supermarketLocationItem.upsert`, because a
 * crawl writes it too now and the row has to record which writer did. So it is
 * shown here and set through the availability route, exactly as the scope wide
 * flag on a price already was.
 *
 * Three things about its shape, all of them the gateway's rather than choices:
 *
 * - **A shop must be named before anything can be read.** Aisle positions are
 *   per shop by definition, so a listing across every shop would be rows
 *   nothing could read, and the route's own DTO makes the parameter required.
 * - **Create and change are one `PUT`** to the collection, keyed on
 *   `(itemId, supermarketLocationId)`. The upsert merges, so a change sends what
 *   changed and nothing it leaves out is blanked.
 * - **There is no delete at all.** Clearing the position and the override says
 *   everything a delete would, and there is no route for it. So the descriptor
 *   does not offer one, rather than offering a button that answers 404.
 */
export const LOCATION_ITEMS = defineResource<LocationItem>({
  name: 'location-items',
  // The Products tab of a shop, at
  // `/chains/{chainId}/shops/{shopId}/products` (admin plan 0042).
  segment: 'products',
  labels: {
    one: 'catalog.locationItems.one',
    many: 'catalog.locationItems.many',
    create: 'catalog.locationItems.add',
  },

  // The shop is in the address.
  parent: {
    resource: 'locations',
    param: 'shopId',
    filter: 'supermarketLocationId',
  },

  // The pair the row is keyed on, because no route reads one by its own uuid.
  rowId: (row) => compositeIdOf(row, LOCATION_ITEM_KEY),

  // The product's name, which the read joins on (admin plan 0042, section 2).
  // The id only when the product is gone and the join found nothing.
  title: (row, locales) =>
    localizedTextValue(row.itemName, locales) || row.itemId,

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
      // Half of what the row *is*. Changing it would write a second row rather
      // than move this one, so it is settable once.
      editable: 'create',
      // Named by the row itself, never by a request per row.
      nameFrom: 'itemName',
    },
    {
      kind: 'text',
      name: 'itemBrand',
      label: 'catalog.locationItems.itemBrand',
      // The product's brand, joined on beside its name. Changed on the
      // product, never here.
      editable: false,
    },
    {
      kind: 'reference',
      name: 'supermarketLocationId',
      label: 'catalog.locationItems.supermarketLocationId',
      resource: 'locations',
      required: true,
      editable: 'create',
    },
    {
      kind: 'text',
      name: 'positionInStore',
      label: 'catalog.locationItems.positionInStore',
      help: 'catalog.locationItems.positionInStoreHelp',
      nullable: true,
      maxLength: 120,
    },
    {
      kind: 'boolean',
      name: 'available',
      label: 'catalog.locationItems.available',
      help: 'catalog.locationItems.availableHelp',
      // Null is a real answer here and the ordinary one: it defers to the
      // scope. So the field is nullable, and clearing it is not the same as
      // saying no.
      nullable: true,
      // **Read only since backend plan 0084.** The column carries provenance
      // now, and `supermarketLocationItem.upsert` no longer writes it: a crawl
      // writes it through `setAvailability`, and so does a person, so that the
      // row records which of them said so and an automated fetch can be refused
      // the ones a person filled. A checkbox on this form would send a field
      // the route drops, which is worse than not offering one.
      editable: false,
    },
  ],

  list: {
    columns: ['itemId', 'itemBrand', 'positionInStore', 'available'],
    compact: ['itemBrand', 'positionInStore', 'available'],
  },

  actions: { create: true, edit: true },

  gateway: () =>
    inject(RESOURCE_GATEWAYS).for<LocationItem>(locationItemSource()),
});
