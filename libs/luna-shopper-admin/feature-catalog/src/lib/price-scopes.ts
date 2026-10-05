import { inject } from '@angular/core';
import { RESOURCE_GATEWAYS } from '@portfolio/luna-shopper-admin/data-access';
import {
  CONTENT_LOCALES,
  defineResource,
  fieldMessage,
  localizedTextValue,
  type FieldMessage,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { PRICE_SCOPE_KIND_OPTIONS, priceScopeMark } from './catalog-enums';
import { priceScopeSource } from './catalog-sources';
import { ChainContext } from './chains/chain-context';

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
 *
 * The words are the kinds' own (admin plan 0028, section 2): a band and the
 * kind that defaults to it are one tier, and two sets of names for four tiers
 * was one set too many. A key rather than English, so the field's `read`
 * hands the cell something to translate.
 */
export function priorityBand(priority: number): FieldMessage {
  switch (priority) {
    case 100:
      return fieldMessage('catalog.priceScopeKind.STORE');
    case 200:
      return fieldMessage('catalog.priceScopeKind.LOCAL_AREA');
    case 300:
      return fieldMessage('catalog.priceScopeKind.REGION');
    case 1000:
      return fieldMessage('catalog.priceScopeKind.NATIONAL');
    default:
      return fieldMessage('catalog.priceScopes.priorityCustom', { priority });
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
 * **No `sorts`.** `GET /v1/admin/catalog/price-scopes` accepts a cursor, a
 * limit, a chain and kinds, and nothing that orders. It orders by creation and
 * a control offering anything else would be a control that changes nothing.
 */
export const PRICE_SCOPES = defineResource<PriceScope>({
  name: 'price-scopes',
  // The Price scopes tab of a chain (admin plan 0042).
  segment: 'scopes',
  labels: {
    one: 'catalog.priceScopes.one',
    many: 'catalog.priceScopes.many',
    create: 'catalog.priceScopes.add',
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
      scope: (row) => priceScopeMark(row.kind),
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
    // The chain is the page this list is a tab of, so it is not a column.
    columns: ['label', 'kind', 'externalKey', 'priority'],
    // A scope is told from its siblings by what kind it is and which warehouse
    // it stands for.
    compact: ['kind', 'externalKey'],
  },

  // The chain is in the address: `/chains/{chainId}/scopes`.
  parent: {
    resource: 'supermarkets',
    param: 'chainId',
    filter: 'supermarketId',
  },

  // The one question the list answers besides "which chain": the general
  // scopes of a chain are a handful, and its single shop scopes are one per
  // shop. The route takes `kind`, and takes nothing that orders by it.
  filters: [
    {
      kind: 'enum',
      param: 'kind',
      label: 'catalog.priceScopes.filter.kind',
      options: PRICE_SCOPE_KIND_OPTIONS,
    },
  ],

  /**
   * "Default" on the scope its chain falls back to (admin plan 0042, target
   * 7). A fact about the chain, so it is read from the chain's page and drawn
   * only on a list that is a tab of one.
   */
  rowStates: () => {
    const chain = inject(ChainContext, { optional: true });

    return (row) =>
      chain !== null && chain.chain()?.defaultPriceScopeId === row.id
        ? [{ label: 'catalog.priceScopes.state.default', tone: 'good' }]
        : [];
  },

  actions: {
    create: true,
    edit: true,
    delete: true,
    /**
     * "Make default", on every scope but the one that already is.
     *
     * It writes the chain and not the scope: the default is the chain's
     * `defaultPriceScopeId`. So it exists only on a list under a chain's page,
     * which is what holds the chain and reads it again afterwards.
     *
     * Not on a single shop scope. The default is what a shop of the chain
     * falls back to when nothing more specific holds a price, and one shop's
     * own scope is the most specific there is. The gateway accepts it, so
     * this is the screen declining to offer a mistake.
     */
    named: () => {
      const chain = inject(ChainContext, { optional: true });

      return chain === null
        ? []
        : [
            {
              name: 'makeDefault',
              label: 'catalog.priceScopes.makeDefault',
              available: (row) =>
                row.kind !== 'STORE' &&
                chain.chain()?.defaultPriceScopeId !== row.id,
              run: (row) => chain.setDefaultScope(row.id),
            },
          ];
    },
  },

  gateway: () => inject(RESOURCE_GATEWAYS).for<PriceScope>(priceScopeSource()),
});
