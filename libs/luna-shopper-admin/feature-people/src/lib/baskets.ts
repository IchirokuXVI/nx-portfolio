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
 *
 * **It stayed read only when plan 0009 made the rest of the app editable**, and
 * the screen says so rather than looking unfinished. A basket is output: it is
 * composed from the wanted, approved lines of the zones somebody chose, at a
 * moment recorded in `sourceSnapshot`, and its lines accumulate claims and
 * settlements while that person walks around the shop. A changed `content`
 * contradicts the origin that says where it came from, and a changed `quantity`
 * contradicts settlement rows already written against it. None of that is
 * repairable, and a basket is readable only by its owner, so the change would
 * land silently inside one person's private working document. What an operator
 * can do instead is correct the list it came from (backend plan 0077, section
 * 6.4).
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

  // Why there is nothing to press here, where an operator would look for it.
  note: 'people.baskets.note',

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
