import { inject } from '@angular/core';
import { RESOURCE_GATEWAYS } from '@portfolio/luna-shopper-admin/data-access';
import {
  CONTENT_LOCALES,
  defineResource,
  fieldMessage,
  localizedTextValue,
  type FieldNote,
  type NumberUnit,
  type ResourceGateway,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { UNIT_OF_MEASURE_OPTIONS } from './catalog-enums';
import { itemSource, priceSource } from './catalog-sources';
import { ProductCounts } from './products/product-context';
import { formatGrams, formatMillilitres } from './products/product-format';
import {
  productListGateway,
  type ScopePriced,
} from './products/product-list-gateway';
import { ProductPricesTab } from './products/product-prices-tab';
import { ProductSourcesTab } from './products/product-tabs';
import { SetCategoriesPanel } from './set-categories-panel';
import { SetGroupPanel } from './set-group-panel';

/**
 * The Prices tab of a product: its prices by chain and scope. The name of the
 * part, the key of its count, and the segment the `prices` resource is at.
 */
export const PRODUCT_PRICES_TAB = 'prices';

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
  /**
   * No column: the "Shoppers see" fact, read off `images`. A field has to be
   * named by a property, and `images` is a wire key whose value is an array,
   * which an address prefill or a server field error would land on.
   */
  readonly shownPhoto?: string | null;
} & ScopePriced;

/** A product row with the ids its categories carry, in their order. */
export function withCategoryIds(row: Wire.CatalogItemView): Item {
  return {
    ...row,
    categoryIds: (row.categories ?? []).map((category) => category.id),
  };
}

/**
 * A product row as the back office holds it: the ids of its categories, and
 * our own photo in `imageUrl` (admin plan 0065, section 2).
 *
 * The view answers two photos. `imageUrl` is the one a shopper sees, which is
 * a chain's photo when we have none and that chain's photos are on.
 * `ownImageUrl` is ours, the column the update route writes as `imageUrl`. A
 * form filled from the shown photo saves a chain's address as ours on the
 * first save, so the field reads ours. What a shopper sees stays on the row
 * in `images`, whose first entry is that photo, with its `source` and its
 * chain: a reader that wants the shown photo reads it there.
 */
export function toItemRow(view: Wire.CatalogItemView): Item {
  return { ...withCategoryIds(view), imageUrl: view.ownImageUrl ?? null };
}

/**
 * The item gateway, with every row it answers as {@link toItemRow} reads it.
 *
 * Nothing it sends changes: a form sends `categoryIds` and `imageUrl` only
 * when the operator changed them, which is what the update route takes.
 */
export function itemGateway(
  inner: ResourceGateway<Wire.CatalogItemView>
): ResourceGateway<Item> {
  return {
    list: async (query) => {
      const page = await inner.list(query);
      return { ...page, items: page.items.map(toItemRow) };
    },
    read: async (id) => toItemRow(await inner.read(id)),
    create: async (input) => toItemRow(await inner.create(input)),
    update: async (id, input) => toItemRow(await inner.update(id, input)),
    remove: (id) => inner.remove(id),
  };
}

/**
 * Who holds the weight of a product, as the line under it (admin plan 0068).
 *
 * A weight from the chain is rewritten by each run. One a person typed is
 * never touched by a run, and the press empties it: an emptied nullable field
 * submits `approxWeight: null`, which hands the weight back to the chain.
 *
 * Read from the weight the form holds, beside the row as it was read. No
 * held weight, no line: a form that holds the weight empty has nothing left
 * to hand back, and the save says who holds the next one. A held weight other
 * than the row's was typed by a person, and the save marks it so, whoever
 * set the one under it. That line has no press: the field holds a typed
 * weight, and emptying it is one keystroke away.
 */
function approxWeightNote(
  held: Partial<Item>,
  row: Item | null
): FieldNote | null {
  const typed = String(held.approxWeight ?? '').trim();
  if (typed === '') {
    return null;
  }
  const admin = fieldMessage('catalog.items.approxWeightFrom.admin');
  // The draft holds a string and the row a number, so they meet as numbers.
  if (row === null || Number(typed) !== Number(row.approxWeight ?? NaN)) {
    return { text: admin };
  }
  if (row.approxWeightSetBy === 'SOURCE') {
    return { text: fieldMessage('catalog.items.approxWeightFrom.source') };
  }
  if (row.approxWeightSetBy !== 'ADMIN') {
    return null;
  }
  return {
    text: admin,
    action: { label: 'catalog.items.approxWeightFrom.useChain', value: '' },
  };
}

/** A step as the wire carries it: one of the values the gateway takes. */
type WireStep = NonNullable<Wire.CatalogItemView['quantityStep']>;

/**
 * The steps a curator may give a product sold by the kilo or the litre, in
 * grams or millilitres (backend plan 0261 S2, admin plan 0070). Typed against
 * the generated union, and `catalog-descriptors.spec.ts` asserts that every
 * member of it is here, so a step the gateway adds fails a spec and not a
 * curator's save.
 */
export const QUANTITY_STEP_CHOICES = [
  1, 5, 10, 25, 50, 100, 200, 250, 500, 1000,
] as const satisfies readonly WireStep[];

/** Whether a value the form or the row holds is empty. */
function blank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === '';
}

/**
 * What a step of this product is counted in: grams for a product sold by the
 * kilo, millilitres for one sold by the litre, and `null` for a product that
 * carries no step (backend plan 0261 S3, admin plan 0070 section 2.1).
 *
 * Only a product with no size and no weight is sold by the kilo or the litre:
 * a weight makes it a piece, and a size a pack. The rule is the server's
 * `carriesQuantityStep`, kept here as `0068` kept its own, and read over the
 * row as the form holds it. `shown`, the unit, the options and the default
 * line all read this one rule.
 */
export function measuredUnitOf(held: Partial<Item>): 'g' | 'ml' | null {
  if (!blank(held.unitSize) || !blank(held.approxWeight)) {
    return null;
  }
  if (held.defaultUnit === 'KILOGRAM') {
    return 'g';
  }
  return held.defaultUnit === 'LITER' ? 'ml' : null;
}

/** A step in grams: "250 g", "1 kg". */
const GRAM_STEP: NumberUnit = { word: 'g', format: formatGrams };

/** A step in millilitres: "50 ml", "1 L". */
const MILLILITRE_STEP: NumberUnit = { word: 'ml', format: formatMillilitres };

/** The photo a shopper sees, or `null`: the first entry of `images`. */
function shownImage(row: Item): Wire.CatalogItemImageView | null {
  return Array.isArray(row.images) ? (row.images[0] ?? null) : null;
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
      // What a price means follows the unit, and only the kilo needs saying:
      // a price of a piece sold by the kilo reads like the price of the piece.
      note: (held) =>
        held.defaultUnit === 'KILOGRAM'
          ? { text: fieldMessage('catalog.items.pricesPerKilo') }
          : null,
    },
    {
      kind: 'number',
      name: 'unitSize',
      label: 'catalog.items.unitSize',
      // Without it the unit says nothing: "LITER" is not a size.
      help: 'catalog.items.unitSizeHelp',
      nullable: true,
      min: 0,
      // A product sold by the kilo has no size (backend plan 0237, section
      // 3.3), so the field is not offered and the weight takes its place.
      shown: (row) => row.defaultUnit !== 'KILOGRAM',
      // A size or a weight, never both (backend plan 0244, section 1).
      excludes: 'approxWeight',
    },
    {
      // The grams of one piece, for a product with no size: a cheese sold by
      // the kilo, or a melon priced as one (backend plan 0244).
      kind: 'number',
      name: 'approxWeight',
      label: 'catalog.items.approxWeight',
      nullable: true,
      integer: true,
      // The server refuses a weight of zero or less.
      min: 1,
      excludes: 'unitSize',
      note: approxWeightNote,
    },
    {
      // How far one press moves a shopper's amount of a product sold by the
      // kilo or the litre (backend plan 0261, admin plan 0070). Empty is the
      // default step.
      kind: 'number',
      name: 'quantityStep',
      label: 'catalog.items.quantityStep',
      help: 'catalog.items.quantityStepHelp',
      nullable: true,
      integer: true,
      // Only a product sold by the kilo or the litre carries one. Hidden, it
      // holds its empty value, so the edit that makes the product a pack or a
      // piece sends `quantityStep: null` beside it, which the server asks of
      // that edit.
      shown: (held) => measuredUnitOf(held) !== null,
      // The ten steps of the server, as a select, in the unit the shopper
      // reads. Its empty option is the default and saves `null`.
      choices: () => QUANTITY_STEP_CHOICES,
      unit: (held) => {
        const unit = measuredUnitOf(held);
        if (unit === null) {
          return null;
        }
        return unit === 'g' ? GRAM_STEP : MILLILITRE_STEP;
      },
      emptyText: (held) => {
        const unit = measuredUnitOf(held);
        if (unit === null) {
          return null;
        }
        return fieldMessage(
          unit === 'g'
            ? 'catalog.items.quantityStepDefault.gram'
            : 'catalog.items.quantityStepDefault.milliliter'
        );
      },
      // A set step is a person's, and a run does not weigh a product that
      // has one (backend plan 0261 S6). No source to name: only a person
      // sets a step (S7).
      note: (held) =>
        blank(held.quantityStep)
          ? null
          : { text: fieldMessage('catalog.items.quantityStepSet') },
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
      // Our photo, and the only one the back office writes. The row holds
      // `ownImageUrl` here (see `toItemRow`), and a save sends it under the
      // name the update route reads.
      kind: 'text',
      name: 'imageUrl',
      label: 'catalog.items.imageUrl',
      help: 'catalog.items.imageUrlHelp',
      // Its address, with the picture beside it.
      format: 'image',
      nullable: true,
      maxLength: 500,
    },
    {
      // What a shopper sees, and where it comes from. Never editable, so no
      // draft holds it and no save sends it.
      kind: 'text',
      name: 'shownPhoto',
      label: 'catalog.items.shown',
      editable: false,
      setBy: 'catalog.items.shownSetBy',
      format: 'image',
      read: (row) => shownImage(row)?.url ?? null,
      caption: (row) => {
        const shown = shownImage(row);
        if (shown === null) {
          return { kind: 'word', key: 'catalog.items.shownFrom.none' };
        }
        if (shown.source === 'OWNER') {
          return { kind: 'word', key: 'catalog.items.shownFrom.owner' };
        }
        return shown.supermarketId === null
          ? { kind: 'word', key: 'catalog.items.shownFrom.chain' }
          : {
              kind: 'reference',
              resource: 'supermarkets',
              id: shown.supermarketId,
            };
      },
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
        fields: [
          'defaultUnit',
          'unitSize',
          'approxWeight',
          'quantityStep',
          'imageUrl',
          'shownPhoto',
        ],
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

  // What the server refuses about a product's categories is said under them,
  // and a refusal about its size, weight or step under the field it names.
  errorFields: {
    category_not_a_leaf: 'categoryIds',
    item_needs_a_category: 'categoryIds',
    category_not_found: 'categoryIds',
    item_kilogram_has_size: 'unitSize',
    item_approx_weight_beside_size: 'approxWeight',
    item_quantity_step_not_allowed: 'quantityStep',
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
