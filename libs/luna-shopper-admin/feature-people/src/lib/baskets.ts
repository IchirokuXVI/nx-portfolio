import { inject } from '@angular/core';
import {
  ADMIN_BASKETS_PATH,
  RESOURCE_GATEWAYS,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  defineResource,
  type AnyResourceDescriptor,
  type InfoContent,
  type ResourceParent,
} from '@portfolio/luna-shopper-admin/models';
import { BasketPage } from './basket-page';
import { BASKET_SEED, type BasketRow } from './people-seed';
import { PERSON_PARAM, ZONE_PARAM } from './shopper-params';

/** A generated shopping list, as the back office reads one. */
export type Basket = BasketRow;

/** What the info button of a shopping list says (admin plan 0045, target 7). */
export const BASKET_INFO: InfoContent = {
  title: 'people.baskets.info.title',
  points: ['people.baskets.info.record', 'people.baskets.info.correct'],
};

/** Where a basket is in its life, which is the whole of `BasketStatus`. */
const BASKET_STATUS_OPTIONS = [
  { value: 'OPEN', label: 'people.baskets.status.OPEN' },
  { value: 'FINISHED', label: 'people.baskets.status.FINISHED' },
  { value: 'ARCHIVED', label: 'people.baskets.status.ARCHIVED' },
] as const;

/**
 * What a basket is (backend plan 0133, section 2).
 *
 * `LIVE` is the one permanent basket a person has and `GENERATED` is a trip
 * somebody composed. An operator reads the column to tell a row that never ends
 * from one that does, which is the difference that decides whether an old open
 * basket is a forgotten trip or the ordinary state of things.
 */
const BASKET_KIND_OPTIONS = [
  { value: 'LIVE', label: 'people.baskets.kind.LIVE' },
  { value: 'GENERATED', label: 'people.baskets.kind.GENERATED' },
] as const;

/**
 * The shopping lists people take round the shop (plan 0007, section 2).
 *
 * Read only, by zone and by owner, with the rows on the shopping list's own
 * page alone.
 *
 * A basket belongs to a **person** rather than to a zone, so it lives under
 * its owner (admin plan 0045): `/shoppers/people/{userId}/shopping-lists/{id}`.
 * The zone filter matches through the line origins: the zones a basket's lines
 * were drawn from. That is why a basket carries several `zoneIds` and why
 * filtering by one of them is not the same question as filtering a list by its
 * zone.
 *
 * **Two descriptors over one collection.** The same rows are a tab of a person
 * and a tab of a zone, and each tab takes a different filter from its address.
 * A descriptor has one parent, so there is one descriptor per tab, built from
 * the same fields and the same gateway. A row of the zone's tab opens under
 * its owner, which the route table does by reading the row.
 *
 * **It stayed read only when plan 0009 made the rest of the app editable**, and
 * the screen says so rather than looking unfinished. A basket is output: it is
 * composed from the wanted, approved lines of the zones somebody chose, which
 * `basket_sources` records, and its lines accumulate claims and
 * settlements while that person walks around the shop. A changed `content`
 * contradicts the origin that says where it came from, and a changed `quantity`
 * contradicts settlement rows already written against it. None of that is
 * repairable, and a basket is readable only by its owner, so the change would
 * land silently inside one person's private working document. What an operator
 * can do instead is correct the list it came from (backend plan 0077, section
 * 6.4).
 */
function basketResource(
  name: string,
  parent: ResourceParent
): AnyResourceDescriptor {
  return defineResource<Basket>({
    name,
    segment: 'shopping-lists',
    parent,
    labels: { one: 'people.baskets.one', many: 'people.baskets.many' },

    // A basket needs no name, and an unnamed one is the ordinary case: velista
    // generates it and the shopper never titles it. So the fallback is the
    // day it was made, as the calendar writes it. It was the ID, and an ID is
    // never what a row is called (admin plan 0051): the list drew a column of
    // uuids as its names. A pure function cannot translate, so the day is in
    // the one form every reader of this app knows.
    title: (row) => row.name ?? row.generatedAt.slice(0, 10),

    // Named so that a row opens. `shoppersRoutes` mounts it under the owner.
    detail: BasketPage,

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
        name: 'kind',
        label: 'people.baskets.kind.label',
        options: BASKET_KIND_OPTIONS,
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
      columns: ['name', 'kind', 'status', 'lineCount', 'generatedAt'],
      compact: ['status', 'lineCount'],
    },

    // Why there is nothing to press here, where an operator would look for it.
    info: BASKET_INFO,

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
}

/** The shopping lists of one person: a tab of that person, and where one is. */
export const BASKETS = basketResource('baskets', {
  resource: 'users',
  param: PERSON_PARAM,
  filter: 'ownerUserId',
});

/** The shopping lists with lines from one zone: a tab of that zone. */
export const ZONE_BASKETS = basketResource('zone-baskets', {
  resource: 'zones',
  param: ZONE_PARAM,
  filter: 'zoneId',
});
