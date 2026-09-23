import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  provideRouter,
  Router,
  type ActivatedRouteSnapshot,
  type RouterStateSnapshot,
  type UrlTree,
} from '@angular/router';
import {
  fakeProfileStore,
  profileFor,
  provideFakeProfileStore,
  provideFakeSessionStore,
  type FakeIdentity,
  type FakeProfileStore,
} from '@portfolio/velista/data-access';
import type { AppState } from '@portfolio/velista/models';
import { setupGuard, SetupPromptMemory } from './setup-guard';

/**
 * Velista `0098`, section 3: who is walked into the setup, and when.
 *
 * Asserted on where the guard sends the visitor, as `auth-guards.spec.ts` does, plus
 * the one case a return value cannot show: the profile that lands after the guard
 * already let the page through.
 */

@Component({ template: '' })
class Blank {}

const FRESH: AppState = { setupCompletedAt: null, tourSeenAt: null };
const DONE: AppState = {
  setupCompletedAt: '2026-09-01T10:00:00.000Z',
  tourSeenAt: null,
};

interface Harness {
  readonly profile: FakeProfileStore;
  readonly router: Router;
  /** Run the guard for one page, the way the router does. */
  run(frontDoor: string, page: string): string | true;
}

function setUp(
  identity: FakeIdentity,
  appState: AppState | null,
  userId = 'u1'
): Harness {
  TestBed.resetTestingModule();

  const profile = fakeProfileStore({
    profile: appState === null ? null : profileFor({ userId, appState }),
  });

  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: '**', component: Blank }]),
      provideFakeSessionStore(identity, { userId }),
      provideFakeProfileStore(profile),
    ],
  });

  const router = TestBed.inject(Router);

  return {
    profile,
    router,
    run(frontDoor, page) {
      const url = `${frontDoor}/${page}`;
      const result = TestBed.runInInjectionContext(() =>
        setupGuard(snapshotOf(frontDoor, page), {
          url,
        } as RouterStateSnapshot)
      );

      return result === true ? true : router.serializeUrl(result as UrlTree);
    },
  };
}

/** The snapshot a guard is handed: the page last, the mount and locale above it. */
function snapshotOf(frontDoor: string, page: string): ActivatedRouteSnapshot {
  const segments = (path: string) => path.split('/').filter(Boolean);
  const above = { url: segments(frontDoor) };
  const self = { url: segments(page) };

  return { ...self, pathFromRoot: [above, self] } as ActivatedRouteSnapshot;
}

describe('setupGuard', () => {
  it('never sends somebody who is not signed in', () => {
    const { run } = setUp('anonymous', FRESH);

    expect(run('/velista/en', 'home')).toBe(true);
  });

  it('never sends a guest, who is not shopping for themselves', () => {
    const { run } = setUp('TEMPORARY', FRESH);

    expect(run('/velista/en', 'home')).toBe(true);
  });

  it('never sends an account that has been set up', () => {
    const { run } = setUp('REGISTERED', DONE);

    expect(run('/velista/en', 'home')).toBe(true);
  });

  it('sends a fresh account to the welcome, keeping the mount and the locale', () => {
    const { run } = setUp('REGISTERED', FRESH);

    expect(run('/velista/es', 'home')).toBe('/velista/es/setup');
  });

  it('builds the same URL in the standalone build, where the mount is empty', () => {
    const { run } = setUp('REGISTERED', FRESH);

    expect(run('/en', 'zones/z1/lists/l1')).toBe('/en/setup');
  });

  it('asks only once per document', () => {
    // Somebody who pressed Home instead of answering is not sent back.
    const { run } = setUp('REGISTERED', FRESH);

    expect(run('/velista/en', 'home')).toBe('/velista/en/setup');
    expect(run('/velista/en', 'home')).toBe(true);
    expect(run('/velista/en', 'account')).toBe(true);
  });

  it('stops asking the moment the setup is marked over', () => {
    const { run, profile } = setUp('REGISTERED', FRESH);

    profile.completeSetup();

    expect(run('/velista/en', 'home')).toBe(true);
  });

  it('asks a second account in the same document on its own account', () => {
    // The account that signed out of this tab was asked; the one signing in was not.
    const { run } = setUp('REGISTERED', FRESH, 'u2');
    TestBed.inject(SetupPromptMemory).markAsked('u1');

    expect(run('/velista/en', 'home')).toBe('/velista/en/setup');
  });

  describe('before the profile has answered', () => {
    it('lets the page through rather than waiting on a request', () => {
      const { run } = setUp('REGISTERED', null);

      expect(run('/velista/en', 'home')).toBe(true);
    });

    it('moves the person to the setup when the profile lands, if they are still there', async () => {
      const { run, router, profile } = setUp('REGISTERED', null);
      await router.navigateByUrl('/velista/en/home');
      const navigate = jest.spyOn(router, 'navigateByUrl');

      expect(run('/velista/en', 'home')).toBe(true);
      profile.setProfile(profileFor({ appState: FRESH }));
      TestBed.tick();

      expect(navigate).toHaveBeenCalledTimes(1);
      const [target, extras] = navigate.mock.calls[0] ?? [];
      expect(router.serializeUrl(target as UrlTree)).toBe('/velista/en/setup');
      expect(extras).toEqual({ replaceUrl: true });
    });

    it('does nothing when the person has already moved on', async () => {
      const { run, router, profile } = setUp('REGISTERED', null);
      await router.navigateByUrl('/velista/en/home');
      expect(run('/velista/en', 'home')).toBe(true);

      await router.navigateByUrl('/velista/en/account');
      const navigate = jest.spyOn(router, 'navigateByUrl');
      profile.setProfile(profileFor({ appState: FRESH }));
      TestBed.tick();

      expect(navigate).not.toHaveBeenCalled();
      // Not asked yet, so the next page it guards still offers it, once.
      expect(run('/velista/en', 'account')).toBe('/velista/en/setup');
    });

    it('does nothing when the profile says the setup was done', async () => {
      const { run, router, profile } = setUp('REGISTERED', null);
      await router.navigateByUrl('/velista/en/home');
      expect(run('/velista/en', 'home')).toBe(true);

      const navigate = jest.spyOn(router, 'navigateByUrl');
      profile.setProfile(profileFor({ appState: DONE }));
      TestBed.tick();

      expect(navigate).not.toHaveBeenCalled();
    });
  });
});
