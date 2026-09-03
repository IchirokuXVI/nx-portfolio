import { inject } from '@angular/core';
import {
  ADMIN_BASKETS_PATH,
  RESOURCE_GATEWAYS,
} from '@portfolio/luna-shopper-admin/data-access';
import { defineResource } from '@portfolio/luna-shopper-admin/models';
import { BasketDetailPage } from './basket-detail-page';
import { BASKET_SEED, type BasketRow } from './people-seed';

/** A generated shopping list, as the back office reads one. */
export type Basket = BasketRow;

/** Where a basket is in its life, which is the whole of `GeneratedListStatus`. */
export const BASKET_STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'people.baskets.status.DRAFT' },
  { value: 'ACTIVE', label: 'people.baskets.status.ACTIVE' },
  { value: 'COMPLETED', label: 'people.baskets.status.COMPLETED' },
  { value: 'ARCHIVED', label: 'people.baskets.status.ARCHIVED' },
] as const;

/**
 * The shopping lists people take round the shop (plan 0007, section 2).
 *
 * Read only, by zone and by owner, with the lines on the detail screen alone.
 *
 * A basket belongs to a **person** rather than to a zone, so the zone filter
 * matches through the line origins: the zones a basket's lines were drawn from.
 * That is why a basket carries several `zoneIds` and why filtering by one of
 * them is not the same question as filtering a list by its zone.
 */
export const BASKETS = defineResource<Basket>({
  name: 'baskets',
  segment: 'shopping-lists',
  labels: { one: 'people.baskets.one', many: 'people.baskets.many' },

  // A basket needs no name, and an unnamed one is the ordinary case: velista
  // generates it and the shopper never titles it. So the fallback is its id,
  // which is the only other thing that tells two of them apart.
  title: (row) => row.name ?? row.id,

  detail: BasketDetailPage,

  fields: [
    { kind: 'text', name: 'id', label: 'people.baskets.id', editable: false },
    {
      kind: 'text',
      name: 'name',
      label: 'people.baskets.name',
      editable: false,
    },
    {
      kind: 'enum',
      name: 'status',
      label: 'people.baskets.status.label',
      options: BASKET_STATUS_OPTIONS,
      editable: false,
    },
    {
      kind: 'number',
      name: 'lineCount',
      label: 'people.baskets.lineCount',
      editable: false,
    },
    {
      kind: 'date',
      name: 'generatedAt',
      label: 'people.baskets.generatedAt',
      time: true,
      editable: false,
    },
  ],

  list: {
    columns: ['name', 'status', 'lineCount', 'generatedAt'],
    compact: ['status', 'lineCount'],
  },

  filters: [
    {
      kind: 'reference',
      param: 'ownerUserId',
      label: 'people.baskets.filter.ownerUserId',
      resource: 'users',
    },
    {
      kind: 'reference',
      param: 'zoneId',
      label: 'people.baskets.filter.zoneId',
      resource: 'zones',
    },
  ],

  gateway: () =>
    inject(RESOURCE_GATEWAYS).for<Basket>({
      path: ADMIN_BASKETS_PATH,
      seed: BASKET_SEED,
    }),
});
