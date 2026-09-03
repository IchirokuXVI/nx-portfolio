import { inject } from '@angular/core';
import { RESOURCE_GATEWAYS } from '@portfolio/luna-shopper-admin/data-access';
import {
  CONTENT_LOCALES,
  defineResource,
  localizedTextValue,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { CATALOG_SORTS, UNITS_OF_MEASURE } from './catalog-enums';
import { PRODUCT_GROUPS_PATH } from './catalog-paths';
import { PRODUCT_GROUP_SEED } from './product-groups-seed';

/** A product group, as the gateway describes it. */
export type ProductGroup = Wire.CatalogProductGroupView;

/**
 * What makes two products comparable (plan 0005, section 1).
 *
 * A group is the statement that this litre of milk and that one answer the same
 * shopping line, which is what lets velista show the cheapest of them rather
 * than the cheapest of whatever happened to match a word. It is owner curation
 * and never assigned automatically, so this screen is where every group there
 * has ever been came from.
 *
 * Two fields are worth reading rather than skimming.
 *
 * **`referenceUnit` is what the group is compared in**, and it is not the same
 * as any member's `defaultUnit`. A group compared in litres can hold a product
 * sold by the pack, and it is the group's unit that decides which of two prices
 * is lower.
 *
 * **`synonyms` is a list per language, edited as a line of words.** It is what
 * makes a search for "semi skimmed" reach a group called "milk". The column
 * holds arrays; the form holds the words separated by commas, because a list
 * editor per language is a great deal of screen for a handful of words.
 */
export const PRODUCT_GROUPS = defineResource<ProductGroup>({
  name: 'product-groups',
  segment: 'product-groups',
  labels: {
    one: 'catalog.productGroups.one',
    many: 'catalog.productGroups.many',
  },

  title: (row) => localizedTextValue(row.name, CONTENT_LOCALES),

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
      // The gateway's own limit: `LocalizedTextDto` caps each entry at 200.
      maxLength: 200,
    },
    {
      kind: 'text',
      name: 'slug',
      label: 'catalog.productGroups.slug',
      help: 'catalog.productGroups.slugHelp',
      required: true,
      maxLength: 80,
    },
    {
      kind: 'enum',
      name: 'referenceUnit',
      label: 'catalog.productGroups.referenceUnit',
      help: 'catalog.productGroups.referenceUnitHelp',
      options: UNITS_OF_MEASURE,
      required: true,
    },
    {
      kind: 'localized-text',
      name: 'synonyms',
      label: 'catalog.productGroups.synonyms',
      help: 'catalog.productGroups.synonymsHelp',
      locales: CONTENT_LOCALES,
      entries: 'list',
    },
  ],

  list: {
    columns: ['name', 'slug', 'referenceUnit'],
    // A group is recognised by its name, and by the unit when two names are
    // close: "milk" compared per litre is a different group from "milk" compared
    // per pack, and the slug is the handle for tooling rather than for reading.
    compact: ['name', 'referenceUnit'],
  },

  filters: [
    { kind: 'search', param: 'query', label: 'catalog.productGroups.search' },
  ],

  sorts: CATALOG_SORTS,

  actions: { create: true, edit: true, delete: true },

  gateway: () =>
    inject(RESOURCE_GATEWAYS).for<ProductGroup>({
      path: PRODUCT_GROUPS_PATH,
      seed: PRODUCT_GROUP_SEED,
    }),
});
