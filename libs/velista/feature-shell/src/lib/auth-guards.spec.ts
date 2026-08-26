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
import { anonymousOnlyGuard, authenticatedGuard } from './auth-guards';

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
