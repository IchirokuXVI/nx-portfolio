import { inject } from '@angular/core';
import {
  RESOURCE_GATEWAYS,
  type ResourceGatewaysI,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  defineResource,
  naturalKey,
  type ResourceGateway,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { PRICE_SOURCE_KINDS } from './catalog-enums';
import { PRICES_PATH } from './catalog-paths';
import { PRICE_SEED } from './prices-seed';

/** A price, as the gateway describes it. */
export type Price = Wire.CatalogSupermarketItemView;

/** What addresses a price: the product and the scope, and never a shop. */
export const PRICE_KEY = ['itemId', 'priceScopeId'] as const;

/** Where a pinned price is listed, and the filter that finds every one of them. */
export const ADMIN_PRICE_FILTER = { priceSourceKind: 'ADMIN' } as const;

/** Whether this row is a price a person typed in, and therefore pinned. */
export function isPinned(row: Price): boolean {
  return row.priceSourceKind === 'ADMIN';
}

/**
 * The prices, which are the screen plan 0005 section 4 is about.
 *
 * **A price belongs to a scope, not to a shop.** `(itemId, priceScopeId)` is
 * the key, twelve shops served by one warehouse share one row, and an interface
 * that hid that would not be simpler, it would be wrong: an operator correcting
 * a price they saw in one shop would silently change it for eleven others. So
 * the scope is a field on this descriptor and a shop is not, the form names the
 * scope and says how many shops it covers, and nothing here offers a shop to
 * price against.
 *
 * **A typed price is permanent and invisible, and this screen is what makes it
 * neither.** Writing a price by hand sets `priceSourceKind` to `ADMIN`, and
 * from then on every automated fetch refuses to overwrite it, with no queue
 * anywhere surfacing the disagreement. Three things follow, and all three are
 * here:
 *
 * - `priceSourceKind` is a column **and** a filter, so "what have I pinned" is
 *   answerable. It is the only way to ask that question.
 * - `priceObservedAt` is a column, so a stale price is recognisable as stale.
 * - Unpinning is an action, so a typo is not permanent.
 *
 * **`unitPrice` is typed in and never derived.** The obvious derivation,
 * `price / unitSize`, disagrees with the source on 110 of 4,232 products, in
 * the field whose only purpose is comparison. `unitPriceLabel` is free text and
 * not a unit: a product labelled `100 ml` carries a price per litre, and `lv`
 * means washing machine loads.
 */
export const PRICES = defineResource<Price>({
  name: 'prices',
  segment: 'prices',
  labels: { one: 'catalog.prices.one', many: 'catalog.prices.many' },

  // The product's name would be a request per row, which a list cannot afford.
  // A price is recognised by what it costs, and the row it belongs to is what
  // the form is for.
  title: (row) => (row.price === null ? '' : String(row.price)),

  identify: (row) => naturalKey(row, PRICE_KEY),

  fields: [
    { kind: 'text', name: 'id', label: 'catalog.prices.id', editable: false },
    {
      kind: 'reference',
      name: 'itemId',
      label: 'catalog.prices.itemId',
      resource: 'items',
      required: true,
      createOnly: true,
    },
    {
      kind: 'reference',
      name: 'priceScopeId',
      label: 'catalog.prices.priceScopeId',
      help: 'catalog.prices.priceScopeIdHelp',
      // Price scopes, and never locations. A picker of shop names here is the
      // mistake this whole screen exists to prevent.
      resource: 'price-scopes',
      required: true,
      createOnly: true,
    },
    {
      kind: 'money',
      name: 'price',
      label: 'catalog.prices.price',
      help: 'catalog.prices.priceHelp',
      decimals: 2,
      // The column is `numeric(12,2)` but `UpsertSupermarketItemDto` validates
      // it with `@IsNumber()`, so the digits are held as text and converted
      // once, here, on a value validation has already agreed is readable.
      wire: 'number',
      nullable: true,
    },
    {
      kind: 'text',
      name: 'currency',
      label: 'catalog.prices.currency',
      maxLength: 3,
      nullable: true,
    },
    {
      kind: 'money',
      name: 'unitPrice',
      label: 'catalog.prices.unitPrice',
      help: 'catalog.prices.unitPriceHelp',
      decimals: 4,
      wire: 'number',
      nullable: true,
    },
    {
      kind: 'text',
      name: 'unitPriceLabel',
      label: 'catalog.prices.unitPriceLabel',
      help: 'catalog.prices.unitPriceLabelHelp',
      maxLength: 32,
      nullable: true,
    },
    {
      kind: 'boolean',
      name: 'available',
      label: 'catalog.prices.available',
      help: 'catalog.prices.availableHelp',
    },
    {
      kind: 'enum',
      name: 'priceSourceKind',
      label: 'catalog.prices.priceSourceKind',
      help: 'catalog.prices.priceSourceKindHelp',
      options: PRICE_SOURCE_KINDS,
      // The server decides it: writing through this app means ADMIN, and the
      // upsert DTO has no property to say otherwise. Shown, because "did I type
      // this" is the question the whole screen answers.
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
      'price',
      'unitPrice',
      'unitPriceLabel',
      'priceSourceKind',
      'priceObservedAt',
      'available',
    ],
    // The three that answer "is this price right": what it costs, whether a
    // person pinned it, and how long ago it was seen. The per unit figure is
    // for comparing two products, which is not what a phone screen full of one
    // scope's prices is for.
    compact: ['price', 'priceSourceKind', 'priceObservedAt'],
  },

  filters: [
    {
      kind: 'enum',
      param: 'priceSourceKind',
      label: 'catalog.prices.priceSourceKind',
      options: PRICE_SOURCE_KINDS,
    },
    {
      kind: 'reference',
      param: 'itemId',
      label: 'catalog.prices.itemId',
      resource: 'items',
    },
    {
      kind: 'reference',
      param: 'supermarketId',
      label: 'catalog.prices.supermarketId',
      resource: 'supermarkets',
      // A scope cannot be searched for by name, so the chain narrows the picker
      // below it. The route has no chain parameter, so it is never sent.
      local: true,
    },
    {
      kind: 'reference',
      param: 'priceScopeId',
      label: 'catalog.prices.priceScopeId',
      resource: 'price-scopes',
      scopedBy: 'supermarketId',
    },
    {
      kind: 'boolean',
      param: 'available',
      label: 'catalog.prices.available',
    },
  ],

  // No sorts. The route accepts an `order` parameter and drops it.

  actions: {
    create: true,
    edit: true,
    delete: true,
    named: [
      {
        name: 'unpin',
        label: 'catalog.prices.unpin',
        confirm: true,
        // Only a price a person typed is pinned. Offering this on a harvested
        // row would promise something that is already true of it.
        available: isPinned,
        run: (row, gateway) => unpin(row, gateway),
      },
    ],
  },

  /**
   * The prices, written with a `PUT` and read out of a list.
   *
   * There is no member route: a price is written by naming its key in the body,
   * and it answers with an `id` that only the `DELETE` accepts. The list
   * filters on both halves of the key, so reading one back costs one request.
   */
  gateway: () => priceGateway(inject(RESOURCE_GATEWAYS)),
});

/**
 * Undo a pin, by clearing the price it holds.
 *
 * **Clearing the price is what unpins the row**, and it is the only thing that
 * does. Nothing in the gateway can change `priceSourceKind`: the upsert DTO has
 * no property for it, and a write from this app means `ADMIN` by definition. But
 * the rule that protects a pinned price checks the price as well as the source,
 * and a row holding no price is written by the next automated run whatever its
 * source says. So the pin stops mattering, which is what the operator asked for.
 *
 * The row survives, and so does everything else on it. Deleting it would be the
 * cruder repair and would take `available` with it; this leaves the product and
 * the scope joined and simply stops asserting a price that was wrong.
 *
 * `unitPrice` and its label go too. A per unit figure standing beside no price
 * is a comparison against nothing, and it came from the same typing.
 */
export function unpin(
  row: Price,
  gateway: ResourceGateway<Price>
): Promise<void> {
  return gateway
    .update(naturalKey(row, PRICE_KEY), {
      price: null,
      unitPrice: null,
      unitPriceLabel: null,
    })
    .then(() => undefined);
}

/** The prices' gateway, built from a source the same way every other one is. */
export function priceGateway(
  gateways: ResourceGatewaysI
): ResourceGateway<Price> {
  return gateways.for<Price>({
    path: PRICES_PATH,
    seed: PRICE_SEED,
    upsert: true,
    key: PRICE_KEY,
  });
}
