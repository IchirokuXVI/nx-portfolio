import { inject } from '@angular/core';
import { RESOURCE_GATEWAYS } from '@portfolio/luna-shopper-admin/data-access';
import {
  CONTENT_LOCALES,
  defineResource,
  localizedTextValue,
  type ResourceGateway,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { UNIT_OF_MEASURE_OPTIONS } from './catalog-enums';
import { itemSource, priceSource } from './catalog-sources';
import { ProductCounts } from './products/product-context';
import {
  productListGateway,
  type ScopePriced,
} from './products/product-list-gateway';
import { ProductPricesTab } from './products/product-prices-tab';
import { ProductSourcesTab, ProductWhereTab } from './products/product-tabs';
import { SetCategoriesPanel } from './set-categories-panel';
import { SetGroupPanel } from './set-group-panel';

/**
 * The Prices tab of a product: its prices by chain and scope. The name of the
 * part, the key of its count, and the segment the `prices` resource is at.
 */
export const PRODUCT_PRICES_TAB = 'prices';

/** The "Where it is" tab: the product in each chain's shops. */
export const PRODUCT_WHERE_TAB = 'where';

/** The Sources tab: the chain rows that name the product. */
export const PRODUCT_SOURCES_TAB = 'sources';

/**
 * A product, as the gateway describes it, plus the ids of its categories.
 *
 * The row carries its categories as objects, names included, because every
 * reader of a product needs the names (backend plan 0166, section 3). The
 * writes take ids, as `categoryIds`, in the order meant. So the ids are read
 * off the objects as each row arrives, and the form edits the property the
 * wire writes (admin plan 0036).
 */
export type Item = Wire.CatalogItemView & {
  readonly categoryIds: readonly string[];
} & ScopePriced;

/** A product row with the ids its categories carry, in their order. */
export function withCategoryIds(row: Wire.CatalogItemView): Item {
  return {
    ...row,
    categoryIds: (row.categories ?? []).map((category) => category.id),
  };
}

/**
 * The item gateway, with {@link Item.categoryIds} on every row it answers.
 *
 * Nothing it sends changes: a form sends `categoryIds` only when the operator
 * changed them, which is what the update route takes.
 */
export function itemGateway(
  inner: ResourceGateway<Wire.CatalogItemView>
): ResourceGateway<Item> {
  return {
    list: async (query) => {
      const page = await inner.list(query);
      return { ...page, items: page.items.map(withCategoryIds) };
    },
    read: async (id) => withCategoryIds(await inner.read(id)),
    create: async (input) => withCategoryIds(await inner.create(input)),
    update: async (id, input) => withCategoryIds(await inner.update(id, input)),
    remove: (id) => inner.remove(id),
  };
}

/**
 * The products.
 *
 * **Every price field on these rows comes back null, and that is the honest
 * answer rather than a gap** (backend plan 0073, section 4). The admin read
 * names no price scopes, because an operator has no postal code and no shopping
 * profile, so there is no set of scopes that is theirs and inventing one would
 * price the catalog from somewhere arbitrary. What a product costs is asked
 * at one scope the operator names: the list's "Prices at" picker reads the
 * shown price of every row of a page at that scope, in one request, and lays
 * it on the row as `scopePrice` (admin plan 0043).
 *
 * **The products sit at their section's own address**, `/products`, so the
 * segment is empty. Their groups, their categories and the price rules are
 * the other tabs of that section, each one segment under it.
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
  // At the section's own address: see above.
  segment: '',
  labels: {
    one: 'catalog.items.one',
    many: 'catalog.items.many',
    create: 'catalog.items.add',
  },

  title: (row, locales) => localizedTextValue(row.name, locales),

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
      // Text, and not a picker over the registered brands: the gateway reads
      // and writes the brand of a product as text, and works out the
      // registered brand by itself (admin plan 0055, section 3).
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
      format: 'code',
      nullable: true,
      maxLength: 32,
    },
    {
      kind: 'text',
      name: 'sku',
      label: 'catalog.items.sku',
      format: 'code',
      nullable: true,
      maxLength: 120,
    },
    {
      kind: 'references',
      name: 'categoryIds',
      label: 'catalog.items.categoryIds',
      help: 'catalog.items.categoryIdsHelp',
      resource: 'categories',
      // The tree is a few dozen rows and a page of products repeats a handful
      // of them, so one cached resolve per category names the column.
      nameLookup: true,
      required: true,
      // The first is the one a row shows when it has room for one, so putting
      // another first is a change worth sending.
      ordered: true,
      // A product only goes on a category inside another.
      scopeFrom: () => ({ kind: 'leaf' }),
    },
    {
      kind: 'enum',
      name: 'defaultUnit',
      label: 'catalog.items.defaultUnit',
      options: UNIT_OF_MEASURE_OPTIONS,
      required: true,
      // What most of the catalog is sold by, so a new product starts there.
      initial: 'UNIT',
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
      // Groups number dozens, and a page of products repeats the same few ids,
      // so one cached resolve per distinct id names the column (admin plan
      // 0023, section 4). A null group keeps its "None" cell untouched.
      nameLookup: true,
      nullable: true,
    },
    {
      kind: 'text',
      name: 'imageUrl',
      label: 'catalog.items.imageUrl',
      // Its address, with the picture beside it.
      format: 'image',
      nullable: true,
      maxLength: 500,
    },
  ],

  list: {
    columns: [
      'name',
      'brand',
      'categoryIds',
      'unitSize',
      'ean',
      'productGroupId',
    ],
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
      // Any category: a root narrows to every product under its children,
      // which is how the route reads it (backend plan 0166, section 4).
      kind: 'reference',
      param: 'categoryId',
      label: 'catalog.items.filter.categoryId',
      resource: 'categories',
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

  actions: {
    create: true,
    edit: true,
    delete: true,
    // Many products into one group, through a review (admin plan 0035).
    bulk: [
      {
        name: 'setGroup',
        label: 'catalog.items.setGroup.action',
        panel: SetGroupPanel,
      },
      // Many products onto other categories, through a review (admin plan
      // 0036). It replaces each product's set: moving products off
      // `other-frozen` means taking them off it.
      {
        name: 'setCategories',
        label: 'catalog.items.setCategories.action',
        panel: SetCategoriesPanel,
      },
    ],
  },

  // What the record page draws (admin plan 0055, section 2.1). Details is
  // the first tab, and the three that follow are parts of the product's own
  // library. The page of a new product has no tabs.
  record: {
    sections: [
      {
        title: 'catalog.items.section.name',
        fields: ['name', 'brand', 'ean', 'sku'],
      },
      {
        title: 'catalog.items.section.where',
        fields: ['categoryIds', 'productGroupId'],
      },
      {
        title: 'catalog.items.section.sold',
        fields: ['defaultUnit', 'unitSize', 'imageUrl'],
      },
    ],
    children: [
      {
        as: 'tab',
        name: PRODUCT_PRICES_TAB,
        label: 'catalog.products.tabs.prices',
        component: ProductPricesTab,
      },
      {
        as: 'tab',
        name: PRODUCT_WHERE_TAB,
        label: 'catalog.products.tabs.where',
        component: ProductWhereTab,
      },
      {
        as: 'tab',
        name: PRODUCT_SOURCES_TAB,
        label: 'catalog.products.tabs.sources',
        component: ProductSourcesTab,
      },
    ],
    // No field of a product holds either count: the scopes that price it and
    // the chain rows that name it are each another read.
    counts: () => inject(ProductCounts).of,
    // Catalog deletes the prices of a product with it (`item_prices` cascades
    // on the item), so the question says so.
    deleteBody: 'catalog.products.deleteBody',
  },

  // What the server refuses about a product's categories is said under them.
  errorFields: {
    category_not_a_leaf: 'categoryIds',
    item_needs_a_category: 'categoryIds',
    category_not_found: 'categoryIds',
  },

  gateway: () => {
    const gateways = inject(RESOURCE_GATEWAYS);
    // The products, able to show the price at one scope when the list asks.
    return productListGateway(
      itemGateway(gateways.for<Wire.CatalogItemView>(itemSource())),
      gateways.for(priceSource())
    );
  },
});
