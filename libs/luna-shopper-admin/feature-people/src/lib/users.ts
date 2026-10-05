import { inject } from '@angular/core';
import {
  ADMIN_USERS_PATH,
  DIRECTORY_SERVICE,
  RESOURCE_GATEWAYS,
} from '@portfolio/luna-shopper-admin/data-access';
import { ResourceChanges } from '@portfolio/luna-shopper-admin/feature-resource';
import { defineResource } from '@portfolio/luna-shopper-admin/models';
import { USER_SEED, type UserRow } from './people-seed';
import { PersonZonesTab } from './person-tabs';
import { PERSON_ZONES_TAB } from './shopper-params';
import { roleActions, rolesCell, USER_ROLE_OPTIONS } from './user-roles';

/** A person using velista, as the back office reads one. */
export type User = UserRow;

/** The two kinds of account, which is the whole of `UserKind`. */
const USER_KIND_OPTIONS = [
  { value: 'REGISTERED', label: 'people.users.kind.REGISTERED' },
  { value: 'TEMPORARY', label: 'people.users.kind.TEMPORARY' },
] as const;

/**
 * The people (plan 0007, section 2, widened by plan 0009, section 2).
 *
 * **A person is a record page** (admin plans 0045 and 0057): the People tab
 * of Shoppers lists them, and one of them opens beside the list with its
 * details, its zones and its shopping lists as tabs. The `record` block says
 * which tabs, and `shoppersRoutes` mounts the page.
 *
 * **A role is given and taken away in the More menu** (admin plan 0057): one
 * named action for each, with its own question. Nothing on the page that
 * reads writes, so a role is no switch.
 *
 * **Two editable fields and two named actions of its own.** `0007` made this screen read
 * only, on the grounds that the invariants around a user live in services
 * rather than in constraints. That is still true, and it is why exactly two of
 * the six fields can be changed: backend plan 0077 put a service behind each of
 * them and refused every other column outright.
 *
 * There is still **no create**, because an operator does not make accounts, and
 * **no delete**, because deleting one runs `account-deletion.service` across
 * three databases and stays the named action whose confirmation says whose
 * account it is and what goes with it.
 *
 * Three things about this screen are decisions rather than details.
 *
 * **`username` is not an identifier.** It is the global handle and it is not
 * unique, so rows are keyed and linked by `userId` and two identical usernames
 * are an ordinary result. A screen that treated the handle as the key would
 * merge two people.
 *
 * **Renaming somebody reaches every zone they are in.** `IdentityService`
 * publishes `user.usernameChanged` and core rewrites the per zone name of every
 * membership the person holds. The field says so, because an operator changing
 * a handle should know it is not a private label.
 *
 * **`displayName` stays off the listing.** It is whatever an identity provider
 * supplied, which for a Google sign in is somebody's real full name, so it is a
 * field on the form, which is the detail screen, and not a column in a table
 * anybody might screenshot.
 */
export const USERS = defineResource<User>({
  name: 'users',
  segment: 'people',
  labels: { one: 'people.users.one', many: 'people.users.many' },
  idField: 'userId',

  title: (row) => row.username,

  fields: [
    {
      kind: 'text',
      name: 'userId',
      label: 'people.users.userId',
      help: 'people.field.idHelp',
      editable: false,
    },
    {
      kind: 'text',
      name: 'username',
      label: 'people.users.username',
      help: 'people.users.usernameHelp',
      required: true,
      maxLength: 40,
    },
    {
      kind: 'text',
      name: 'displayName',
      label: 'people.users.displayName',
      help: 'people.users.displayNameHelp',
      nullable: true,
      maxLength: 200,
    },
    {
      kind: 'text',
      name: 'email',
      label: 'people.users.email',
      help: 'people.users.emailHelp',
      editable: false,
    },
    {
      kind: 'enum',
      name: 'kind',
      label: 'people.users.kind.label',
      options: USER_KIND_OPTIONS,
      help: 'people.users.kindHelp',
      editable: false,
    },
    {
      kind: 'date',
      name: 'emailVerifiedAt',
      label: 'people.users.emailVerifiedAt',
      time: true,
      help: 'people.users.emailVerifiedAtHelp',
      editable: false,
      // Amber, because it is the one state of an account that an operator
      // can do something about: "Resend confirmation" is in the More menu.
      check: (row) =>
        isUnconfirmed(row) ? { label: 'people.users.notConfirmed' } : null,
    },
    {
      kind: 'boolean',
      name: 'hasPassword',
      label: 'people.users.hasPassword',
      editable: false,
    },
    {
      kind: 'text',
      name: 'providers',
      label: 'people.users.providers',
      editable: false,
      read: (row) => row.providers.join(', '),
    },
    {
      kind: 'date',
      name: 'createdAt',
      label: 'people.users.createdAt',
      help: 'people.field.createdAtHelp',
      editable: false,
    },
    {
      kind: 'date',
      name: 'updatedAt',
      label: 'people.users.updatedAt',
      time: true,
      editable: false,
    },
    // Shown here and changed only in the More menu of the account's page, one
    // role at a time and each confirmed (admin plans 0038 and 0057). Never a
    // control on the form or a row.
    {
      kind: 'text',
      name: 'roles',
      label: 'people.users.roles.label',
      help: 'people.users.rolesHelp',
      editable: false,
      read: (row) => rolesCell(row.roles),
    },
  ],

  list: {
    columns: [
      'username',
      'email',
      'kind',
      'roles',
      'emailVerifiedAt',
      'createdAt',
    ],
    // The card already carries the handle as its title, so the two lines under
    // it are the ones that tell two accounts with the same handle apart: the
    // address, and whether this is a real account or a temporary one. The
    // roles are the third, because they are what this account may do.
    compact: ['email', 'kind', 'roles'],
    // Beside the open person the row is the handle and the address under it.
    brief: { line: ['email'] },
  },

  /**
   * What a row says beside the handle: a guest, and an address nobody has
   * confirmed. The second is on the waiting wash, because it is the one an
   * operator can do something about.
   */
  rowStates: () => (row) => [
    ...(row.kind === 'TEMPORARY'
      ? [{ label: 'people.users.state.guest', tone: 'neutral' as const }]
      : []),
    ...(isUnconfirmed(row)
      ? [{ label: 'people.users.state.unconfirmed', tone: 'waiting' as const }]
      : []),
  ],

  filters: [
    {
      kind: 'search',
      param: 'username',
      label: 'people.users.filter.username',
    },
    { kind: 'search', param: 'email', label: 'people.users.filter.email' },
    {
      kind: 'enum',
      param: 'kind',
      label: 'people.users.kind.label',
      options: USER_KIND_OPTIONS,
    },
    {
      kind: 'boolean',
      param: 'verified',
      label: 'people.users.filter.verified',
    },
    {
      kind: 'enum',
      param: 'role',
      label: 'people.users.filter.role',
      options: USER_ROLE_OPTIONS,
    },
    {
      kind: 'date',
      param: 'createdAfter',
      label: 'people.users.filter.createdAfter',
      edge: 'start',
    },
    {
      kind: 'date',
      param: 'createdBefore',
      label: 'people.users.filter.createdBefore',
      edge: 'end',
    },
  ],

  /**
   * The page of a person (admin plan 0057, section 2.2).
   *
   * It opens on Details. The two links open the zones narrowed to this
   * person, and neither has a count, because the view carries none.
   */
  record: {
    sections: [
      {
        title: 'people.users.section.account',
        fields: ['username', 'displayName', 'email', 'kind'],
      },
      {
        title: 'people.users.section.access',
        fields: ['roles', 'emailVerifiedAt', 'hasPassword', 'providers'],
      },
    ],
    children: [
      {
        as: 'tab',
        name: PERSON_ZONES_TAB,
        label: 'people.users.tabs.zones',
        component: PersonZonesTab,
      },
      {
        as: 'tab',
        resource: 'baskets',
        by: 'ownerUserId',
        label: 'people.users.tabs.baskets',
      },
      {
        as: 'link',
        resource: 'zones',
        by: 'ownerUserId',
        label: 'people.users.record.zonesOwned',
      },
      {
        as: 'link',
        resource: 'zones',
        by: 'userId',
        label: 'people.users.record.zonesJoined',
      },
    ],
    facts: {
      added: 'createdAt',
      changed: 'updatedAt',
      // "Signed up", which is what the date of an account is.
      labels: { added: 'people.users.createdAt' },
    },
  },

  // No `delete: true`. Deleting an account is a named action instead, so the
  // confirmation can say whose account it is and what goes with it rather than
  // asking the generic question every row in the app would ask (plan 0007,
  // section 5). No `create: true` either: an operator does not make accounts.
  actions: {
    edit: true,
    named: () => {
      const directory = inject(DIRECTORY_SERVICE);
      const changes = inject(ResourceChanges);

      return [
        {
          name: 'resend-verification',
          label: 'people.users.action.resendVerification',
          // Offered only where it can work. The gateway refuses an account with
          // no address and one that is already confirmed, and a button that is
          // always there and sometimes refuses teaches an operator to ignore
          // the refusal.
          available: isUnconfirmed,
          confirm: {
            heading: 'people.users.confirm.resendVerification.heading',
            body: 'people.users.confirm.resendVerification.body',
            confirm: 'people.users.confirm.resendVerification.confirm',
          },
          run: (row) => directory.resendVerification(row.userId),
        },
        ...roleActions(directory),
        {
          name: 'delete-account',
          label: 'people.users.action.deleteAccount',
          danger: true,
          after: 'leave',
          confirm: {
            heading: 'people.users.confirm.deleteAccount.heading',
            body: 'people.users.confirm.deleteAccount.body',
            confirm: 'people.users.confirm.deleteAccount.confirm',
          },
          run: async (row) => {
            await directory.deleteUser(row.userId);
            // Any zone the person owned is marked for deletion with them.
            changes.wrote('zones');
          },
        },
      ];
    },
  },

  gateway: () =>
    inject(RESOURCE_GATEWAYS).for<User>({
      path: ADMIN_USERS_PATH,
      idField: 'userId',
      seed: USER_SEED,
      // `role` is not a column: it asks for the accounts holding that role,
      // which is what the gateway answers for it.
      memory: {
        matches: (row, param, value) =>
          param === 'role'
            ? (row.roles as readonly string[]).includes(value)
            : undefined,
      },
    }),
});

/** Whether an account has an address that nobody confirmed. */
export function isUnconfirmed(row: User): boolean {
  return row.email !== null && row.emailVerifiedAt === null;
}
