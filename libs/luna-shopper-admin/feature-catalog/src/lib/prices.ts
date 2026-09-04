import { inject } from '@angular/core';
import { RESOURCE_GATEWAYS } from '@portfolio/luna-shopper-admin/data-access';
import {
  compositeIdOf,
  defineResource,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { PRICE_SOURCE_KIND_OPTIONS } from './catalog-enums';
import { PRICE_KEY, priceSource } from './catalog-sources';
import { PriceFormPage } from './price-form-page';

/** One product's price in one scope, as the gateway describes it. */
export type Price = Wire.CatalogSupermarketItemView;

/** The named action that lets an automated run write a pinned row again. */
export const REVERT_TO_HARVESTED = 'revert-to-harvested';

/**
 * Prices, and the one catalog resource that is **not** a plain descriptor
 * (plan 0005, section 4).
 *
 * The reason is one sentence: **a manually typed price is permanent and
 * invisible.** An automated fetch never writes over a price whose
 * `priceSourceKind` is `ADMIN` (backend plan 0038, section 6.5), and the
 * confirmation queue that was meant to surface the resulting disagreement does
 * not exist and is deliberately deferred. So typing a price pins it against the
 * harvester forever, with nothing anywhere saying that it happened.
 *
 * Three things follow, and all three are cheap because the columns already
 * exist:
 *
 * - **`priceSourceKind` is a column and a filter.** Listing the `ADMIN` ones is
 *   the question "what have I overridden", which nothing else can ask.
 * - **`priceObservedAt` is a column**, so a stale price is recognisable as
 *   stale rather than merely as a number.
 * - **Reverting is an action.** It clears the typed price, and a row whose
 *   price is null is one an automated run may write again. Without it a typo is
 *   permanent and the only repair is SQL.
 *
 * ## What the editor adds
 *
 * `PriceFormPage` replaces the generic form, and section 2 is why: a price
 * belongs to a **scope** and not to a shop, so the screen has to name the
 * scope, say what kind it is, and say how many shops share it. An interface
 * that hid that would not be simpler, it would be wrong: an operator correcting
 * a price they saw in one shop would silently change it for eleven others
 * without being told.
 *
 * ## `unitPrice` is typed in and never derived
 *
 * The obvious derivation, `price / unitSize`, disagrees with the source on 110
 * of 4,232 products, in the field whose only purpose is comparison. So the form
 * derives nothing, which is a rule the generic form already keeps, and
 * `unitPriceLabel` is a **text** field rather than a picker because it is free
 * text: `100 ml` on a product priced per litre, and `lv` for washing machine
 * loads.
 */
export const PRICES = defineResource<Price>({
  name: 'prices',
  segment: 'prices',
  labels: { one: 'catalog.prices.one', many: 'catalog.prices.many' },

  // The pair the row is keyed on. Its own uuid is what a delete quotes and
  // nothing else: no route reads a price by it.
  rowId: (row) => compositeIdOf(row, PRICE_KEY),

  /**
   * A price row carries the product's id and not its name, and no admin read
   * joins one on. Resolving a name per row would be a request per row, which a
   * list cannot afford, so the list shows ids and the editor, which is one row,
   * shows names.
   */
  title: (row) => row.itemId,

  editor: PriceFormPage,

  fields: [
    { kind: 'text', name: 'id', label: 'catalog.prices.id', editable: false },
    {
      kind: 'reference',
      name: 'itemId',
      label: 'catalog.prices.itemId',
      resource: 'items',
      required: true,
      // Half of what the row *is*. A `PUT` with a different pair writes a
      // second price rather than moving this one.
      editable: 'create',
    },
    {
      kind: 'reference',
      name: 'priceScopeId',
      label: 'catalog.prices.priceScopeId',
      help: 'catalog.prices.priceScopeIdHelp',
      // A scope, and never a shop. This is the field section 2 is about.
      resource: 'price-scopes',
      required: true,
      editable: 'create',
    },
    {
      kind: 'money',
      name: 'price',
      label: 'catalog.prices.price',
      help: 'catalog.prices.priceHelp',
      // `numeric(12,2)`, but `UpsertSupermarketItemDto` validates it with
      // `@IsNumber()`, so the digits stay text until the last moment.
      decimals: 2,
      wire: 'number',
      nullable: true,
    },
    {
      kind: 'text',
      name: 'currency',
      label: 'catalog.prices.currency',
      nullable: true,
      maxLength: 3,
    },
    {
      kind: 'money',
      name: 'unitPrice',
      label: 'catalog.prices.unitPrice',
      help: 'catalog.prices.unitPriceHelp',
      // `numeric(12,4)`: four decimals, and never recomputed from anything.
      decimals: 4,
      wire: 'number',
      nullable: true,
    },
    {
      kind: 'text',
      name: 'unitPriceLabel',
      label: 'catalog.prices.unitPriceLabel',
      help: 'catalog.prices.unitPriceLabelHelp',
      nullable: true,
      maxLength: 32,
    },
    {
      kind: 'boolean',
      name: 'available',
      label: 'catalog.prices.available',
      // Scope wide, and labelled so. The `available` on a location item is a
      // per shop override with a third answer, and the two are never drawn as
      // two checkboxes saying the same word.
      help: 'catalog.prices.availableHelp',
      // The column defaults to true, so an untouched box must not say no.
      initial: true,
    },
    {
      kind: 'enum',
      name: 'priceSourceKind',
      label: 'catalog.prices.priceSourceKind',
      help: 'catalog.prices.priceSourceKindHelp',
      options: PRICE_SOURCE_KIND_OPTIONS,
      // Catalog decides it, and a write through this app always means `ADMIN`.
      // `UpsertSupermarketItemDto` has no property for it, so a control here
      // would be one the server drops.
      editable: false,
    },
    {
      kind: 'date',
      name: 'priceObservedAt',
      label: 'catalog.prices.priceObservedAt',
      help: 'catalog.prices.priceObservedAtHelp',
      time: true,
      editable: false,
    },
  ],

  list: {
    columns: [
      'itemId',
      'price',
      'unitPrice',
      'priceSourceKind',
      'priceObservedAt',
      'available',
    ],
    // The three columns this screen exists for: what it costs, who said so, and
    // when. The product is the card's own heading already.
    compact: ['price', 'priceSourceKind', 'priceObservedAt'],
  },

  note: 'catalog.prices.note',

  filters: [
    {
      kind: 'reference',
      param: 'itemId',
      label: 'catalog.prices.filter.itemId',
      resource: 'items',
    },
    {
      kind: 'reference',
      param: 'priceScopeId',
      label: 'catalog.prices.filter.priceScopeId',
      resource: 'price-scopes',
    },
    {
      // "What have I typed in and pinned." The question this screen exists for.
      kind: 'enum',
      param: 'priceSourceKind',
      label: 'catalog.prices.filter.priceSourceKind',
      options: PRICE_SOURCE_KIND_OPTIONS,
    },
    {
      kind: 'boolean',
      param: 'available',
      label: 'catalog.prices.filter.available',
    },
  ],

  actions: {
    create: true,
    delete: true,

    named: () => {
      const gateways = inject(RESOURCE_GATEWAYS);
      const gateway = gateways.for<Price>(priceSource());

      return [
        {
          name: REVERT_TO_HARVESTED,
          label: 'catalog.prices.action.revert',
          confirm: {
            heading: 'catalog.prices.confirm.revert.heading',
            body: 'catalog.prices.confirm.revert.body',
            confirm: 'catalog.prices.confirm.revert.confirm',
          },

          // Only a row somebody pinned. Offering it on a harvested row would be
          // a button that clears a price nothing was protecting.
          available: (row) => row.priceSourceKind === 'ADMIN',

          /**
           * Clear the typed price, which is what makes the row writable again.
           *
           * Nothing in the gateway can set `priceSourceKind` back: the upsert
           * DTO has no such property, because a write from here is by
           * definition an operator's. What lifts the pin is the **price** going
           * null, since `decidePriceWrite` writes over any row with no price
           * whatever its source kind says.
           *
           * The three values a person typed go with it. A unit price left
           * beside a cleared price would be a number describing a price that is
           * no longer there.
           */
          run: async (row) => {
            await gateway.update(compositeIdOf(row, PRICE_KEY), {
              price: null,
              currency: null,
              unitPrice: null,
              unitPriceLabel: null,
            });
          },
        },
      ];
    },
  },

  gateway: () => inject(RESOURCE_GATEWAYS).for<Price>(priceSource()),
});
