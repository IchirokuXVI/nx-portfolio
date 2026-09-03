import { inject } from '@angular/core';
import { RESOURCE_GATEWAYS } from '@portfolio/luna-shopper-admin/data-access';
import {
  CONTENT_LOCALES,
  defineResource,
  localizedTextValue,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import {
  CATALOG_SORTS,
  ITEM_CATEGORIES,
  UNITS_OF_MEASURE,
} from './catalog-enums';
import { ITEMS_PATH } from './catalog-paths';
import { ITEM_SEED } from './items-seed';

/** A product, as the gateway describes it. */
export type Item = Wire.CatalogItemView;

/**
 * The product itself (plan 0005, section 1).
 *
 * The biggest table in the catalog, at four thousand rows and rising, and the
 * one an operator reaches for most often. Three things about it are worth
 * knowing before editing this file.
 *
 * **It carries no price, and that is the honest answer rather than a gap.** The
 * admin read names no price scopes, because an operator has no postal code and
 * no shopping profile, so there is no set of scopes that is theirs and
 * inventing one would price the catalog from somewhere arbitrary. What a
 * product costs is the price screen, which lists prices as prices and says
 * which scope each belongs to.
 *
 * **`productGroupId` being empty is the ordinary state**, not a missing value.
 * A freshly harvested product belongs to no group until a person puts it in
 * one, and the "not in a group" filter is how the ones curation has not reached
 * are found: an ungrouped product is invisible to every "show me milk" read, so
 * there is no other way to see it.
 *
 * **`ean` is the only identifier that joins a product across chains.** It is
 * unique across the catalog when present, so a duplicate is refused by the
 * server rather than here, and the refusal lands under the field.
 */
export const ITEMS = defineResource<Item>({
  name: 'items',
  segment: 'items',
  labels: { one: 'catalog.items.one', many: 'catalog.items.many' },

  title: (row) => localizedTextValue(row.name, CONTENT_LOCALES),

  fields: [
    { kind: 'text', name: 'id', label: 'catalog.items.id', editable: false },
    {
      kind: 'localized-text',
      name: 'name',
      label: 'catalog.items.name',
      locales: CONTENT_LOCALES,
      required: true,
      maxLength: 200,
    },
    {
      kind: 'text',
      name: 'brand',
      label: 'catalog.items.brand',
      nullable: true,
    },
    {
      kind: 'enum',
      name: 'category',
      label: 'catalog.items.category',
      help: 'catalog.items.categoryHelp',
      options: ITEM_CATEGORIES,
      required: true,
    },
    {
      kind: 'enum',
      name: 'defaultUnit',
      label: 'catalog.items.defaultUnit',
      options: UNITS_OF_MEASURE,
      required: true,
    },
    {
      kind: 'number',
      name: 'unitSize',
      label: 'catalog.items.unitSize',
      help: 'catalog.items.unitSizeHelp',
      min: 0,
      nullable: true,
    },
    {
      kind: 'text',
      name: 'ean',
      label: 'catalog.items.ean',
      help: 'catalog.items.eanHelp',
      maxLength: 32,
      nullable: true,
    },
    { kind: 'text', name: 'sku', label: 'catalog.items.sku', nullable: true },
    {
      kind: 'text',
      name: 'imageUrl',
      label: 'catalog.items.imageUrl',
      format: 'url',
      nullable: true,
    },
    {
      kind: 'reference',
      name: 'productGroupId',
      label: 'catalog.items.productGroupId',
      help: 'catalog.items.productGroupIdHelp',
      resource: 'product-groups',
      nullable: true,
    },
  ],

  list: {
    columns: ['name', 'brand', 'category', 'unitSize', 'ean', 'productGroupId'],
    // A product is picked out of four thousand by its name and its brand, and
    // two tins of the same tomatoes differ by size. The identifiers are what a
    // form is for: nobody scans a phone screen for a barcode, and a raw group
    // id says nothing without a request per row to resolve it.
    compact: ['name', 'brand', 'unitSize'],
  },

  filters: [
    { kind: 'search', param: 'query', label: 'catalog.items.search' },
    {
      kind: 'enum',
      param: 'category',
      label: 'catalog.items.category',
      options: ITEM_CATEGORIES,
    },
    {
      kind: 'reference',
      param: 'productGroupId',
      label: 'catalog.items.productGroupId',
      resource: 'product-groups',
    },
    {
      kind: 'boolean',
      param: 'withoutProductGroup',
      label: 'catalog.items.withoutProductGroup',
    },
  ],

  // `relevance` is the route's own default when a query is given, so it is not
  // offered: choosing it would ask for what is already happening, and choosing
  // it with no query means nothing to be relevant to.
  sorts: CATALOG_SORTS,

  actions: { create: true, edit: true, delete: true },

  gateway: () =>
    inject(RESOURCE_GATEWAYS).for<Item>({ path: ITEMS_PATH, seed: ITEM_SEED }),
});
