import { createEnvironmentInjector, EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { APP_MOUNT_PATH } from '@portfolio/localization/rokutranslator-angular';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import { appRootRoute } from './app-root-route';

/**
 * D2, asserted. This is the whole reason the factory exists.
 *
 * velista is mounted at `/velista` by the shell and at `''` on its own origin, and
 * the mount reaches two different consumers by two different mechanisms: route
 * `data`, which `localeGuard` reads because a guard cannot rely on a route's own
 * injector, and `APP_BASE_PATH`, which components read to build links.
 *
 * If the standalone build inherited `/velista` the guard would look for the locale
 * one segment too far in and rewrite every URL wrongly on the first navigation. That
 * failure throws nothing and logs nothing, so it is asserted here rather than left to
 * whoever next reads the route table.
 */
describe('appRootRoute', () => {
  /** The child injector the router builds for a route's `providers`. */
  function providersOf(mount: string): EnvironmentInjector {
    return createEnvironmentInjector(
      appRootRoute(mount).providers ?? [],
      TestBed.inject(EnvironmentInjector),
      `Route: velista at "${mount}"`
    );
  }

  beforeEach(() => TestBed.resetTestingModule());

  it.each([
    ['standalone, on velista own origin', ''],
    ['mounted under the portfolio shell', '/velista'],
  ])('%s: data.mountPath is the mount it was given', (_name, mount) => {
    expect(appRootRoute(mount).data?.['mountPath']).toBe(mount);
  });

  it.each([
    ['standalone, on velista own origin', ''],
    ['mounted under the portfolio shell', '/velista'],
  ])('%s: APP_BASE_PATH is the mount it was given', (_name, mount) => {
    expect(providersOf(mount).get(APP_BASE_PATH)).toBe(mount);
  });

  it.each([
    ['standalone, on velista own origin', ''],
    ['mounted under the portfolio shell', '/velista'],
  ])('%s: APP_MOUNT_PATH follows APP_BASE_PATH', (_name, mount) => {
    // The alias lives in `appProviders`, which knows no mount. It resolves in the
    // injector the route builds, so it picks up whichever value that route bound.
    // If it ever stops following, the locale switcher rewrites the mount segment
    // instead of the locale one.
    expect(providersOf(mount).get(APP_MOUNT_PATH)).toBe(mount);
  });

  it('states the mount in both places from one argument', () => {
    // Not a third assertion of the two above: this one is about them agreeing. The
    // guard and the link builders reading different mounts is the shape of the bug
    // that two hand-written route files used to make possible.
    const route = appRootRoute('/velista');

    expect(route.data?.['mountPath']).toBe(
      providersOf('/velista').get(APP_BASE_PATH)
    );
  });
});
