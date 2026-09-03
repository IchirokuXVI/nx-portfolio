import { inject } from '@angular/core';
import {
  ADMIN_ZONES_PATH,
  DIRECTORY_SERVICE,
  RESOURCE_GATEWAYS,
} from '@portfolio/luna-shopper-admin/data-access';
import { defineResource } from '@portfolio/luna-shopper-admin/models';
import { ZONE_SEED, type ZoneRow } from './people-seed';
import { ZoneDetailPage } from './zone-detail-page';

/** A household, as the back office reads one. */
export type Zone = ZoneRow;

/** The two states a zone can be in, which is the whole of `ZoneStatus`. */
export const ZONE_STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'people.zones.status.ACTIVE' },
  {
    value: 'MARKED_FOR_DELETION',
    label: 'people.zones.status.MARKED_FOR_DELETION',
  },
] as const;

/**
 * The households (plan 0007, section 2).
 *
 * **Listable, and filterable by a single user. That is the whole requirement**
 * and this screen does not exceed it: there is no usage dashboard, no ranking
 * and no cross zone statistics. The filter matches a zone this person owns and
 * a zone they are merely in, of any membership status, because "why can this
 * person not see their zone" is the question the screen exists to answer.
 *
 * The owner column is the one place plan 0074's second call shows through.
 * Zones live in core's database and users live in auth's, with no foreign key
 * between them, so the gateway fetches the names of a page's owners in one
 * batched request and puts them on the rows. When an id resolves to nobody, and
 * a reaped account is a real way for that to happen, `ownerName` is null and
 * this screen renders the id. A listing never fails because a decoration failed.
 */
export const ZONES = defineResource<Zone>({
  name: 'zones',
  segment: 'zones',
  labels: { one: 'people.zones.one', many: 'people.zones.many' },

  title: (row) => row.name,

  detail: ZoneDetailPage,

  fields: [
    { kind: 'text', name: 'id', label: 'people.zones.id', editable: false },
    { kind: 'text', name: 'name', label: 'people.zones.name', editable: false },
    {
      kind: 'text',
      name: 'ownerName',
      label: 'people.zones.owner',
      editable: false,
      // The rule from plan 0074, section 3, as one expression: a name the
      // gateway could not resolve is drawn as the id it could not resolve.
      read: (row) => row.ownerName ?? row.ownerUserId,
    },
    {
      kind: 'enum',
      name: 'status',
      label: 'people.zones.status.label',
      options: ZONE_STATUS_OPTIONS,
      editable: false,
    },
    {
      kind: 'number',
      name: 'memberCount',
      label: 'people.zones.memberCount',
      editable: false,
    },
    {
      kind: 'number',
      name: 'listCount',
      label: 'people.zones.listCount',
      editable: false,
    },
    {
      kind: 'date',
      name: 'createdAt',
      label: 'people.zones.createdAt',
      editable: false,
    },
  ],

  list: {
    columns: [
      'name',
      'ownerName',
      'status',
      'memberCount',
      'listCount',
      'createdAt',
    ],
    // The card is titled with the zone's name, so what belongs under it is who
    // it belongs to and how many people are in it. Counting its lists is a
    // question asked on the detail screen, where the lists are named.
    compact: ['ownerName', 'memberCount'],
  },

  filters: [
    {
      kind: 'reference',
      param: 'userId',
      label: 'people.zones.filter.userId',
      resource: 'users',
    },
    {
      kind: 'date',
      param: 'createdAfter',
      label: 'people.zones.filter.createdAfter',
      edge: 'start',
    },
    {
      kind: 'date',
      param: 'createdBefore',
      label: 'people.zones.filter.createdBefore',
      edge: 'end',
    },
  ],

  actions: {
    named: () => {
      const directory = inject(DIRECTORY_SERVICE);

      return [
        {
          name: 'regenerate-join-code',
          label: 'people.zones.action.regenerateJoinCode',
          confirm: {
            heading: 'people.zones.confirm.regenerateJoinCode.heading',
            body: 'people.zones.confirm.regenerateJoinCode.body',
            confirm: 'people.zones.confirm.regenerateJoinCode.confirm',
          },
          run: async (row) => {
            await directory.regenerateJoinCode(row.id);
          },
        },
        {
          name: 'delete-zone',
          label: 'people.zones.action.deleteZone',
          confirm: {
            heading: 'people.zones.confirm.deleteZone.heading',
            body: 'people.zones.confirm.deleteZone.body',
            confirm: 'people.zones.confirm.deleteZone.confirm',
          },
          run: (row) => directory.deleteZone(row.id),
        },
      ];
    },
  },

  gateway: () =>
    inject(RESOURCE_GATEWAYS).for<Zone>({
      path: ADMIN_ZONES_PATH,
      seed: ZONE_SEED,
    }),
});
