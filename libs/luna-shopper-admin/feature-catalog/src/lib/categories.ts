import { inject } from '@angular/core';
import { RESOURCE_GATEWAYS } from '@portfolio/luna-shopper-admin/data-access';
import {
  CONTENT_LOCALES,
  defineResource,
  localizedTextValue,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { CATEGORY_KIND_OPTIONS } from './catalog-enums';
import { categorySource } from './catalog-sources';

/** A category, as the gateway describes it. */
export type Category = Wire.CatalogCategoryView;

/**
 * The category tree (backend plan 0166, admin plan 0036).
 *
 * **Two levels, and a product only ever on the second.** A root is a row with
 * no parent, and the categories inside it are the only places a product can
 * go. Both rules are the server's, and this screen says them rather than
 * enforcing them: the parent picker offers only roots, so a third level is not
 * one of its answers, and a refusal that still happens is drawn under the
 * parent it is about.
 *
 * **A flat list, filtered by parent.** "Parent: none" is the roots, and a root
 * picked there is its children, which is the same question the tree would
 * answer by expanding a row. The parent column says where each row sits when
 * nothing is filtered.
 *
 * **The slug is written once.** It is the category's identity for every tool
 * outside this app: a decisions file names categories by slug, and the seed
 * derives ids from them. So the form takes it on create and shows it after.
 *
 * A category that still holds products cannot be deleted, and the refusal links
 * to those products: moving them is what makes the delete possible. Nothing in
 * this app deletes one that holds something.
 */
export const CATEGORIES = defineResource<Category>({
  name: 'categories',
  segment: 'categories',
  labels: { one: 'catalog.categories.one', many: 'catalog.categories.many' },

  title: (row, locales) => localizedTextValue(row.name, locales),

  // `kind` is a filter of the list and no column of a row: a root is a row
  // with no parent, and a leaf is a row with one. A read by ID sends no
  // filter, so a picker of leaves asks here whether the row it was handed is
  // one (admin plan 0051). Any other kind narrows nothing.
  within: (row, scope) => {
    const root = (row.parentId ?? null) === null;
    switch (scope['kind']) {
      case 'root':
        return root;
      case 'leaf':
        return !root;
      default:
        return true;
    }
  },

  fields: [
    {
      kind: 'text',
      name: 'id',
      label: 'catalog.categories.id',
      editable: false,
    },
    {
      kind: 'localized-text',
      name: 'name',
      label: 'catalog.categories.name',
      locales: CONTENT_LOCALES,
      required: true,
      maxLength: 200,
    },
    {
      kind: 'text',
      name: 'slug',
      label: 'catalog.categories.slug',
      help: 'catalog.categories.slugHelp',
      required: true,
      maxLength: 80,
      editable: 'create',
    },
    {
      kind: 'reference',
      name: 'parentId',
      label: 'catalog.categories.parentId',
      help: 'catalog.categories.parentIdHelp',
      resource: 'categories',
      // A few dozen rows, and a page of them repeats the same handful of
      // roots, so one cached resolve per root names the column.
      nameLookup: true,
      nullable: true,
      // Only roots can hold categories, so only roots are offered.
      scopeFrom: () => ({ kind: 'root' }),
    },
    {
      kind: 'number',
      name: 'position',
      label: 'catalog.categories.position',
      help: 'catalog.categories.positionHelp',
      integer: true,
      min: 0,
    },
    {
      kind: 'number',
      name: 'itemCount',
      label: 'catalog.categories.itemCount',
      editable: false,
    },
  ],

  list: {
    columns: ['name', 'slug', 'parentId', 'position', 'itemCount'],
    compact: ['parentId', 'itemCount'],
  },

  filters: [
    {
      kind: 'search',
      param: 'query',
      label: 'catalog.categories.filter.query',
    },
    {
      kind: 'reference',
      param: 'parentId',
      label: 'catalog.categories.filter.parentId',
      resource: 'categories',
      // "None" is the roots, which the gateway reads as `withoutParent`.
      nullable: true,
    },
    {
      kind: 'enum',
      param: 'kind',
      label: 'catalog.categories.filter.kind',
      options: CATEGORY_KIND_OPTIONS,
    },
  ],

  // Refusals about the parent picked are said under the parent.
  errorFields: {
    category_too_deep: 'parentId',
    category_not_a_leaf: 'parentId',
  },

  // A category that still holds products opens them, which is where the
  // operator has to go before the delete can succeed. The refusal names no
  // row, because the category is the one that was asked about.
  errorLinks: {
    category_in_use: {
      resource: 'items',
      filter: 'categoryId',
      label: 'catalog.categories.inUseOpen',
    },
  },

  actions: { create: true, edit: true, delete: true },

  gateway: () => inject(RESOURCE_GATEWAYS).for<Category>(categorySource()),
});
