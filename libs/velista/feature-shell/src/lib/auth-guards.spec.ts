import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  Router,
  provideRouter,
  type ActivatedRouteSnapshot,
  type CanActivateFn,
  type Route,
  type RouterStateSnapshot,
  type UrlTree,
} from '@angular/router';
import {
  provideFakeSessionStore,
  type FakeIdentity,
} from '@portfolio/velista/data-access';
import {
  anonymousOnlyGuard,
  authenticatedGuard,
  guestOnlyGuard,
} from './auth-guards';

/**
 * Plan 0007's acceptance criteria 2, 3 and 5, asserted on the **redirect** rather than
 * on rendered DOM. That is the point of moving this out of a template: where a visitor
 * is allowed to be is now a property of the route, so it can be checked without
 * mounting either page, and neither page's constructor runs for somebody who should
 * not be on it.
 */

type Guard = typeof anonymousOnlyGuard;

/**
 * Runs a guard the way the router does, and reports where it sent the visitor.
 *
 * The URL is given in two halves because that is the split the guards work in: the
 * `frontDoor` is this app's mount plus the locale segment, which every redirect keeps
 * and none of them may write down, and `page` is the part below it that is being
 * decided about. Handing them over separately is also what lets the snapshot carry a
 * truthful `pathFromRoot`, which `authenticatedGuard` counts to find the front door.
 */
function run(
  guard: Guard,
  identity: FakeIdentity,
  frontDoor: string,
  page = ''
): string | true {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideFakeSessionStore(identity)],
  });

  const url = page === '' ? frontDoor : `${frontDoor}/${page}`;
  const result = TestBed.runInInjectionContext(() =>
    guard(snapshotOf(frontDoor, page), { url } as RouterStateSnapshot)
  );

  return result === true
    ? true
    : TestBed.inject(Router).serializeUrl(result as UrlTree);
}

/**
 * The route snapshot a guard is handed, in as much detail as the guards read.
 *
 * Only `pathFromRoot` and the segment counts on it matter here: the guarded page is
 * the last entry, and everything above it is the mount and the locale. Angular builds
 * the same shape during preactivation, one entry per route in the tree rather than the
 * two collapsed ones here, and the count is what is being read either way.
 */
function snapshotOf(frontDoor: string, page: string): ActivatedRouteSnapshot {
  const segments = (path: string) => path.split('/').filter(Boolean);
  const above = { url: segments(frontDoor) };
  const self = { url: segments(page) };

  return { ...self, pathFromRoot: [above, self] } as ActivatedRouteSnapshot;
}

describe('anonymousOnlyGuard', () => {
  it('lets somebody with no account onto the front door', () => {
    expect(run(anonymousOnlyGuard, 'anonymous', '/velista/en')).toBe(true);
  });

  it('sends a signed in visitor straight to their dashboard', () => {
    // One navigation, which is what keeps plan 0003's reasoning intact: the app is
    // launched from a phone home screen and a returning user should not have to
    // navigate past a marketing page.
    expect(run(authenticatedGuard, 'REGISTERED', '/velista/en', 'home')).toBe(
      true
    );
    expect(run(anonymousOnlyGuard, 'REGISTERED', '/velista/en')).toBe(
      '/velista/en/home'
    );
  });

  it('treats a guest as signed in, because a guest has a real account', () => {
    expect(run(anonymousOnlyGuard, 'TEMPORARY', '/velista/en')).toBe(
      '/velista/en/home'
    );
  });
});

describe('authenticatedGuard', () => {
  it('sends somebody with no account back to the front door', () => {
    expect(run(authenticatedGuard, 'anonymous', '/velista/en', 'home')).toBe(
      '/velista/en'
    );
  });

  /**
   * The bug that froze the tab, and the reason the redirect is a count rather than a
   * suffix to strip.
   *
   * `home` was the only page behind this guard when it was written, so dropping a
   * trailing `home` and returning the URL untouched for anything else looked like the
   * same thing. It stopped being the same thing the moment a second page arrived: an
   * anonymous visitor deep linking to a group was redirected to the URL they were
   * already on, the router cancelled the navigation to start the redirect, ran this
   * guard again, and got the same answer forever.
   *
   * Every page this guards is listed, and the assertion is written as the front door
   * rather than as "not the URL we came from", so a future page that lands somewhere
   * merely different is not quietly accepted.
   */
  it('sends them to the front door from every page it guards, not back to the page', () => {
    const id = '3f7c1a2e-9b4d-4f1a-8c2e-5d6b7a8c9e01';
    const pages = [
      'home',
      'account',
      `zones/${id}`,
      `zones/${id}/members`,
      `zones/${id}/lists/${id}`,
    ];

    for (const page of pages) {
      expect(run(authenticatedGuard, 'anonymous', '/velista/en', page)).toBe(
        '/velista/en'
      );
    }
  });

  it('sends them to the front door from a sheet over a page it guards', () => {
    // The sheets are children, so the guard sits on the page while `state.url` carries
    // the sheet's segments too. A redirect built by dropping the page's own segments
    // would land halfway inside the page's path.
    const id = '3f7c1a2e-9b4d-4f1a-8c2e-5d6b7a8c9e01';

    expect(
      run(
        authenticatedGuard,
        'anonymous',
        '/velista/en',
        `zones/${id}/settings`
      )
    ).toBe('/velista/en');
  });
});

/**
 * Rule C1 (plan 0009, section 4.2), which is the plan's safety rule rather than a
 * tidiness one.
 *
 * `register()` creates a **new** user row and `upgrade()` converts the caller in place
 * and keeps their `userId`. Memberships are keyed by that id, so a guest who reached
 * the register screen would fill in a perfectly valid form, land on an empty dashboard,
 * and have no way back to groups now owned by an account whose only credential was the
 * token that call just replaced. Nothing would warn them, which is exactly why this is
 * asserted on the redirect and not left to a template.
 */
describe('rule C1: who may see which credential screen', () => {
  it('bars a guest from register and sends them to the dashboard', () => {
    // From where the guest banner takes them to upgrade instead.
    expect(
      run(anonymousOnlyGuard, 'TEMPORARY', '/velista/en', 'auth/register')
    ).toBe('/velista/en/home');
  });

  it('bars a registered user from register too', () => {
    expect(
      run(anonymousOnlyGuard, 'REGISTERED', '/velista/en', 'auth/register')
    ).toBe('/velista/en/home');
  });

  it('lets somebody with no account onto register and sign in', () => {
    expect(
      run(anonymousOnlyGuard, 'anonymous', '/velista/en', 'auth/register')
    ).toBe(true);
    expect(
      run(anonymousOnlyGuard, 'anonymous', '/velista/en', 'auth/login')
    ).toBe(true);
  });

  it('lets a guest, and only a guest, onto upgrade', () => {
    expect(
      run(guestOnlyGuard, 'TEMPORARY', '/velista/en', 'auth/upgrade')
    ).toBe(true);
  });

  it('sends a registered user off upgrade to their dashboard', () => {
    // `upgrade()` refuses anybody whose kind is not TEMPORARY, so this form could
    // never succeed for them.
    expect(
      run(guestOnlyGuard, 'REGISTERED', '/velista/en', 'auth/upgrade')
    ).toBe('/velista/en/home');
  });

  it('sends somebody with no account off upgrade to the front door', () => {
    // There is no account on this phone to attach an email to.
    expect(
      run(guestOnlyGuard, 'anonymous', '/velista/en', 'auth/upgrade')
    ).toBe('/velista/en');
  });

  it('strips the whole auth tail rather than one segment', () => {
    // The credential screens are two segments deep where the dashboard is one, so a
    // redirect built by dropping a single segment would land on `/auth`.
    expect(
      run(guestOnlyGuard, 'REGISTERED', '/velista/es', 'auth/upgrade')
    ).toBe('/velista/es/home');
    expect(run(guestOnlyGuard, 'anonymous', '/en', 'auth/upgrade')).toBe('/en');
  });
});

describe('the redirect targets', () => {
  it('carries the locale segment through untouched', () => {
    expect(run(authenticatedGuard, 'anonymous', '/velista/es', 'home')).toBe(
      '/velista/es'
    );
    expect(run(anonymousOnlyGuard, 'REGISTERED', '/velista/es')).toBe(
      '/velista/es/home'
    );
  });

  it('carries the mount segment through, whatever it is called', () => {
    // Extraction contract item 5 (plan 0001): the mount is never written down. The
    // guards rewrite the URL they were handed, so a rename of the segment, or its
    // disappearance in the standalone build, needs no edit here.
    expect(run(anonymousOnlyGuard, 'REGISTERED', '/en/shopping')).toBe(
      '/en/shopping/home'
    );
    expect(run(authenticatedGuard, 'anonymous', '/en/shopping', 'home')).toBe(
      '/en/shopping'
    );
  });

  it('works in the standalone build, where there is no mount segment', () => {
    expect(run(anonymousOnlyGuard, 'REGISTERED', '/en')).toBe('/en/home');
    expect(run(authenticatedGuard, 'anonymous', '/en', 'home')).toBe('/en');
  });
});

/**
 * The same thing again, through the real router, because the failure was never in the
 * redirect's *value*.
 *
 * A guard returning the URL it was given is not an error Angular reports: it cancels
 * the navigation, starts the redirect, matches the same route, runs the same guard and
 * gets the same answer, forever. Nothing renders and the promise from `navigateByUrl`
 * never settles, which in a browser is a white page and a tab pinned at one core.
 *
 * So this navigates rather than inspecting a return value. It also **counts**, and
 * that is not decoration: left to run, the loop starves the event loop so completely
 * that jest's own timeout never fires and the test run hangs with no output, the same
 * way the tab does. A cap turns that into a failed assertion with a message, which is
 * what a test is for.
 */
describe('an anonymous deep link settles', () => {
  @Component({ standalone: true, template: '' })
  class Blank {}

  /** How many times one navigation may reasonably consult one guard. */
  const CONSULTATIONS = 5;

  let consulted = 0;

  /**
   * The guard under test, with a fuse.
   *
   * A navigation refused once redirects once, so a handful of consultations is
   * generous. Past that the guard is answering with the URL it was handed, and
   * throwing is what makes the router give up and the test say so.
   */
  const boundedGuard: CanActivateFn = (route, state) => {
    if (++consulted > CONSULTATIONS) {
      throw new Error(
        `authenticatedGuard was consulted ${consulted} times for one ` +
          `navigation to ${state.url}: it is redirecting to the URL it was given.`
      );
    }

    return authenticatedGuard(route, state);
  };

  const page = (path: string): Route => ({
    path,
    component: Blank,
    canActivate: [boundedGuard],
  });

  /** The app's shape: the shell's mount, the locale, and the pages under it. */
  const routes: Route[] = [
    {
      path: 'velista',
      children: [
        {
          path: '',
          children: [
            {
              path: ':locale',
              children: [
                page('home'),
                page('account'),
                {
                  ...page('zones/:zoneId'),
                  children: [{ path: 'settings', component: Blank }],
                },
                page('zones/:zoneId/members'),
                page('zones/:zoneId/lists/:listId'),
                // The front door, where every refusal above lands.
                { path: '', component: Blank },
              ],
            },
          ],
        },
      ],
    },
  ];

  const id = '3f7c1a2e-9b4d-4f1a-8c2e-5d6b7a8c9e01';

  it.each([
    ['the dashboard', `/velista/en/home`],
    ['the account screen', `/velista/en/account`],
    ['a group', `/velista/en/zones/${id}`],
    ['a sheet over a group', `/velista/en/zones/${id}/settings`],
    ['a group’s members', `/velista/en/zones/${id}/members`],
    ['a list', `/velista/en/zones/${id}/lists/${id}`],
  ])('lands on the front door from %s', async (_name, url) => {
    consulted = 0;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter(routes), provideFakeSessionStore('anonymous')],
    });

    const router = TestBed.inject(Router);
    await router.navigateByUrl(url);

    expect(router.url).toBe('/velista/en');
  });
});
