import { inject } from '@angular/core';
import {
  RESOURCE_GATEWAYS,
  type ResourceGatewaysI,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  CONTENT_LOCALES,
  defineResource,
  localizedTextValue,
  type ResourceGateway,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { PRICE_SCOPE_KINDS } from './catalog-enums';
import { PRICE_SCOPES_PATH } from './catalog-paths';
import { PRICE_SCOPE_SEED } from './price-scopes-seed';

/** A price scope, as the gateway describes it. */
export type PriceScope = Wire.CatalogPriceScopeView;

/**
 * What a price is attached to, which is not a shop (plan 0005, section 2).
 *
 * This is the single most confusing thing in the domain and the place a well
 * meaning screen creates wrong data. Mercadona publishes one price per
 * warehouse and twelve shops in Córdoba share it, so a price row is keyed on
 * `(itemId, priceScopeId)` and "the price of milk at this Mercadona" is really
 * "the price for warehouse 4661".
 *
 * A chain with no automated source gets one `STORE` scope per shop, which makes
 * hand entered prices work with no special case. So there is no "manual chain"
 * mode anywhere in these screens: the data model already handles it, and what
 * the screens owe it is an honest rendering.
 *
 * **The title says the kind and the key, and that is deliberate.** A scope has
 * no name of its own worth showing: `label` is usually empty, and two warehouse
 * scopes of one chain differ only by their external key. A picker offering four
 * rows all called "Mercadona" would be a picker that cannot be used.
 */
export const PRICE_SCOPES = defineResource<PriceScope>({
  name: 'price-scopes',
  segment: 'price-scopes',
  labels: { one: 'catalog.priceScopes.one', many: 'catalog.priceScopes.many' },

  title: (row) => {
    const label = localizedTextValue(row.label, CONTENT_LOCALES);
    const key = row.externalKey ?? '';
    const parts = [row.kind, key, label].filter((part) => part !== '');
    return parts.join(' · ');
  },

  fields: [
    {
      kind: 'text',
      name: 'id',
      label: 'catalog.priceScopes.id',
      editable: false,
    },
    {
      kind: 'reference',
      name: 'supermarketId',
      label: 'catalog.priceScopes.supermarketId',
      help: 'catalog.priceScopes.supermarketIdHelp',
      resource: 'supermarkets',
      required: true,
      // `UpdatePriceScopeDto` has no `supermarketId`. A scope cannot change
      // chains, and a form that offered it would take the answer and drop it.
      createOnly: true,
    },
    {
      kind: 'enum',
      name: 'kind',
      label: 'catalog.priceScopes.kind',
      help: 'catalog.priceScopes.kindHelp',
      options: PRICE_SCOPE_KINDS,
      required: true,
    },
    {
      kind: 'text',
      name: 'externalKey',
      label: 'catalog.priceScopes.externalKey',
      help: 'catalog.priceScopes.externalKeyHelp',
      maxLength: 64,
      nullable: true,
    },
    {
      kind: 'localized-text',
      name: 'label',
      label: 'catalog.priceScopes.label',
      help: 'catalog.priceScopes.labelHelp',
      locales: CONTENT_LOCALES,
      maxLength: 200,
      nullable: true,
    },
  ],

  list: {
    columns: ['kind', 'externalKey', 'label', 'supermarketId'],
    // The kind and the key are the whole identity of a scope. Its chain is
    // usually the filter that got the operator here, so repeating it on every
    // card would spend a phone's width saying what they already chose.
    compact: ['kind', 'externalKey'],
  },

  filters: [
    {
      kind: 'reference',
      param: 'supermarketId',
      label: 'catalog.priceScopes.supermarketId',
      resource: 'supermarkets',
    },
  ],

  // No sorts. The route accepts an `order` parameter and drops it: the service
  // orders by creation, newest first, whatever is asked. A control that changed
  // nothing would be worse than none.

  actions: { create: true, edit: true, delete: true },

  /**
   * The scopes, with one thing the gateway cannot do.
   *
   * There is **no `GET /price-scopes/{id}`**. A scope is read back out of the
   * collection instead, which the source says by naming `id` as the key with no
   * filter to narrow it: the list is unscoped when no chain is given, so the
   * row is found wherever it is. It costs a page rather than a row, and scopes
   * are few: one per chain, or one per warehouse, or one per shop.
   */
  gateway: () => priceScopeGateway(inject(RESOURCE_GATEWAYS)),
});

/**
 * The scopes' gateway, typed, for the one screen that reads a scope on its own.
 *
 * The descriptor's own `gateway()` answers a gateway over any row, which is what
 * a registry can hold and not what a caller wanting `supermarketId` off the
 * result can use.
 */
export function priceScopeGateway(
  gateways: ResourceGatewaysI
): ResourceGateway<PriceScope> {
  return gateways.for<PriceScope>({
    path: PRICE_SCOPES_PATH,
    seed: PRICE_SCOPE_SEED,
    key: ['id'],
    keyFilters: [],
  });
}
