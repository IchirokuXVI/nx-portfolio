import { inject } from '@angular/core';
import { RESOURCE_GATEWAYS } from '@portfolio/luna-shopper-admin/data-access';
import {
  CONTENT_LOCALES,
  defineResource,
  localizedTextValue,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { UNIT_OF_MEASURE_OPTIONS } from './catalog-enums';
import { productGroupSource } from './catalog-sources';
import { GroupAddItemsPanel } from './product-group-add-items';

/** A set of comparable products, as the gateway describes it. */
export type ProductGroup = Wire.CatalogProductGroupView;

/**
 * Product groups: the statement that this milk is comparable with that milk.
 *
 * Group membership is **curation and never automatic**, so this screen and the
 * `productGroupId` field on a product are the only places one is ever made.
 * That is why the item list carries a "belonging to no group" filter: the
 * ungrouped products are invisible to every shopper read, and finding them is
 * the work this screen exists to serve.
 *
 * Deleting a group keeps its members and simply leaves them ungrouped, which
 * the gateway says in as many words. Undoing a curation decision must not be
 * blocked by the products it was about.
 *
 * `synonyms` is a list per language rather than a string, and it is on the form
 * rather than left out: a group's synonyms are what let a shopper's own word
 * reach its members, so a screen that could name a group but not say what else
 * it is called would leave the interesting half of the resource unreachable.
 * One entry per line.
 */
export const PRODUCT_GROUPS = defineResource<ProductGroup>({
  name: 'product-groups',
  // The Groups tab of the Products section (admin plan 0043).
  segment: 'groups',
  labels: {
    one: 'catalog.productGroups.one',
    many: 'catalog.productGroups.many',
  },

  title: (row, locales) => localizedTextValue(row.name, locales),

  fields: [
    {
      kind: 'text',
      name: 'id',
      label: 'catalog.productGroups.id',
      editable: false,
    },
    {
      kind: 'localized-text',
      name: 'name',
      label: 'catalog.productGroups.name',
      locales: CONTENT_LOCALES,
      required: true,
      maxLength: 200,
    },
    {
      kind: 'text',
      name: 'slug',
      label: 'catalog.productGroups.slug',
      help: 'catalog.productGroups.slugHelp',
      format: 'code',
      required: true,
      maxLength: 80,
    },
    {
      kind: 'enum',
      name: 'referenceUnit',
      label: 'catalog.productGroups.referenceUnit',
      help: 'catalog.productGroups.referenceUnitHelp',
      options: UNIT_OF_MEASURE_OPTIONS,
      required: true,
    },
    {
      kind: 'localized-text',
      name: 'synonyms',
      label: 'catalog.productGroups.synonyms',
      help: 'catalog.productGroups.synonymsHelp',
      locales: CONTENT_LOCALES,
      list: true,
    },
  ],

  list: {
    columns: ['name', 'slug', 'referenceUnit'],
    // Three columns already, and the slug is the one an operator quotes to
    // anything outside this screen.
    compact: ['slug', 'referenceUnit'],
  },

  sorts: [
    { value: 'name', label: 'catalog.productGroups.sort.name' },
    { value: 'created', label: 'catalog.productGroups.sort.created' },
    { value: 'updated', label: 'catalog.productGroups.sort.updated' },
  ],

  filters: [
    {
      kind: 'search',
      param: 'query',
      label: 'catalog.productGroups.filter.query',
    },
  ],

  actions: { create: true, edit: true, delete: true },

  // What the record page draws (admin plan 0055, section 2.3). A group has
  // four fields, so its collections are in the page and not behind tabs.
  record: {
    sections: [
      {
        title: 'catalog.productGroups.section.name',
        fields: ['name', 'slug', 'synonyms', 'referenceUnit'],
      },
    ],
    children: [
      // Find products, tick them and move them here through one reviewed
      // request, which no list of a resource does (admin plan 0035).
      {
        as: 'panel',
        name: 'add-items',
        label: 'catalog.productGroups.addItems.heading',
        component: GroupAddItemsPanel,
      },
      // The products list, narrowed to this group. No count: the view of a
      // group carries none.
      {
        as: 'link',
        resource: 'items',
        by: 'productGroupId',
        label: 'catalog.productGroups.products',
      },
    ],
  },

  gateway: () =>
    inject(RESOURCE_GATEWAYS).for<ProductGroup>(productGroupSource()),
});
