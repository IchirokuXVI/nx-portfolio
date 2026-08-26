import { TestBed } from '@angular/core/testing';
import {
  Router,
  provideRouter,
  type ActivatedRouteSnapshot,
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

/** Runs a guard the way the router does, and reports where it sent the visitor. */
function run(guard: Guard, identity: FakeIdentity, url: string): string | true {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideFakeSessionStore(identity)],
  });

  const result = TestBed.runInInjectionContext(() =>
    guard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot)
  );

  return result === true
    ? true
    : TestBed.inject(Router).serializeUrl(result as UrlTree);
}

describe('anonymousOnlyGuard', () => {
  it('lets somebody with no account onto the front door', () => {
    expect(run(anonymousOnlyGuard, 'anonymous', '/en/velista')).toBe(true);
  });

  it('sends a signed in visitor straight to their dashboard', () => {
    // One navigation, which is what keeps plan 0003's reasoning intact: the app is
    // launched from a phone home screen and a returning user should not have to
    // navigate past a marketing page.
    expect(run(authenticatedGuard, 'REGISTERED', '/en/velista/home')).toBe(
      true
    );
    expect(run(anonymousOnlyGuard, 'REGISTERED', '/en/velista')).toBe(
      '/en/velista/home'
    );
  });

  it('treats a guest as signed in, because a guest has a real account', () => {
    expect(run(anonymousOnlyGuard, 'TEMPORARY', '/en/velista')).toBe(
      '/en/velista/home'
    );
  });
});

describe('authenticatedGuard', () => {
  it('sends somebody with no account back to the front door', () => {
    expect(run(authenticatedGuard, 'anonymous', '/en/velista/home')).toBe(
      '/en/velista'
    );
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
    expect(run(anonymousOnlyGuard, 'TEMPORARY', '/en/velista/auth/register')).toBe(
      '/en/velista/home'
    );
  });

  it('bars a registered user from register too', () => {
    expect(
      run(anonymousOnlyGuard, 'REGISTERED', '/en/velista/auth/register')
    ).toBe('/en/velista/home');
  });

  it('lets somebody with no account onto register and sign in', () => {
    expect(run(anonymousOnlyGuard, 'anonymous', '/en/velista/auth/register')).toBe(
      true
    );
    expect(run(anonymousOnlyGuard, 'anonymous', '/en/velista/auth/login')).toBe(
      true
    );
  });

  it('lets a guest, and only a guest, onto upgrade', () => {
    expect(run(guestOnlyGuard, 'TEMPORARY', '/en/velista/auth/upgrade')).toBe(
      true
    );
  });

  it('sends a registered user off upgrade to their dashboard', () => {
    // `upgrade()` refuses anybody whose kind is not TEMPORARY, so this form could
    // never succeed for them.
    expect(run(guestOnlyGuard, 'REGISTERED', '/en/velista/auth/upgrade')).toBe(
      '/en/velista/home'
    );
  });

  it('sends somebody with no account off upgrade to the front door', () => {
    // There is no account on this phone to attach an email to.
    expect(run(guestOnlyGuard, 'anonymous', '/en/velista/auth/upgrade')).toBe(
      '/en/velista'
    );
  });

  it('strips the whole auth tail rather than one segment', () => {
    // The credential screens are two segments deep where the dashboard is one, so a
    // redirect built by dropping a single segment would land on `/auth`.
    expect(run(guestOnlyGuard, 'REGISTERED', '/es/velista/auth/upgrade')).toBe(
      '/es/velista/home'
    );
    expect(run(guestOnlyGuard, 'anonymous', '/en/auth/upgrade')).toBe('/en');
  });
});

describe('the redirect targets', () => {
  it('carries the locale segment through untouched', () => {
    expect(run(authenticatedGuard, 'anonymous', '/es/velista/home')).toBe(
      '/es/velista'
    );
    expect(run(anonymousOnlyGuard, 'REGISTERED', '/es/velista')).toBe(
      '/es/velista/home'
    );
  });

  it('carries the mount segment through, whatever it is called', () => {
    // Extraction contract item 5 (plan 0001): the mount is never written down. The
    // guards rewrite the URL they were handed, so a rename of the segment, or its
    // disappearance in the standalone build, needs no edit here.
    expect(run(anonymousOnlyGuard, 'REGISTERED', '/en/shopping')).toBe(
      '/en/shopping/home'
    );
    expect(run(authenticatedGuard, 'anonymous', '/en/shopping/home')).toBe(
      '/en/shopping'
    );
  });

  it('works in the standalone build, where there is no mount segment', () => {
    expect(run(anonymousOnlyGuard, 'REGISTERED', '/en')).toBe('/en/home');
    expect(run(authenticatedGuard, 'anonymous', '/en/home')).toBe('/en');
  });
});
