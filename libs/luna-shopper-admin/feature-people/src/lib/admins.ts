import { inject } from '@angular/core';
import {
  ADMIN_ADMINS_PATH,
  RESOURCE_GATEWAYS,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  defineResource,
  type ResourcePage,
} from '@portfolio/luna-shopper-admin/models';
import { ADMIN_SEED, type AdminRow } from './people-seed';

/** Somebody who can open this back office. */
export type Admin = AdminRow;

/**
 * Who has access (plan 0007, section 2; backend plans 0071 and 0074).
 *
 * **An admin can be seen and cannot be created, edited or deleted from here,
 * ever.** That is not a gap to be filled in a later plan: there is no create,
 * update or delete route, and none may be added without changing plan 0071
 * first. Changing an admin means having the server.
 *
 * So this descriptor names no actions and no detail screen, `resourceRoutes`
 * therefore declares neither a create nor an `:id` route, and the list draws its
 * rows as text rather than as controls that lead nowhere. The note above the
 * table names the command, so an operator hunting for the missing button finds
 * the answer rather than an empty toolbar.
 *
 * `GET /v1/admin/admins` is the one collection under `/v1/admin/**` that does
 * not answer `{ items, nextCursor }`: there are a handful of admins and paging
 * them would be a ceremony, so it answers `{ admins }` and the gateway source
 * says how to read it.
 */
export const ADMINS = defineResource<Admin>({
  name: 'admins',
  segment: 'admins',
  labels: { one: 'people.admins.one', many: 'people.admins.many' },
  idField: 'adminId',
  note: 'people.admins.note',

  title: (row) => row.username,

  fields: [
    {
      kind: 'text',
      name: 'username',
      label: 'people.admins.username',
      editable: false,
    },
    {
      kind: 'text',
      name: 'displayName',
      label: 'people.admins.displayName',
      editable: false,
    },
    {
      kind: 'date',
      name: 'disabledAt',
      label: 'people.admins.disabledAt',
      time: true,
      editable: false,
    },
    {
      kind: 'date',
      name: 'lastLoginAt',
      label: 'people.admins.lastLoginAt',
      time: true,
      editable: false,
    },
  ],

  list: {
    columns: ['username', 'displayName', 'disabledAt', 'lastLoginAt'],
    // Whether somebody still signs in, and when they last did. Whether they are
    // disabled is the answer to "should this person still have access", which
    // is the only reason to open this screen on a phone.
    compact: ['disabledAt', 'lastLoginAt'],
  },

  // No filters and no order. There are a handful of rows and the route takes
  // neither.

  gateway: () =>
    inject(RESOURCE_GATEWAYS).for<Admin>({
      path: ADMIN_ADMINS_PATH,
      idField: 'adminId',
      seed: ADMIN_SEED,
      page: toAdminPage,
    }),
});

/** `{ admins }` as a page, since this one route answers with no cursor. */
export function toAdminPage(body: unknown): ResourcePage<Admin> {
  const record =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const admins = record['admins'];

  return {
    items: Array.isArray(admins) ? (admins as Admin[]) : [],
    // There is no next page and there is no cursor to ask for one with. Saying
    // so explicitly is what stops the list offering a "load more" that would
    // fetch the same handful of rows again.
    nextCursor: null,
  };
}
