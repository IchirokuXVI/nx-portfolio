import { inject } from '@angular/core';
import {
  ADMIN_LISTS_PATH,
  RESOURCE_GATEWAYS,
} from '@portfolio/luna-shopper-admin/data-access';
import { defineResource } from '@portfolio/luna-shopper-admin/models';
import { ListDetailPage } from './list-detail-page';
import { LIST_SEED, type ListRow } from './people-seed';

/** A standing list inside a zone, as the back office reads one. */
export type List = ListRow;

/**
 * The standing lists (plan 0007, section 2).
 *
 * Read only, entirely, and by zone or by owner. There are no actions at all
 * here, because there is no service behind one: a list line participates in
 * settlements, generated list bindings, permission sets and realtime broadcasts
 * other clients have already applied, and an action with nothing to delegate to
 * is a backend plan rather than a button.
 *
 * **Its lines are on the detail screen and nowhere else.** Reading what a
 * household wrote down is a deliberate click, not something that happens while
 * browsing zones, which is why the zone screen shows list names and counts and
 * this one shows contents.
 */
export const LISTS = defineResource<List>({
  name: 'lists',
  segment: 'lists',
  labels: { one: 'people.lists.one', many: 'people.lists.many' },

  title: (row) => row.name,

  detail: ListDetailPage,

  fields: [
    { kind: 'text', name: 'id', label: 'people.lists.id', editable: false },
    { kind: 'text', name: 'name', label: 'people.lists.name', editable: false },
    {
      kind: 'text',
      name: 'zoneName',
      label: 'people.lists.zone',
      editable: false,
    },
    {
      kind: 'number',
      name: 'lineCount',
      label: 'people.lists.lineCount',
      editable: false,
    },
    {
      kind: 'boolean',
      name: 'sharedWithZone',
      label: 'people.lists.sharedWithZone',
      editable: false,
    },
    {
      kind: 'date',
      name: 'createdAt',
      label: 'people.lists.createdAt',
      editable: false,
    },
  ],

  list: {
    columns: ['name', 'zoneName', 'lineCount', 'sharedWithZone', 'createdAt'],
    compact: ['zoneName', 'lineCount'],
  },

  filters: [
    {
      kind: 'reference',
      param: 'zoneId',
      label: 'people.lists.filter.zoneId',
      resource: 'zones',
    },
    {
      kind: 'reference',
      param: 'createdByUserId',
      label: 'people.lists.filter.createdByUserId',
      resource: 'users',
    },
  ],

  gateway: () =>
    inject(RESOURCE_GATEWAYS).for<List>({
      path: ADMIN_LISTS_PATH,
      seed: LIST_SEED,
    }),
});
