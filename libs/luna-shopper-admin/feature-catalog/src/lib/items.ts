import { inject } from '@angular/core';
import { RESOURCE_GATEWAYS } from '@portfolio/luna-shopper-admin/data-access';
import {
  CONTENT_LOCALES,
  defineResource,
  localizedTextValue,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import {
  ITEM_CATEGORY_OPTIONS,
  UNIT_OF_MEASURE_OPTIONS,
} from './catalog-enums';
import { itemSource } from './catalog-sources';

/** A product, as the gateway describes it. */
export type Item = Wire.CatalogItemView;

/**
 * The products.
 *
 * **Every price field on these rows comes back null, and that is the honest
 * answer rather than a gap** (backend plan 0073, section 4). The admin read
 * names no price scopes, because an operator has no postal code and no shopping
 * profile, so there is no set of scopes that is theirs and inventing one would
 * price the catalog from somewhere arbitrary. What a product costs is the price
 * screen, which lists prices as prices and says which scope each belongs to.
 *
 * **"None" on the group filter is the filter with no user facing counterpart**
 * (plan 0012, section 2). An ungrouped product is invisible to every "show me
 * milk" read, so this is how the ones curation has not reached are found, and
 * it is the reason an operator opens this screen rather than the shopper's
 * search. It used to be a boolean filter of its own, `withoutProductGroup`,
 * beside the group picker; it is now a choice inside the picker, sent as the
 * literal `none` on `productGroupId`, which the gateway turns back into the
 * flag catalog knows.
 *
 * `productGroupId` being null is the **resting state** of a freshly harvested
 * product rather than a missing value, so the field is nullable and nothing
 * nags about it.
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
      maxLength: 120,
    },
    {
      kind: 'text',
      name: 'ean',
      label: 'catalog.items.ean',
      help: 'catalog.items.eanHelp',
      nullable: true,
      maxLength: 32,
    },
    {
      kind: 'text',
      name: 'sku',
      label: 'catalog.items.sku',
      nullable: true,
      maxLength: 120,
    },
    {
      kind: 'enum',
      name: 'category',
      label: 'catalog.items.category',
      options: ITEM_CATEGORY_OPTIONS,
      required: true,
    },
    {
      kind: 'enum',
      name: 'defaultUnit',
      label: 'catalog.items.defaultUnit',
      options: UNIT_OF_MEASURE_OPTIONS,
      required: true,
    },
    {
      kind: 'number',
      name: 'unitSize',
      label: 'catalog.items.unitSize',
      // Without it the unit says nothing: "LITER" is not a size.
      help: 'catalog.items.unitSizeHelp',
      nullable: true,
      min: 0,
    },
    {
      kind: 'reference',
      name: 'productGroupId',
      label: 'catalog.items.productGroupId',
      help: 'catalog.items.productGroupIdHelp',
      resource: 'product-groups',
      nullable: true,
    },
    {
      kind: 'text',
      name: 'imageUrl',
      label: 'catalog.items.imageUrl',
      format: 'url',
      nullable: true,
      maxLength: 500,
    },
  ],

  list: {
    columns: ['name', 'brand', 'category', 'unitSize', 'ean', 'productGroupId'],
    // A product is recognised by its name, its brand and its size, which is what
    // separates the 1 litre from the 1.5. The barcode is what you search for
    // rather than what you scan a screen for, and a group id is a uuid.
    compact: ['brand', 'unitSize'],
  },

  sorts: [
    { value: 'relevance', label: 'catalog.items.sort.relevance' },
    { value: 'name', label: 'catalog.items.sort.name' },
    { value: 'created', label: 'catalog.items.sort.created' },
    { value: 'updated', label: 'catalog.items.sort.updated' },
  ],

  filters: [
    { kind: 'search', param: 'query', label: 'catalog.items.filter.query' },
    {
      kind: 'enum',
      param: 'category',
      label: 'catalog.items.filter.category',
      options: ITEM_CATEGORY_OPTIONS,
    },
    {
      kind: 'reference',
      param: 'productGroupId',
      label: 'catalog.items.filter.productGroupId',
      resource: 'product-groups',
      // The column is null on every freshly harvested product, so "none" is
      // the question this screen is most often opened to ask.
      nullable: true,
    },
  ],

  actions: { create: true, edit: true, delete: true },

  gateway: () => inject(RESOURCE_GATEWAYS).for<Item>(itemSource()),
});
