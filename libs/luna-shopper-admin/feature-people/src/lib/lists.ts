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
 * The standing lists (plan 0007, section 2, widened by plan 0009, section 4.1).
 *
 * **Three fields change**, which is everything `UpdateListRequest` carries, and
 * a list can be deleted. Every write goes through `ListService`, so an operator
 * makes the change a member of the zone would make, with the same events behind
 * it.
 *
 * **`sharedWithZone` is the field this screen most has to explain.** The control
 * is a checkbox, so it looks symmetric, and the behaviour is not: turning it on
 * grants read, write and decide to every currently approved non staff member,
 * and turning it off revokes nobody. It governs who arrives next. An operator
 * who toggles it off to close a list has not closed it, and the field says so
 * above the control rather than in a document.
 *
 * `zoneId` and `createdByUserId` stay fixed: moving a list between zones is not
 * something the backend does, and who wrote a list is a fact rather than a
 * setting.
 *
 * **Its lines are on the detail screen and on their own screen.** Reading what a
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
    {
      kind: 'text',
      name: 'id',
      label: 'people.lists.id',
      help: 'people.field.idHelp',
      editable: false,
    },
    {
      kind: 'text',
      name: 'name',
      label: 'people.lists.name',
      required: true,
      maxLength: 80,
    },
    {
      kind: 'text',
      name: 'zoneName',
      label: 'people.lists.zone',
      help: 'people.lists.zoneHelp',
      editable: false,
    },
    {
      kind: 'reference',
      name: 'createdByUserId',
      label: 'people.lists.createdByUserId',
      resource: 'users',
      help: 'people.lists.createdByUserIdHelp',
      editable: false,
    },
    {
      kind: 'number',
      name: 'lineCount',
      label: 'people.lists.lineCount',
      help: 'people.lists.lineCountHelp',
      editable: false,
    },
    {
      kind: 'boolean',
      name: 'autoApproveLines',
      label: 'people.lists.autoApproveLines',
      help: 'people.lists.autoApproveLinesHelp',
    },
    {
      kind: 'boolean',
      name: 'sharedWithZone',
      label: 'people.lists.sharedWithZone',
      help: 'people.lists.sharedWithZoneHelp',
    },
    {
      kind: 'date',
      name: 'createdAt',
      label: 'people.lists.createdAt',
      help: 'people.field.createdAtHelp',
      editable: false,
    },
  ],

  list: {
    columns: ['name', 'zoneName', 'lineCount', 'sharedWithZone', 'createdAt'],
    compact: ['zoneName', 'lineCount'],
  },

  formNote: 'people.broadcast',

  actions: { edit: true, delete: true },

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
