import { inject } from '@angular/core';
import {
  ADMIN_ZONES_PATH,
  DIRECTORY_SERVICE,
  RESOURCE_GATEWAYS,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  defineResource,
  fieldMessage,
} from '@portfolio/luna-shopper-admin/models';
import { ZONE_SEED, type ZoneRow } from './people-seed';
import { ZONE_CAUTION } from './shopper-params';

/** A household, as the back office reads one. */
export type Zone = ZoneRow;

/** The two states a zone can be in, which is the whole of `ZoneStatus`. */
const ZONE_STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'people.zones.status.ACTIVE' },
  {
    value: 'MARKED_FOR_DELETION',
    label: 'people.zones.status.MARKED_FOR_DELETION',
  },
] as const;

/**
 * The households (plan 0007, section 2).
 *
 * **A zone is a page** (admin plan 0045): the Zones tab of Shoppers lists
 * them, and one of them opens beside the list with its members, its lists, its
 * shopping lists and its details as tabs. `shoppersRoutes` mounts all of it,
 * which is why this names no detail component.
 *
 * **A row says how many join requests wait** (`pendingCount`), and the list
 * can be narrowed to the zones that have one. Both come from the gateway.
 *
 * **Listable, and filterable by a single user. That is the whole requirement**
 * and this screen does not exceed it: there is no usage dashboard, no ranking
 * and no cross zone statistics. The filter matches a zone this person owns and
 * a zone they are merely in, of any membership status, because "why can this
 * person not see their zone" is the question the screen exists to answer.
 *
 * The owner is askable on its own beside it (plan 0012, section 3), for the
 * sake of its other answer: "none" is the zones nobody owns, which is what an
 * owner's deletion leaves behind and the one orphaned row these screens hold.
 *
 * **Two fields change and the other six do not** (plan 0009, section 3.1).
 * `name` and `config` are the whole of what a zone's own owner may change, and
 * an operator gets exactly the same two. The join code is regenerated rather
 * than typed, ownership is transferred rather than assigned, and the two
 * deletion columns are a pair written in one transaction. Each of the six says
 * so on the form rather than sitting there looking like a missing feature.
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

  fields: [
    {
      kind: 'text',
      name: 'id',
      label: 'people.zones.id',
      help: 'people.field.idHelp',
      editable: false,
    },
    {
      kind: 'text',
      name: 'name',
      label: 'people.zones.name',
      required: true,
      maxLength: 80,
    },
    {
      kind: 'json',
      name: 'config',
      label: 'people.zones.config',
      help: 'people.zones.configHelp',
    },
    {
      kind: 'text',
      name: 'ownerName',
      label: 'people.zones.owner',
      help: 'people.zones.ownerHelp',
      editable: false,
      // The rule from plan 0074, section 3, as one expression: a name the
      // gateway could not resolve is drawn as the id it could not resolve.
      read: (row) => row.ownerName ?? row.ownerUserId,
    },
    {
      kind: 'text',
      name: 'joinCode',
      label: 'people.zones.joinCode',
      help: 'people.zones.joinCodeHelp',
      editable: false,
    },
    {
      kind: 'enum',
      name: 'status',
      label: 'people.zones.status.label',
      options: ZONE_STATUS_OPTIONS,
      help: 'people.zones.statusHelp',
      editable: false,
    },
    {
      kind: 'date',
      name: 'markedForDeletionAt',
      label: 'people.zones.markedForDeletionAt',
      time: true,
      help: 'people.zones.markedForDeletionAtHelp',
      editable: false,
    },
    {
      kind: 'number',
      name: 'memberCount',
      label: 'people.zones.memberCount',
      help: 'people.zones.memberCountHelp',
      editable: false,
    },
    {
      kind: 'number',
      name: 'listCount',
      label: 'people.zones.listCount',
      help: 'people.zones.listCountHelp',
      editable: false,
    },
    {
      kind: 'number',
      name: 'pendingCount',
      label: 'people.zones.pendingCount',
      help: 'people.zones.pendingCountHelp',
      editable: false,
    },
    {
      kind: 'date',
      name: 'createdAt',
      label: 'people.zones.createdAt',
      help: 'people.field.createdAtHelp',
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
    // Beside the open zone: who owns it and how much is in it, as a sentence.
    brief: {
      sentence: (row) => {
        const owner = row.ownerName ?? row.ownerUserId;
        const counts = { members: row.memberCount, lists: row.listCount };
        return owner === null
          ? fieldMessage('people.zones.brief.noOwner', counts)
          : fieldMessage('people.zones.brief.owned', { owner, ...counts });
      },
    },
  },

  /**
   * What a row says beside the name: how many requests wait, on the waiting
   * wash, and that the zone is marked for deletion.
   */
  rowStates: () => (row) => [
    ...(row.pendingCount > 0
      ? [
          {
            label: 'people.zones.state.requests',
            args: { count: row.pendingCount },
            tone: 'waiting' as const,
          },
        ]
      : []),
    ...(row.status === 'MARKED_FOR_DELETION'
      ? [
          {
            label: 'people.zones.status.MARKED_FOR_DELETION',
            tone: 'neutral' as const,
          },
        ]
      : []),
  ],

  filters: [
    {
      // One answer and not three. "No" would have to mean the zones with no
      // request, and the gateway reads it as no filter at all.
      kind: 'enum',
      param: 'hasPending',
      label: 'people.zones.filter.hasPending',
      options: [{ value: 'true', label: 'people.zones.filter.waiting' }],
    },
    {
      kind: 'reference',
      param: 'userId',
      label: 'people.zones.filter.userId',
      resource: 'users',
    },
    {
      kind: 'reference',
      param: 'ownerUserId',
      label: 'people.zones.filter.ownerUserId',
      resource: 'users',
      // Null once the owner is deleted and until somebody claims the zone.
      nullable: true,
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

  caution: ZONE_CAUTION,

  actions: {
    edit: true,
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
          // The pair `status` and `markedForDeletionAt`, written together.
          // Typing either alone produces a zone the reaper either never removes
          // or removes anyway, and neither state has a repair, which is why
          // this is an act and not two fields (backend plan 0077, section 4.2).
          name: 'mark-for-deletion',
          label: 'people.zones.action.markForDeletion',
          available: (row) => row.status !== 'MARKED_FOR_DELETION',
          confirm: {
            heading: 'people.zones.confirm.markForDeletion.heading',
            body: 'people.zones.confirm.markForDeletion.body',
            confirm: 'people.zones.confirm.markForDeletion.confirm',
          },
          run: (row) => directory.setZoneDeletionMark(row.id, true),
        },
        {
          // Not confirmed, because it is the undo. Asking before taking back a
          // mistake is a click that teaches an operator to click through.
          name: 'restore-zone',
          label: 'people.zones.action.restore',
          available: (row) => row.status === 'MARKED_FOR_DELETION',
          run: (row) => directory.setZoneDeletionMark(row.id, false),
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
      // `hasPending` is not a column: it asks for the zones where a request
      // waits, which is what the gateway answers for it.
      memory: {
        matches: (row, param, value) =>
          param === 'hasPending'
            ? value !== 'true' || row.pendingCount > 0
            : undefined,
      },
    }),
});
