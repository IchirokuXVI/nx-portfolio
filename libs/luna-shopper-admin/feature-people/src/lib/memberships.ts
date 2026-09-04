import { inject } from '@angular/core';
import {
  ADMIN_ZONE_MEMBERS_PATH,
  DIRECTORY_SERVICE,
  MEMBERSHIP_KEY,
  RESOURCE_GATEWAYS,
  zoneMemberPath,
  zoneMembersPath,
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
 * - **A zone must be named before anything can be read.** `requires` says so,
 *   and the screen names the missing filter instead of asking for a URL with a
 *   hole in it.
 * - **Both URLs are nested.** There is no flat route for a membership, so the
 *   collection and the member are both under the zone, and the row is addressed
 *   by the pair `(zoneId, membershipId)`.
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
    columns: ['username', 'role', 'status', 'createdAt'],
    // The card is titled with the person's name in this zone, so the two lines
    // under it are what the screen is opened to check.
    compact: ['role', 'status'],
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

  requires: ['zoneId'],

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
      // Not a URL, and never used as one: both halves below build the real
      // path. It is the name this resource's in-memory table goes under.
      path: ADMIN_ZONE_MEMBERS_PATH,
      collectionPath: (values) => {
        const zoneId = values['zoneId'];
        return typeof zoneId === 'string' && zoneId !== ''
          ? zoneMembersPath(zoneId)
          : null;
      },
      memberPath: (id) => {
        const parts = compositeParts(id, MEMBERSHIP_KEY);
        return parts === null
          ? null
          : zoneMemberPath(parts['zoneId'], parts['membershipId']);
      },
      // In the path, and therefore not also in the query string or the body.
      // `PageQueryDto` does not declare it and neither does the update body, and
      // the validation pipe refuses a property no DTO declares.
      pathParams: ['zoneId'],
      key: [...MEMBERSHIP_KEY],
      idField: 'membershipId',
      seed: MEMBERSHIP_SEED,
    }),
});
