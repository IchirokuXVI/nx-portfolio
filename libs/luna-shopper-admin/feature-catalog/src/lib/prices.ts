import { inject } from '@angular/core';
import { RESOURCE_GATEWAYS } from '@portfolio/luna-shopper-admin/data-access';
import {
  compositeIdOf,
  defineResource,
  type ResourceGateway,
  type ResourceInput,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { PRICE_SOURCE_KIND_OPTIONS } from './catalog-enums';
import { itemPriceSource, PRICE_KEY, priceSource } from './catalog-sources';
import { PriceDetailPage } from './price-detail-page';
import { PriceFormPage } from './price-form-page';

/**
 * One product's effective price in one scope, as the gateway describes it,
 * plus the one field the **add a price** form types that the effective row
 * does not carry: the start of a window, which is the owner's field for a
 * price known to be temporary.
 */
export type Price = Wire.CatalogSupermarketItemView & {
  readonly validFrom?: string | null;
};

/**
 * Effective prices: the listing, and the door to a price's history (backend
 * plan 0080, section 10).
 *
 * Since plan 0080 a price is **the price chosen among several**. Every price a
 * source gave is a row of its own, and this screen lists the one the policy
 * picked for each (product, scope) with the terms it was picked on: where it
 * came from, when it was last seen, whether it is shown on sufferance
 * (`stale`), and until when it holds. Nothing here edits that row, because it
 * is derived; a row opens the second screen, which shows the rows behind it.
 *
 * Three things the old screen was shaped around are gone with the model:
 *
 * - **A typed price is no longer permanent and invisible.** It coexists with
 *   the automated rows and the policy decides between them on every read, so
 *   "what have I overridden" is the `ADMIN` filter and nothing else.
 * - **There is no revert.** A typed price with a typo is a row the operator
 *   removes from the history screen, and adds again. Editing a price is
 *   inserting a price.
 * - **`stale` is a column and a filter**, and it is the server's judgement,
 *   never inferred here from the date: only the policy knows which kinds have
 *   a maximum age.
 *
 * ## What the editor adds
 *
 * `PriceFormPage` replaces the generic form for the add, and section 2 of plan
 * 0005 is still why: a price belongs to a **scope** and not to a shop, so the
 * screen has to name the scope, say what kind it is, and say how many shops
 * share it. What changed is the verb: the form inserts an `ADMIN` row and never
 * edits one, so the descriptor's one write goes to the item prices and not to
 * the effective row it was submitted from.
 *
 * ## `unitPrice` is typed in and never derived
 *
 * The obvious derivation, `price / unitSize`, disagrees with the source on 110
 * of 4,232 products, in the field whose only purpose is comparison. So the form
 * derives nothing, and `unitPriceLabel` is a **text** field rather than a picker
 * because it is free text: `100 ml` on a product priced per litre, and `lv` for
 * washing machine loads.
 */
export const PRICES = defineResource<Price>({
  name: 'prices',
  segment: 'prices',
  labels: { one: 'catalog.prices.one', many: 'catalog.prices.many' },

  // The pair the row is keyed on. Its own uuid addresses nothing: no route
  // reads or deletes an effective row by it.
  rowId: (row) => compositeIdOf(row, PRICE_KEY),

  /**
   * A price row carries the product's id and not its name, and no admin read
   * joins one on. Resolving a name per row would be a request per row, which a
   * list cannot afford, so the list shows ids and the detail, which is one
   * row, shows names.
   */
  title: (row) => row.itemId,

  detail: PriceDetailPage,
  editor: PriceFormPage,

  fields: [
    { kind: 'text', name: 'id', label: 'catalog.prices.id', editable: false },
    {
      kind: 'reference',
      name: 'itemId',
      label: 'catalog.prices.itemId',
      resource: 'items',
      required: true,
      // Half of what the row *is*, and half of what the added row is about.
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
      // `numeric(12,2)`, but `AddItemPriceDto` validates it with
      // `@IsNumber()`, so the digits stay text until the last moment.
      decimals: 2,
      wire: 'number',
      nullable: true,
      editable: 'create',
    },
    {
      kind: 'text',
      name: 'currency',
      label: 'catalog.prices.currency',
      nullable: true,
      maxLength: 3,
      editable: 'create',
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
      editable: 'create',
    },
    {
      kind: 'text',
      name: 'unitPriceLabel',
      label: 'catalog.prices.unitPriceLabel',
      help: 'catalog.prices.unitPriceLabelHelp',
      nullable: true,
      maxLength: 32,
      editable: 'create',
    },
    {
      kind: 'date',
      name: 'validFrom',
      label: 'catalog.prices.validFrom',
      help: 'catalog.prices.validFromHelp',
      time: true,
      nullable: true,
      editable: 'create',
    },
    {
      kind: 'date',
      name: 'validUntil',
      label: 'catalog.prices.validUntil',
      help: 'catalog.prices.validUntilHelp',
      time: true,
      nullable: true,
      editable: 'create',
    },
    {
      kind: 'enum',
      name: 'sourceKind',
      label: 'catalog.prices.sourceKind',
      help: 'catalog.prices.sourceKindHelp',
      options: PRICE_SOURCE_KIND_OPTIONS,
      // Catalog decides it, and a write through this app always means `ADMIN`.
      editable: false,
    },
    {
      kind: 'date',
      name: 'observedAt',
      label: 'catalog.prices.observedAt',
      help: 'catalog.prices.observedAtHelp',
      time: true,
      editable: false,
    },
    {
      kind: 'boolean',
      name: 'stale',
      label: 'catalog.prices.stale',
      help: 'catalog.prices.staleHelp',
      editable: false,
    },
    {
      kind: 'boolean',
      name: 'available',
      label: 'catalog.prices.available',
      // Scope wide, and labelled so. The `available` on a location item is a
      // per shop override with a third answer, and the two are never drawn as
      // two checkboxes saying the same word.
      help: 'catalog.prices.availableHelp',
      // Not written from here: a price row carries no claim about stock.
      editable: false,
    },
  ],

  list: {
    columns: [
      'itemId',
      'price',
      'unitPrice',
      'sourceKind',
      'observedAt',
      'stale',
      'validUntil',
      'available',
    ],
    // The columns this screen exists for: what it costs, who said so, when,
    // and whether the server is sure. The product is the card's own heading.
    compact: ['price', 'sourceKind', 'observedAt', 'stale'],
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
      // "What have I overridden." The effective rows an operator's price won.
      kind: 'enum',
      param: 'sourceKind',
      label: 'catalog.prices.filter.sourceKind',
      options: PRICE_SOURCE_KIND_OPTIONS,
    },
    {
      // "What is shown on sufferance."
      kind: 'boolean',
      param: 'stale',
      label: 'catalog.prices.filter.stale',
    },
    {
      kind: 'boolean',
      param: 'available',
      label: 'catalog.prices.filter.available',
    },
  ],

  // Add, and nothing else from the listing. There is no edit, because the row
  // is derived, and no delete, because what an operator removes is a row of
  // the history, from the detail screen, with the history in front of them.
  actions: { create: true },

  gateway: () => {
    const gateways = inject(RESOURCE_GATEWAYS);
    const effective = gateways.for<Price>(priceSource());
    const rows = gateways.for<Wire.CatalogItemPriceView>(itemPriceSource());

    /**
     * The effective rows for reading, and the item prices for the one write.
     *
     * `create` is the add a price form submitting, and it inserts an `ADMIN`
     * row of the history rather than writing the row it listed: the effective
     * row is recomputed behind it by catalog, inside the same transaction. The
     * answer is the new row, which carries the pair the form navigates by.
     */
    const gateway: ResourceGateway<Price> = {
      list: (query) => effective.list(query),
      read: (id) => effective.read(id),
      create: async (input: ResourceInput) =>
        (await rows.create(input)) as unknown as Price,
      update: () => {
        throw new Error(
          'An effective price is derived and cannot be edited. Add a price row instead.'
        );
      },
      remove: () => {
        throw new Error(
          'An effective price is derived and cannot be removed. Remove the rows behind it.'
        );
      },
    };
    return gateway;
  },
});
