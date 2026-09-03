import { inject } from '@angular/core';
import {
  ADMIN_USERS_PATH,
  DIRECTORY_SERVICE,
  RESOURCE_GATEWAYS,
} from '@portfolio/luna-shopper-admin/data-access';
import { defineResource } from '@portfolio/luna-shopper-admin/models';
import { USER_SEED, type UserRow } from './people-seed';
import { UserDetailPage } from './user-detail-page';

/** A person using velista, as the back office reads one. */
export type User = UserRow;

/** The two kinds of account, which is the whole of `UserKind`. */
export const USER_KIND_OPTIONS = [
  { value: 'REGISTERED', label: 'people.users.kind.REGISTERED' },
  { value: 'TEMPORARY', label: 'people.users.kind.TEMPORARY' },
] as const;

/**
 * The people (plan 0007, section 2).
 *
 * **Read, and two named actions.** There is no edit and there never will be:
 * deleting an account runs `account-deletion.service` across three databases,
 * and the invariants around a user live in services rather than in constraints,
 * so a generic row editor over `users` offers a way to corrupt state that no
 * code path can repair. Both actions call the service the user's own routes
 * call.
 *
 * Two things about this screen are decisions rather than details.
 *
 * **`username` is not an identifier.** It is the global handle and it is not
 * unique, so rows are keyed and linked by `userId` and two identical usernames
 * are an ordinary result. A screen that treated the handle as the key would
 * merge two people.
 *
 * **`displayName` is not a column.** It is whatever an identity provider
 * supplied, which for a Google sign in is somebody's real full name, so it is
 * in the detail view where an operator has a reason to look and not in a list
 * anybody might screenshot. It is deliberately not among the fields below, so
 * it cannot be added to `columns` by accident.
 */
export const USERS = defineResource<User>({
  name: 'users',
  segment: 'users',
  labels: { one: 'people.users.one', many: 'people.users.many' },
  idField: 'userId',

  title: (row) => row.username,

  detail: UserDetailPage,

  fields: [
    {
      kind: 'text',
      name: 'userId',
      label: 'people.users.userId',
      editable: false,
    },
    {
      kind: 'text',
      name: 'username',
      label: 'people.users.username',
      editable: false,
    },
    {
      kind: 'text',
      name: 'email',
      label: 'people.users.email',
      editable: false,
    },
    {
      kind: 'enum',
      name: 'kind',
      label: 'people.users.kind.label',
      options: USER_KIND_OPTIONS,
      editable: false,
    },
    {
      kind: 'date',
      name: 'emailVerifiedAt',
      label: 'people.users.emailVerifiedAt',
      time: true,
      editable: false,
    },
    {
      kind: 'date',
      name: 'createdAt',
      label: 'people.users.createdAt',
      editable: false,
    },
  ],

  list: {
    columns: ['username', 'email', 'kind', 'emailVerifiedAt', 'createdAt'],
    // The card already carries the handle as its title, so the two lines under
    // it are the ones that tell two accounts with the same handle apart: the
    // address, and whether this is a real account or a temporary one.
    compact: ['email', 'kind'],
  },

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

  // No `delete: true`. Deleting an account is a named action instead, so the
  // confirmation can say whose account it is and what goes with it rather than
  // asking the generic question every row in the app would ask (plan 0007,
  // section 5).
  actions: {
    named: () => {
      const directory = inject(DIRECTORY_SERVICE);

      return [
        {
          name: 'resend-verification',
          label: 'people.users.action.resendVerification',
          // Offered only where it can work. The gateway refuses an account with
          // no address and one that is already confirmed, and a button that is
          // always there and sometimes refuses teaches an operator to ignore
          // the refusal.
          available: (row) =>
            row.email !== null && row.emailVerifiedAt === null,
          confirm: {
            heading: 'people.users.confirm.resendVerification.heading',
            body: 'people.users.confirm.resendVerification.body',
            confirm: 'people.users.confirm.resendVerification.confirm',
          },
          run: (row) => directory.resendVerification(row.userId),
        },
        {
          name: 'delete-account',
          label: 'people.users.action.deleteAccount',
          confirm: {
            heading: 'people.users.confirm.deleteAccount.heading',
            body: 'people.users.confirm.deleteAccount.body',
            confirm: 'people.users.confirm.deleteAccount.confirm',
          },
          run: (row) => directory.deleteUser(row.userId),
        },
      ];
    },
  },

  gateway: () =>
    inject(RESOURCE_GATEWAYS).for<User>({
      path: ADMIN_USERS_PATH,
      idField: 'userId',
      seed: USER_SEED,
    }),
});
