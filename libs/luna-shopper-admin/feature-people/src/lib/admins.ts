import {
  ADMIN_ADMINS_PATH,
  type ResourceSource,
} from '@portfolio/luna-shopper-admin/data-access';
import type {
  InfoContent,
  ResourcePage,
} from '@portfolio/luna-shopper-admin/models';
import { ADMIN_SEED, type AdminRow } from './people-seed';

/** Somebody who can open this back office. */
export type Admin = AdminRow;

/**
 * Who has access, and who tried to get it (admin plan 0046, targets 5 to 7;
 * plan 0007, section 2; backend plans 0071 and 0074).
 *
 * **An admin can be seen and cannot be created, edited or deleted from here,
 * ever.** That is not a gap to be filled in a later plan: there is no create,
 * update or delete route, and none may be added without changing plan 0071
 * first. Changing an admin means having the server. So the accounts are a
 * table whose rows do not open, and the info button names the command.
 *
 * The section is a page with two tabs, and not a descriptor: a list of rows
 * that never open, with a mark on the signed in admin, is not what the list
 * engine draws, and the second tab is no list of a resource at all.
 */

/** The segment the Admins section owns. */
export const ADMINS_SEGMENT = 'admins';

/** The two tabs of the section, as the segment each one owns. */
export const ADMIN_ACCOUNTS_TAB = 'accounts';
export const ADMIN_FAILED_SIGN_INS_TAB = 'failed-sign-ins';

/** One tab of the Admins section, as its segment. */
export type AdminsTab =
  | typeof ADMIN_ACCOUNTS_TAB
  | typeof ADMIN_FAILED_SIGN_INS_TAB;

/**
 * Where the Admins section is, or one of its tabs.
 *
 * The screens are hand written, so no descriptor names them and the resource
 * registry cannot answer for them. This function is that answer, and the
 * Overview's tile of failed sign ins reads it.
 */
export function adminsPath(tab?: AdminsTab): readonly string[] {
  return tab === undefined ? ['/', ADMINS_SEGMENT] : ['/', ADMINS_SEGMENT, tab];
}

/**
 * What the info button of Admins says (target 7).
 *
 * The command is the one that makes an account. It is text to copy and not a
 * sentence, so it is no translation key.
 */
export const ADMINS_INFO: InfoContent = {
  title: 'people.admins.many',
  points: ['people.admins.info.readOnly', 'people.admins.info.add'],
  command: 'npx nx run luna-shopper-backend-auth:admin:create',
};

/**
 * Where the accounts are read from.
 *
 * `GET /v1/admin/admins` is the one collection under `/v1/admin/**` that does
 * not answer `{ items, nextCursor }`: there are a handful of admins and paging
 * them would be a ceremony, so it answers `{ admins }`.
 *
 * Read through the resource gateways although no descriptor is left, so that
 * the screen has rows with no backend, like every other one.
 */
export const ADMINS_SOURCE: ResourceSource<Admin> = {
  path: ADMIN_ADMINS_PATH,
  idField: 'adminId',
  seed: ADMIN_SEED,
  page: toAdminPage,
};

/** `{ admins }` as a page, since this one route answers with no cursor. */
export function toAdminPage(body: unknown): ResourcePage<Admin> {
  const record =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const admins = record['admins'];

  return {
    items: Array.isArray(admins) ? (admins as Admin[]) : [],
    // There is no next page and there is no cursor to ask for one with.
    nextCursor: null,
  };
}
