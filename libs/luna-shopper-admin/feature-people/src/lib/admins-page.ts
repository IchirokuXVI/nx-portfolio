import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { DashboardStore } from '@portfolio/luna-shopper-admin/data-access';
import { PageHeader, type PageTab } from '@portfolio/luna-shopper-admin/ui';
import {
  ADMIN_ACCOUNTS_TAB,
  ADMIN_FAILED_SIGN_INS_TAB,
  ADMINS_INFO,
  adminsPath,
} from './admins';

/**
 * The Admins section (admin plan 0046, target 6): one header, two tabs, and
 * under them the tab that is open.
 *
 * "Accounts" is who can open this back office. "Failed sign ins" is who tried
 * and was refused. The second was a block of the Overview, and it is here so
 * that the Overview holds what waits and the numbers, and so that the table is
 * one press from the accounts it is about.
 *
 * **The counts on the tabs come with the dashboard read**, which the rail
 * already keeps current: how many accounts there are, and how many sign ins
 * failed in the last 24 hours. Neither is counted in the browser from a list.
 * A count of zero, and a count that is not known, draw nothing.
 *
 * The tabs are the page's own. The count of failed sign ins is not work that
 * waits for a decision, so it is not handed to the frame, which would add it
 * to the rail as such.
 */
@Component({
  selector: 'lib-admins-page',
  imports: [PageHeader, RouterOutlet, RokuTranslatorPipe],
  template: `
    <lib-page-header
      [heading]="'shell.sections.admins' | rokuT"
      [info]="info"
      [tabs]="tabs"
      [tabsLabel]="'shell.sections.admins' | rokuT"
    />
    <router-outlet />
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-4);
      min-inline-size: 0;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminsPage {
  private readonly _store = inject(DashboardStore);

  readonly info = ADMINS_INFO;

  readonly tabs: readonly PageTab[] = [
    {
      path: adminsPath(ADMIN_ACCOUNTS_TAB),
      label: 'people.admins.tabs.accounts',
      count: () => this._store.document()?.identity?.admins.total ?? null,
    },
    {
      path: adminsPath(ADMIN_FAILED_SIGN_INS_TAB),
      label: 'people.admins.tabs.failed',
      count: () =>
        this._store.document()?.identity?.loginFailures.last24h ?? null,
      countLabel: 'people.admins.tabs.failedCount',
      waiting: true,
    },
  ];

  constructor() {
    this._store.watch();
    // A component's teardown, which is the one that runs: the store counts
    // its watchers, so leaving this page does not stop the reads of the rail.
    inject(DestroyRef).onDestroy(() => this._store.stop());
  }
}
