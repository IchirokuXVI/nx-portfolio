import { inject } from '@angular/core';
import { RESOURCE_GATEWAYS } from '@portfolio/luna-shopper-admin/data-access';
import {
  defineResource,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { PRICE_SOURCE_KIND_OPTIONS } from './catalog-enums';
import { pricePolicySource } from './catalog-sources';

/** One policy row, as the gateway describes it. */
export type PricePolicy = Wire.CatalogPricePolicyView;

/**
 * The six policy rows (backend plan 0080, section 3): how each source kind
 * competes for the price a shopper sees.
 *
 * The smallest screen in the back office, and a plain descriptor: six rows,
 * edit only, three editable columns. Lower `priority` wins. `maxAgeDays` is
 * how old a row of that kind may be before it stops being eligible, and null
 * means never. `enabled` off removes the kind from every read at once.
 *
 * **A change here recomputes every effective price** in the catalog, inside
 * the request, which is why the form says so above its fields. It is rare
 * enough to be synchronous and consequential enough to be said.
 *
 * `ADMIN` has no max age on purpose, and the form does not stop an operator
 * setting one, because the policy is theirs. What it does say is what the
 * plan said: most supermarkets will never have an automated source, so for
 * them a typed price is the only truth and a max age makes it stale a week
 * after it was typed. The seven days a typed price is protected for live on
 * the row, not here.
 */
export const PRICE_POLICIES = defineResource<PricePolicy>({
  name: 'price-policies',
  segment: 'price-policies',
  labels: {
    one: 'catalog.pricePolicies.one',
    many: 'catalog.pricePolicies.many',
  },

  // The kind is the id: there are six, they are fixed, and the `PATCH` takes
  // the kind in its path.
  idField: 'sourceKind',

  title: (row) => row.sourceKind,

  fields: [
    {
      kind: 'enum',
      name: 'sourceKind',
      label: 'catalog.pricePolicies.sourceKind',
      options: PRICE_SOURCE_KIND_OPTIONS,
      editable: false,
    },
    {
      kind: 'number',
      name: 'priority',
      label: 'catalog.pricePolicies.priority',
      help: 'catalog.pricePolicies.priorityHelp',
      integer: true,
      required: true,
    },
    {
      kind: 'number',
      name: 'maxAgeDays',
      label: 'catalog.pricePolicies.maxAgeDays',
      help: 'catalog.pricePolicies.maxAgeDaysHelp',
      integer: true,
      min: 1,
      nullable: true,
    },
    {
      kind: 'boolean',
      name: 'enabled',
      label: 'catalog.pricePolicies.enabled',
      help: 'catalog.pricePolicies.enabledHelp',
    },
  ],

  list: {
    columns: ['sourceKind', 'priority', 'maxAgeDays', 'enabled'],
    compact: ['priority', 'maxAgeDays', 'enabled'],
  },

  note: 'catalog.pricePolicies.note',
  formNote: 'catalog.pricePolicies.formNote',

  // Six rows, seeded by the migration. Nothing creates a seventh and nothing
  // deletes one: a kind with no policy would be a kind no read could rank.
  actions: { edit: true },

  gateway: () =>
    inject(RESOURCE_GATEWAYS).for<PricePolicy>(pricePolicySource()),
});
