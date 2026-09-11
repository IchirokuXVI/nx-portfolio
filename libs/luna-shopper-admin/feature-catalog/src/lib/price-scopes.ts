import { inject } from '@angular/core';
import { RESOURCE_GATEWAYS } from '@portfolio/luna-shopper-admin/data-access';
import {
  CONTENT_LOCALES,
  defineResource,
  localizedTextValue,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { PRICE_SCOPE_KIND_OPTIONS } from './catalog-enums';
import { priceScopeSource } from './catalog-sources';

/** A set of shops that share one price, as the gateway describes it. */
export type PriceScope = Wire.CatalogPriceScopeView;

/**
 * What a priority reads as (plan 0105, section 6).
 *
 * **The number is the backend's and the word is this app's**, which is the
 * split the plan is built on: a chain that prices by province sits at 250 with
 * no new kind and no release here, and this function is what has to cope with
 * that rather than refuse it. So the four defaults have words and anything
 * else says plainly that it has none, with the number, instead of rounding
 * itself into the nearest band and lying about which shops it covers.
 */
export function priorityBand(priority: number): string {
  switch (priority) {
    case 100:
      return 'This shop';
    case 200:
      return 'Postal code';
    case 300:
      return 'Region';
    case 1000:
      return 'Everywhere';
    default:
      return `Custom (${priority})`;
  }
}

/**
 * Price scopes: the thing a price actually belongs to (plan 0005, section 2).
 *
 * This is the resource that makes the rest of the catalog readable. A price is
 * **not** attached to a shop. `SupermarketItem` is keyed on
 * `(itemId, priceScopeId)`, because Mercadona publishes one price per warehouse
 * and the twelve shops in Córdoba that warehouse serves share it. A chain with
 * no automated source gets one `STORE` scope per shop instead, which is what
 * lets a hand typed price work with no special case: the data model already
 * covers it, so no screen needs a "manual supermarket" mode.
 *
 * Two things about the shape of this screen.
 *
 * **There is no `GET /price-scopes/{id}`.** The gateway has four routes here and
 * reading one row is not among them, so `readVia: 'collection'` finds a member by
 * reading the collection. With a chain named that is one page; without one it
 * walks a bounded number of pages and then answers not found, which is what the
 * screen would have said anyway.
 *
 * **No `sorts`.** `GET /v1/admin/catalog/price-scopes` accepts a cursor, a limit
 * and a chain, and nothing else. It orders by creation and a control offering
 * anything else would be a control that changes nothing.
 */
export const PRICE_SCOPES = defineResource<PriceScope>({
  name: 'price-scopes',
  segment: 'price-scopes',
  labels: {
    one: 'catalog.priceScopes.one',
    many: 'catalog.priceScopes.many',
  },

  /**
   * What one scope is called, which is mostly not its label.
   *
   * A harvested scope has no label at all: it is `REGION 4661`, and that is
   * the string an operator recognises, because the external key is the
   * number the source publishes. So the kind and the key are the
   * fallback rather than the id, which would name it after something nobody has
   * ever seen.
   */
  title: (row, locales) => {
    const label = localizedTextValue(row.label, locales);
    if (label !== '') {
      return label;
    }
    return row.externalKey === null
      ? row.kind
      : `${row.kind} ${row.externalKey}`;
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
      // Chains number a handful, so one cached resolve per distinct id names
      // the column (admin plan 0023, section 4).
      nameLookup: true,
      required: true,
      // `CreatePriceScopeDto` takes the chain and `UpdatePriceScopeDto` does
      // not, so a scope belongs to whichever chain it was made under and stays
      // there. A control the server ignores would be worse than none.
      editable: 'create',
    },
    {
      kind: 'enum',
      name: 'kind',
      label: 'catalog.priceScopes.kind',
      help: 'catalog.priceScopes.kindHelp',
      options: PRICE_SCOPE_KIND_OPTIONS,
      required: true,
    },
    {
      kind: 'text',
      name: 'externalKey',
      label: 'catalog.priceScopes.externalKey',
      help: 'catalog.priceScopes.externalKeyHelp',
      nullable: true,
      // The gateway's own limit, and a string rather than a number on purpose:
      // the key arrives as a warehouse code (`4661`) and as a city slug (`mad3`).
      maxLength: 64,
    },
    {
      kind: 'localized-text',
      name: 'label',
      label: 'catalog.priceScopes.label',
      help: 'catalog.priceScopes.labelHelp',
      locales: CONTENT_LOCALES,
      nullable: true,
      maxLength: 200,
    },
    {
      kind: 'text',
      name: 'priority',
      label: 'catalog.priceScopes.priority',
      help: 'catalog.priceScopes.priorityHelp',
      // Shown as a word and never as an input. Moving a scope re-ranks every
      // shop that holds it (plan 0105, section 2.1), so it is not a control an
      // operator reaches past on the way to fixing a label; a create takes the
      // default for its kind, and a deliberate move goes through the API.
      editable: false,
      read: (row) => priorityBand(row.priority),
    },
  ],

  list: {
    columns: ['label', 'kind', 'priority', 'externalKey', 'supermarketId'],
    // A scope is told from its siblings by what kind it is and which warehouse
    // it stands for. Its chain is the thing the filter above already fixed, so
    // repeating it on every card would spend the width saying one answer twice.
    compact: ['kind', 'externalKey'],
  },

  filters: [
    {
      kind: 'reference',
      param: 'supermarketId',
      label: 'catalog.priceScopes.filter.supermarketId',
      resource: 'supermarkets',
    },
  ],

  actions: { create: true, edit: true, delete: true },

  gateway: () => inject(RESOURCE_GATEWAYS).for<PriceScope>(priceScopeSource()),
});
