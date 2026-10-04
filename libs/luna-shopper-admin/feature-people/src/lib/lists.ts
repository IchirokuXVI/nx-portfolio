import { inject } from '@angular/core';
import {
  ADMIN_LISTS_PATH,
  RESOURCE_GATEWAYS,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  defineResource,
  type InfoContent,
} from '@portfolio/luna-shopper-admin/models';
import { LIST_SEED, type ListRow } from './people-seed';
import { ZONE_CAUTION, ZONE_PARAM } from './shopper-params';

/** A standing list inside a zone, as the back office reads one. */
export type List = ListRow;

/** What the info button of a list says (admin plan 0045, target 7). */
export const LIST_INFO: InfoContent = {
  title: 'people.lists.info.title',
  points: ['people.lists.info.corrects', 'people.lists.info.adds'],
};

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
 * **The lists are a tab of their zone** (admin plan 0045), so the zone is read
 * from the address and is no filter. Lists by who made them is dropped: that
 * filter has no screen in this design.
 *
 * **Its lines are on the list's own page.** Reading what a household wrote
 * down is a deliberate click, not something that happens while browsing zones,
 * which is why the tab shows list names and counts and the page shows
 * contents. `shoppersRoutes` mounts that page.
 */
export const LISTS = defineResource<List>({
  name: 'lists',
  segment: 'lists',
  parent: { resource: 'zones', param: ZONE_PARAM, filter: 'zoneId' },
  labels: { one: 'people.lists.one', many: 'people.lists.many' },

  title: (row) => row.name,

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
    // No zone column: the tab is the zone's.
    columns: ['name', 'lineCount', 'sharedWithZone', 'createdAt'],
    compact: ['lineCount', 'sharedWithZone'],
  },

  info: LIST_INFO,
  caution: ZONE_CAUTION,

  actions: { edit: true, delete: true },

  gateway: () =>
    inject(RESOURCE_GATEWAYS).for<List>({
      path: ADMIN_LISTS_PATH,
      seed: LIST_SEED,
    }),
});
