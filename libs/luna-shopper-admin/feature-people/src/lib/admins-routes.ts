import type { Route } from '@angular/router';
import { AdminAccountsTab } from './admin-accounts-tab';
import { AdminSignInsTab } from './admin-sign-ins-tab';
import { ADMIN_ACCOUNTS_TAB, ADMIN_FAILED_SIGN_INS_TAB } from './admins';
import { AdminsPage } from './admins-page';

/**
 * The routes of the Admins section, under its segment.
 *
 * One page that holds the header and the two tabs, and each tab as a child.
 * The section's own address goes to Accounts. The section says so with its
 * `landing`, which is what points its entry in the rail at the segment, and
 * the redirect is here: a route with children matches a URL it has fully
 * consumed, so this page answers the section's own address by itself and the
 * redirect has to be one of its children.
 */
export function adminsRoutes(): Route[] {
  return [
    {
      path: '',
      component: AdminsPage,
      children: [
        { path: '', pathMatch: 'full', redirectTo: ADMIN_ACCOUNTS_TAB },
        { path: ADMIN_ACCOUNTS_TAB, component: AdminAccountsTab },
        { path: ADMIN_FAILED_SIGN_INS_TAB, component: AdminSignInsTab },
      ],
    },
  ];
}
