import { inject } from '@angular/core';
import {
  ADMIN_MEMBERSHIPS_PATH,
  DIRECTORY_SERVICE,
  MEMBERSHIP_KEY,
  RESOURCE_GATEWAYS,
  zoneMemberPath,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  compositeIdOf,
  compositeParts,
  defineResource,
} from '@portfolio/luna-shopper-admin/models';
import { MEMBERSHIP_SEED, type MembershipRow } from './people-seed';

/** One person's place in one household, as the back office reads it. */
export type Membership = MembershipRow;

/**
 * The roles a membership can be given.
 *
 * **`OWNER` is absent, and that is the point.** `setRole` refuses it, because
 * ownership is a transfer and the transfer is two role changes and a column in
 * one transaction. A picker that offered it would be a control whose only
 * outcome is a refusal, and the operator would learn to ignore refusals.
 * Handing a zone over is the action on the zone's own screen.
 */
export const MEMBERSHIP_ROLE_OPTIONS = [
  { value: 'ADMIN', label: 'people.zones.role.ADMIN' },
  { value: 'MEMBER', label: 'people.zones.role.MEMBER' },
] as const;

/**
 * One membership at a time (plan 0009, section 3.2).
 *
 * The zone detail screen still draws the whole membership, because seeing it at
 * once is what a zone detail is for. This is the other question: change **this**
 * person's role, or the name they go by in this household.
 *
 * Three things about it are the gateway's shape rather than choices.
 *
 * - **The zone is a filter and not a question.** Opening this screen with none
 *   chosen lists every household's memberships, which is what somebody looking
 *   for one person's places needs: the zone is the thing they do not know yet
 *   (plan 0017).
 * - **The member URL is nested and the collection is not.** There is no flat
 *   route to one membership, so the row is addressed by the pair
 *   `(zoneId, membershipId)`, and the row carries its own `zoneId` so a page
 *   read across zones can still open one.
 * - **`status` is not a field.** It moves along a state machine with a service
 *   method per edge, and each edge does more than write the enum: approving
 *   emits `MemberApproved`, banning keeps the row so the ban survives, rejecting
 *   removes a pending one. A select that dispatched to four services by
 *   inspecting its value is a switch statement whose branches drift, so the four
 *   verbs are four actions (backend plan 0077, section 4.4).
 */
export const MEMBERSHIPS = defineResource<Membership>({
  name: 'memberships',
  segment: 'memberships',
  labels: { one: 'people.memberships.one', many: 'people.memberships.many' },
  idField: 'membershipId',

  // The pair, because a membership's own id addresses nothing on its own: every
  // route that reaches one names the zone first.
  rowId: (row) => compositeIdOf(row, MEMBERSHIP_KEY),

  title: (row) => row.username,

  fields: [
    {
      kind: 'text',
      name: 'membershipId',
      label: 'people.memberships.membershipId',
      help: 'people.field.idHelp',
      editable: false,
    },
    {
      kind: 'reference',
      name: 'zoneId',
      label: 'people.memberships.zoneId',
      resource: 'zones',
      editable: false,
      help: 'people.memberships.zoneIdHelp',
    },
    {
      // The household by name, because a reference column draws the uuid it
      // holds: resolving one per row per column is a request a list cannot
      // afford, so the server sends the name beside the id.
      kind: 'text',
      name: 'zoneName',
      label: 'people.memberships.zoneName',
      help: 'people.memberships.zoneNameHelp',
      editable: false,
    },
    {
      kind: 'reference',
      name: 'userId',
      label: 'people.memberships.userId',
      resource: 'users',
      editable: false,
      help: 'people.memberships.userIdHelp',
    },
    {
      kind: 'text',
      name: 'username',
      label: 'people.memberships.username',
      help: 'people.memberships.usernameHelp',
      required: true,
      maxLength: 40,
    },
    {
      kind: 'enum',
      name: 'role',
      label: 'people.memberships.role',
      options: MEMBERSHIP_ROLE_OPTIONS,
      help: 'people.memberships.roleHelp',
    },
    {
      kind: 'enum',
      name: 'status',
      label: 'people.memberships.status',
      // Every state, including the two no picker offers, because this field is
      // read rather than written and a listing has to be able to draw a banned
      // member as banned.
      options: [
        { value: 'PENDING', label: 'people.zones.membership.PENDING' },
        { value: 'APPROVED', label: 'people.zones.membership.APPROVED' },
        { value: 'KICKED', label: 'people.zones.membership.KICKED' },
        { value: 'BANNED', label: 'people.zones.membership.BANNED' },
      ],
      editable: false,
      help: 'people.memberships.statusHelp',
    },
    {
      kind: 'date',
      name: 'createdAt',
      label: 'people.memberships.createdAt',
      help: 'people.field.createdAtHelp',
      editable: false,
    },
  ],

  list: {
    columns: ['zoneName', 'username', 'role', 'status', 'createdAt'],
    // The card is titled with the person's name in this zone, so the two lines
    // under it are the household that tells two rows apart and what they are in
    // it. Across zones the first is the only thing that does.
    compact: ['zoneName', 'role'],
  },

  formNote: 'people.broadcast',

  filters: [
    {
      kind: 'reference',
      param: 'zoneId',
      label: 'people.memberships.filter.zoneId',
      resource: 'zones',
    },
  ],

  // No create: joining a zone is done with a join code by the person joining.
  // No delete: removing somebody is kick or ban, and the two are different
  // answers to "can they come back".
  actions: {
    edit: true,
    named: () => {
      const directory = inject(DIRECTORY_SERVICE);

      return [
        {
          name: 'approve-member',
          label: 'people.memberships.action.approve',
          available: (row) => row.status === 'PENDING',
          confirm: {
            heading: 'people.memberships.confirm.approve.heading',
            body: 'people.memberships.confirm.approve.body',
            confirm: 'people.memberships.confirm.approve.confirm',
          },
          run: (row) => directory.approveMember(row.zoneId, row.membershipId),
        },
        {
          name: 'reject-member',
          label: 'people.memberships.action.reject',
          available: (row) => row.status === 'PENDING',
          confirm: {
            heading: 'people.memberships.confirm.reject.heading',
            body: 'people.memberships.confirm.reject.body',
            confirm: 'people.memberships.confirm.reject.confirm',
          },
          run: (row) => directory.rejectMember(row.zoneId, row.membershipId),
        },
        {
          // Core refuses both against an owner, so neither is offered against
          // one. An owner leaves by handing the zone on first.
          name: 'kick-member',
          label: 'people.zones.action.kickMember',
          available: (row) => row.role !== 'OWNER' && row.status !== 'KICKED',
          confirm: {
            heading: 'people.memberships.confirm.kick.heading',
            body: 'people.memberships.confirm.kick.body',
            confirm: 'people.memberships.confirm.kick.confirm',
          },
          run: (row) => directory.kickMember(row.zoneId, row.membershipId),
        },
        {
          name: 'ban-member',
          label: 'people.zones.action.banMember',
          available: (row) => row.role !== 'OWNER' && row.status !== 'BANNED',
          confirm: {
            heading: 'people.memberships.confirm.ban.heading',
            body: 'people.memberships.confirm.ban.body',
            confirm: 'people.memberships.confirm.ban.confirm',
          },
          run: (row) => directory.banMember(row.zoneId, row.membershipId),
        },
      ];
    },
  },

  gateway: () =>
    inject(RESOURCE_GATEWAYS).for<Membership>({
      // A plain path with a plain query parameter, so `zoneId` needs no
      // `pathParams`: it goes on the query string like any other filter, and
      // the rows come back carrying it (plan 0017, section 4).
      path: ADMIN_MEMBERSHIPS_PATH,
      // One membership is still under its zone. There is no flat route to one,
      // so the address stays the pair.
      memberPath: (id) => {
        const parts = compositeParts(id, MEMBERSHIP_KEY);
        return parts === null
          ? null
          : zoneMemberPath(parts['zoneId'], parts['membershipId']);
      },
      key: [...MEMBERSHIP_KEY],
      idField: 'membershipId',
      seed: MEMBERSHIP_SEED,
    }),
});
