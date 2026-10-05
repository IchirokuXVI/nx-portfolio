import { provideLocationMocks } from '@angular/common/testing';
import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  DASHBOARD_SEED,
  DASHBOARD_SERVICE,
  dashboardSeedWithout,
  DashboardStore,
  RESOURCE_GATEWAYS,
  SessionStore,
  type DashboardDocument,
} from '@portfolio/luna-shopper-admin/data-access';
import { Viewport } from '@portfolio/luna-shopper-admin/ui';
import { accountRows } from './admin-accounts-tab';
import { failedSignInRows } from './admin-sign-ins-tab';
import {
  ADMIN_ACCOUNTS_TAB,
  ADMIN_FAILED_SIGN_INS_TAB,
  ADMINS_INFO,
  ADMINS_SEGMENT,
  adminsPath,
  toAdminPage,
} from './admins';
import { adminsRoutes } from './admins-routes';
import { ADMIN_SEED } from './people-seed';

const [ICHIROKU, RETIRED] = ADMIN_SEED;

@Component({
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
class Host {}

interface Options {
  readonly document?: DashboardDocument;
  readonly compact?: boolean;
  /** The id of the admin who is signed in. */
  readonly signedIn?: string | null;
  /** A read of the accounts that fails, for the one spec about that. */
  readonly accountsFail?: boolean;
  /** The dashboard read itself, for the one spec that counts its calls. */
  readonly read?: () => Promise<DashboardDocument>;
}

/** Let the reads settle, then redraw. `whenStable` hangs on a polling store. */
async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}

/** Mount the section where the app mounts it, and go to an address in it. */
async function boot(
  url: string,
  options: Options = {}
): Promise<ComponentFixture<Host>> {
  const signedIn =
    options.signedIn === undefined ? ICHIROKU.adminId : options.signedIn;

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [Host, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([{ path: ADMINS_SEGMENT, children: adminsRoutes() }]),
      provideLocationMocks(),
      {
        provide: DASHBOARD_SERVICE,
        useValue: {
          read:
            options.read ?? (async () => options.document ?? DASHBOARD_SEED),
        },
      },
      // The one thing the accounts read from the session: whose it is.
      {
        provide: SessionStore,
        useValue: {
          identity: signal(signedIn === null ? null : { adminId: signedIn }),
        },
      },
      // jsdom matches no media query, so a phone is said and not measured.
      {
        provide: Viewport,
        useValue: {
          compact: signal(options.compact === true),
          split: signal(false),
        },
      },
      ...(options.accountsFail === true
        ? [
            {
              provide: RESOURCE_GATEWAYS,
              useValue: {
                for: () => ({
                  list: async () => {
                    throw new Error('nothing answered');
                  },
                }),
              },
            },
          ]
        : []),
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  await TestBed.inject(Router).navigateByUrl(url);
  await settle(fixture);
  await settle(fixture);

  return fixture;
}

const find = <T extends HTMLElement = HTMLElement>(
  fixture: ComponentFixture<unknown>,
  selector: string
): T | null =>
  (fixture.nativeElement as HTMLElement).querySelector<T>(selector);

const findAll = (
  fixture: ComponentFixture<unknown>,
  selector: string
): HTMLElement[] => [
  ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
    selector
  ),
];

const textOf = (node: Element | null): string =>
  (node?.textContent ?? '').replace(/\s+/g, ' ').trim();

afterEach(() => {
  // The page watches the dashboard, and a watch left running is a timer left
  // running. Dropping the module drops the page, which stops it.
  TestBed.inject(DashboardStore).stop();
  TestBed.resetTestingModule();
});

/**
 * The Admins section (admin plan 0046, targets 5 to 7): a page with two tabs.
 *
 * Everything here runs against the in-memory gateway and the seeded dashboard.
 * Assertions are on keys wherever a string is interpolated: the testing
 * translator does not interpolate.
 */
describe('the Admins section', () => {
  it('opens on the accounts', async () => {
    await boot('/admins');

    expect(TestBed.inject(Router).url).toBe('/admins/accounts');
  });

  it('has the one header and two tabs, Accounts and Failed sign ins', async () => {
    const fixture = await boot('/admins');
    const tabs = findAll(fixture, 'lib-page-header lib-page-tabs a');

    expect(findAll(fixture, 'h1').map(textOf)).toEqual([
      'shell.sections.admins',
    ]);
    expect(tabs.map((tab) => tab.getAttribute('href'))).toEqual([
      '/admins/accounts',
      '/admins/failed-sign-ins',
    ]);
    expect(textOf(tabs[0])).toContain('people.admins.tabs.accounts');
    expect(textOf(tabs[1])).toContain('people.admins.tabs.failed');
    expect(tabs[0].getAttribute('aria-current')).toBe('page');
  });

  /**
   * The counts come with the dashboard read: how many accounts there are, and
   * how many sign ins failed in the last 24 hours. The second is said in
   * words, because a bare number there would be read as work that waits.
   */
  it('puts the count of accounts and the failures of the day on the tabs', async () => {
    const fixture = await boot('/admins');
    const [accounts, failed] = findAll(
      fixture,
      'lib-page-header lib-page-tabs a'
    );

    expect(textOf(accounts.querySelector('.count'))).toBe('4');
    expect(accounts.querySelector('.count.waiting')).toBeNull();
    expect(textOf(failed.querySelector('.count.waiting'))).toBe(
      'people.admins.tabs.failedCount'
    );
    // Not announced as waiting for a decision: the words are the name.
    expect(failed.querySelector('.count')?.getAttribute('aria-label')).toBe(
      null
    );
  });

  it('puts no count on the failed sign ins when there are none', async () => {
    const identity = DASHBOARD_SEED.identity;
    const fixture = await boot('/admins', {
      document: {
        ...DASHBOARD_SEED,
        identity:
          identity === null
            ? null
            : {
                ...identity,
                loginFailures: { last24h: 0, last7d: 0, recent: [] },
              },
      },
    });
    const [, failed] = findAll(fixture, 'lib-page-header lib-page-tabs a');

    expect(failed.querySelector('.count')).toBeNull();
  });

  describe('the info button', () => {
    /** Target 7: two sentences, then the command with a way to copy it. */
    it('says that the list is read only, and names the command', async () => {
      const fixture = await boot('/admins');

      expect(textOf(fixture.nativeElement)).not.toContain(
        'people.admins.info.add'
      );

      find<HTMLButtonElement>(fixture, 'lib-info-button button')?.click();
      fixture.detectChanges();

      const panel = find(fixture, 'lib-info-panel [role="dialog"]');
      expect(findAll(fixture, 'lib-info-panel li').map(textOf)).toEqual([
        'people.admins.info.readOnly',
        'people.admins.info.add',
      ]);
      expect(textOf(panel?.querySelector('.command code') ?? null)).toBe(
        'npx nx run luna-shopper-backend-auth:admin:create'
      );
      expect(textOf(panel?.querySelector('.command button') ?? null)).toBe(
        'info.copy'
      );
    });

    it('copies the command, and says that it did', async () => {
      const writeText = jest.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
      });
      const fixture = await boot('/admins');

      find<HTMLButtonElement>(fixture, 'lib-info-button button')?.click();
      fixture.detectChanges();
      find<HTMLButtonElement>(
        fixture,
        'lib-info-panel .command button'
      )?.click();
      await settle(fixture);

      expect(writeText).toHaveBeenCalledWith(ADMINS_INFO.command);
      expect(textOf(find(fixture, 'lib-info-panel .command button'))).toBe(
        'info.copied'
      );
    });

    /** A command is typed and not translated, so it is no key. */
    it('holds the command as text', () => {
      expect(ADMINS_INFO).toEqual({
        title: 'people.admins.many',
        points: ['people.admins.info.readOnly', 'people.admins.info.add'],
        command: 'npx nx run luna-shopper-backend-auth:admin:create',
      });
    });
  });
});

describe('the Accounts tab', () => {
  /** Target 6: name, sign in name, state and last sign in. */
  it('lists every account with its four columns', async () => {
    const fixture = await boot('/admins/accounts');

    expect(findAll(fixture, 'thead th').map(textOf)).toEqual([
      'people.admins.name',
      'people.admins.username',
      'people.admins.state.label',
      'people.admins.lastLoginAt',
    ]);
    expect(findAll(fixture, 'tr[data-account]')).toHaveLength(
      ADMIN_SEED.length
    );
    expect(findAll(fixture, 'tr[data-account] td.mono').map(textOf)).toEqual([
      ICHIROKU.username,
      RETIRED.username,
    ]);
  });

  it('marks the signed in admin, and nobody else', async () => {
    const fixture = await boot('/admins/accounts');
    const [first, second] = findAll(fixture, 'tr[data-account]');

    expect(textOf(first.querySelector('.you'))).toBe('people.admins.you');
    expect(second.querySelector('.you')).toBeNull();
  });

  it('says Active or Turned off', async () => {
    const fixture = await boot('/admins/accounts');

    expect(findAll(fixture, 'tr[data-account] .chip').map(textOf)).toEqual([
      'people.admins.state.active',
      'people.admins.state.off',
    ]);
    expect(
      findAll(fixture, 'tr[data-account] .chip').map((chip) =>
        chip.classList.contains('good')
      )
    ).toEqual([true, false]);
  });

  /**
   * Plan 0071, section 6: an admin can be seen and cannot be created, edited
   * or deleted from here, ever. So a row is text, and the tab has no control.
   */
  it('has no row that opens and no control that writes', async () => {
    const fixture = await boot('/admins/accounts');

    expect(findAll(fixture, 'lib-admin-accounts-tab a')).toEqual([]);
    expect(findAll(fixture, 'lib-admin-accounts-tab button')).toEqual([]);
  });

  it('has no page for one admin', async () => {
    await boot(`/admins/accounts`);

    await expect(
      TestBed.inject(Router).navigateByUrl(`/admins/${ICHIROKU.adminId}`)
    ).rejects.toThrow();
  });

  it('draws rows and not a table on a phone', async () => {
    const fixture = await boot('/admins/accounts', { compact: true });

    expect(find(fixture, 'table')).toBeNull();
    expect(findAll(fixture, 'li[data-account]')).toHaveLength(
      ADMIN_SEED.length
    );
    expect(textOf(find(fixture, 'li[data-account] .you'))).toBe(
      'people.admins.you'
    );
  });

  it('says so when the accounts could not be read, and offers to ask again', async () => {
    const fixture = await boot('/admins/accounts', { accountsFail: true });

    expect(find(fixture, '.state.error')?.getAttribute('role')).toBe('alert');
    expect(textOf(find(fixture, '.state.error button'))).toBe(
      'people.admins.accounts.retry'
    );
    expect(findAll(fixture, '[data-account]')).toEqual([]);
  });

  describe('accountRows', () => {
    it('names an account by its display name, or by its sign in name', () => {
      const rows = accountRows(ADMIN_SEED, null, 'en');

      expect(rows.map((row) => row.name)).toEqual(['Ichiroku', 'retired']);
    });

    /** By the id of the account: two accounts may carry one display name. */
    it('tells the signed in admin by id', () => {
      const twins = [
        { ...ICHIROKU, adminId: 'a', displayName: 'Same' },
        { ...ICHIROKU, adminId: 'b', displayName: 'Same' },
      ];

      expect(accountRows(twins, 'b', 'en').map((row) => row.you)).toEqual([
        false,
        true,
      ]);
      expect(accountRows(twins, null, 'en').map((row) => row.you)).toEqual([
        false,
        false,
      ]);
    });

    it('reads an account that was turned off, and one that never signed in', () => {
      const [row] = accountRows(
        [{ ...RETIRED, lastLoginAt: null }],
        null,
        'en'
      );

      expect(row.active).toBe(false);
      // Empty, and the screen writes "Never" there.
      expect(row.lastSignIn).toBe('');
    });
  });

  describe('toAdminPage', () => {
    /** The one collection under `/v1/admin/**` that answers `{ admins }`. */
    it('reads a page out of the shape that route really answers with', () => {
      const page = toAdminPage({ admins: ADMIN_SEED });

      expect(page.items).toHaveLength(ADMIN_SEED.length);
      expect(page.nextCursor).toBeNull();
    });

    it('answers an empty page for a body it cannot read', () => {
      expect(toAdminPage(null)).toEqual({ items: [], nextCursor: null });
      expect(toAdminPage({ items: ADMIN_SEED })).toEqual({
        items: [],
        nextCursor: null,
      });
    });
  });
});

describe('the Failed sign ins tab', () => {
  const url = '/admins/failed-sign-ins';

  /** Target 6: the two counts, and the table (when, sign in name, from). */
  it('shows the two counts and the table', async () => {
    const fixture = await boot(url);

    expect(textOf(find(fixture, '[data-count="last24h"]'))).toBe('2');
    expect(textOf(find(fixture, '[data-count="last7d"]'))).toBe('5');
    expect(findAll(fixture, 'thead th').map(textOf)).toEqual([
      'people.admins.failed.when',
      'people.admins.username',
      'people.admins.failed.ip',
    ]);
    expect(findAll(fixture, 'tr[data-failure]')).toHaveLength(5);
  });

  /** A proxy that did not pass the address through is a real row. */
  it('says "not recorded" for an attempt with no address', async () => {
    const fixture = await boot(url);
    const from = findAll(fixture, 'tr[data-failure] td:last-child').map(textOf);

    expect(from[0]).toBe('203.0.113.44');
    expect(from[2]).toBe('people.admins.failed.noIp');
  });

  it('marks the count of the day only when a sign in failed', async () => {
    const fixture = await boot(url);

    expect(
      find(fixture, '[data-count="last24h"]')?.parentElement?.classList
    ).toContain('waiting');
    expect(
      find(fixture, '[data-count="last7d"]')?.parentElement?.classList
    ).not.toContain('waiting');
  });

  it('says that nothing was recorded when the list is empty', async () => {
    const identity = DASHBOARD_SEED.identity;
    const fixture = await boot(url, {
      document: {
        ...DASHBOARD_SEED,
        identity:
          identity === null
            ? null
            : {
                ...identity,
                loginFailures: { last24h: 0, last7d: 0, recent: [] },
              },
      },
    });

    expect(textOf(find(fixture, '.state'))).toBe('people.admins.failed.none');
    expect(find(fixture, 'table')).toBeNull();
    expect(
      find(fixture, '[data-count="last24h"]')?.parentElement?.classList
    ).not.toContain('waiting');
  });

  it('draws rows and not a table on a phone', async () => {
    const fixture = await boot(url, { compact: true });

    expect(find(fixture, 'table')).toBeNull();
    expect(findAll(fixture, 'li[data-failure]')).toHaveLength(5);
  });

  /** One read feeds the tile of the Overview, the count on the tab and this table. */
  it('reads nothing by itself: the dashboard is read once', async () => {
    const read = jest.fn(async () => DASHBOARD_SEED);
    const fixture = await boot(url, { read });

    // The watch of the page asked once, and the tab under it asked for nothing.
    expect(read).toHaveBeenCalledTimes(1);
    expect(findAll(fixture, 'tr[data-failure]')).toHaveLength(5);
  });

  /** When auth did not answer, the tab says so and offers to ask again. */
  it('says that auth did not answer, with a way to ask again', async () => {
    const fixture = await boot(url, {
      document: dashboardSeedWithout('identity'),
    });
    const load = jest.spyOn(TestBed.inject(DashboardStore), 'load');

    expect(textOf(find(fixture, 'lib-block-notice h3'))).toBe(
      'dashboard.down.identity'
    );
    expect(find(fixture, '[data-count]')).toBeNull();

    find<HTMLButtonElement>(fixture, 'lib-block-notice button')?.click();

    expect(load).toHaveBeenCalledTimes(1);
  });

  describe('failedSignInRows', () => {
    it('keeps the order the gateway sent, newest first', () => {
      const identity = DASHBOARD_SEED.identity;
      if (identity === null) {
        throw new Error('the seed has an identity block');
      }
      const rows = failedSignInRows(identity, 'en');

      expect(rows.map((row) => row.username)).toEqual([
        'admin',
        'admin',
        'root',
        'ichiroku',
        'admin',
      ]);
      expect(rows[2].ip).toBeNull();
      expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
    });
  });
});

describe('adminsPath', () => {
  it('is the section, or one of its two tabs', () => {
    expect(adminsPath()).toEqual(['/', 'admins']);
    expect(adminsPath(ADMIN_ACCOUNTS_TAB)).toEqual(['/', 'admins', 'accounts']);
    expect(adminsPath(ADMIN_FAILED_SIGN_INS_TAB)).toEqual([
      '/',
      'admins',
      'failed-sign-ins',
    ]);
  });
});
