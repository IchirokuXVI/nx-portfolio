import { provideHttpClient } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  ACCOUNT_SERVICE,
  ApiUrl,
  fakeShoppingProfileStore,
  Mutations,
  ProfileStore,
  provideFakeShoppingProfileStore,
  REALTIME_CLIENT,
  RealtimeMemory,
  SessionStore,
  TokenStore,
  type AccountServiceI,
} from '@portfolio/velista/data-access';
import type { AppStateFlags, UserProfile } from '@portfolio/velista/models';
import { provideVelistaTesting, TourStore } from '@portfolio/velista/platform';
import { DonePage } from './done-page/done-page';
import { SetupLayout } from './setup-layout';
import { WelcomePage } from './welcome-page/welcome-page';

/**
 * Velista `0098`, section 7: every exit marks the setup over, exactly once.
 *
 * Driven through the router with the real `ProfileStore` and the real `SetupFlow`,
 * because "exactly once" is a property of the two together: a button marks it, then
 * the layout is torn down on the way out and marks it again, and only the store's own
 * rule keeps that to one request.
 */

@Component({ template: '' })
class Blank {}

const ROUTES: Routes = [
  {
    path: 'en',
    children: [
      {
        path: 'setup',
        component: SetupLayout,
        children: [
          { path: '', pathMatch: 'full', component: WelcomePage },
          { path: 'done', component: DonePage },
        ],
      },
      { path: '**', component: Blank },
    ],
  },
];

const FRESH_PROFILE: UserProfile = {
  userId: 'u1',
  kind: 'REGISTERED',
  username: 'Brave Anchor',
  email: 'brave@example.com',
  emailVerified: true,
  displayName: null,
  appState: { setupCompletedAt: null, tourSeenAt: null },
};

/** The account half the setup talks to, counting the stamps it is sent. */
function fakeAccount() {
  const stamps: AppStateFlags[] = [];

  const service: AccountServiceI = {
    getProfile: async () => FRESH_PROFILE,
    setUsername: async () => FRESH_PROFILE,
    deleteAccount: async () => ({ deleted: true }),
    setAppState: async (flags) => {
      stamps.push(flags);
      return { setupCompletedAt: '2026-09-23T10:00:00.000Z', tourSeenAt: null };
    },
    suggestUsername: async () => 'Quiet Harbour',
  };

  return { service, stamps };
}

async function arrive(url: string) {
  TestBed.resetTestingModule();

  const account = fakeAccount();

  TestBed.configureTestingModule({
    imports: [RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting(),
      provideHttpClient(),
      provideRouter(ROUTES),
      ApiUrl,
      Mutations,
      TokenStore,
      ProfileStore,
      SessionStore,
      { provide: ACCOUNT_SERVICE, useValue: account.service },
      { provide: REALTIME_CLIENT, useExisting: RealtimeMemory },
      provideFakeShoppingProfileStore(fakeShoppingProfileStore()),
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  });

  const profile = TestBed.inject(ProfileStore);
  await profile.load();

  const harness = await RouterTestingHarness.create(url);

  return { harness, profile, stamps: account.stamps };
}

/** Let the fire and forget stamp reach the fake. */
async function settle(harness: RouterTestingHarness): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  harness.detectChanges();
}

function press(harness: RouterTestingHarness, selector: string): void {
  const button = (
    harness.routeNativeElement as HTMLElement | null
  )?.ownerDocument.querySelector<HTMLButtonElement>(selector);
  if (button === null || button === undefined) {
    throw new Error(`nothing matches ${selector}`);
  }
  button.click();
}

describe('leaving the setup', () => {
  it('Not now marks it over once, and goes home', async () => {
    const { harness, profile, stamps } = await arrive('/en/setup');

    press(harness, '.later');
    await settle(harness);

    expect(stamps).toEqual([{ setupCompleted: true }]);
    expect(profile.setupPending()).toBe(false);
    expect(TestBed.inject(Router).url).toBe('/en/home');
  });

  it('No, thank you marks it over once, and goes home', async () => {
    const { harness, stamps } = await arrive('/en/setup/done');

    press(harness, '.secondary');
    await settle(harness);

    expect(stamps).toEqual([{ setupCompleted: true }]);
    expect(TestBed.inject(Router).url).toBe('/en/home');
  });

  it('Show me around marks it over once, and starts the tour on home', async () => {
    const { harness, stamps } = await arrive('/en/setup/done');
    const tour = TestBed.inject(TourStore);

    press(harness, '.primary');
    await settle(harness);

    expect(stamps).toEqual([{ setupCompleted: true }]);
    expect(tour.running()).toBe(true);
    expect(TestBed.inject(Router).url).toBe('/en/home');
    tour.skip();
  });

  it('going back out of the setup marks it over once', async () => {
    // The chevron popping past the welcome, the browser's back, the phone's gesture:
    // whichever it was, the layout is torn down.
    const { harness, profile, stamps } = await arrive('/en/setup');

    await harness.navigateByUrl('/en/home');
    await settle(harness);

    expect(stamps).toEqual([{ setupCompleted: true }]);
    expect(profile.setupPending()).toBe(false);
  });

  it('moving between the setup screens marks nothing', async () => {
    const { harness, stamps } = await arrive('/en/setup');

    await harness.navigateByUrl('/en/setup/done');
    await settle(harness);

    expect(stamps).toEqual([]);
  });
});
