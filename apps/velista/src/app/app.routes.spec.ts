import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { writeAppLocale } from '@portfolio/localization/rokutranslator-angular';
import { appRoutes } from './app.routes';

/**
 * The app on its **own origin**, which is the mode plan 0013 added and the one nothing
 * exercised before it.
 *
 * `entry.routes.spec.ts` is the same worked examples one mount to the left. Both exist
 * because the mount is the only difference between them and the whole risk is that it
 * stops being the only difference: `app-root-route.spec.ts` proves the factory states
 * the mount in both the places that read it, and this file proves the router then does
 * the right thing with it.
 *
 * There is no wrapping route here. The standalone build mounts at nothing, so the
 * locale is the first segment and `/` is a legitimate entry point, which is what makes
 * the manifest's `start_url: "/"` correct: the guard inserts the device's language
 * rather than freezing the language of whoever installed the app.
 */
function mount() {
  TestBed.configureTestingModule({ providers: [provideRouter(appRoutes)] });

  return TestBed.inject(Router);
}

describe('velista on its own origin', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    // This visitor's resolved locale, which is what every "resolve" row lands on.
    writeAppLocale('velista', 'es');
  });

  it.each([
    ['/es', '/es'],
    ['/en', '/en'],
    ['/en-US', '/en'],
    ['/es-ES', '/es'],
    ['/zz', '/es'],
    // Locale shaped, passes the regex, is not one velista has: consumed like any
    // other unsupported locale rather than kept as a path segment.
    ['/de', '/es'],
    // The manifest's start_url. If the mount had leaked in from the mounted build the
    // guard would look for the locale one segment too far in and this row would fail,
    // which is D2's trap arriving through the router rather than the factory.
    ['/', '/es'],
  ])('%s becomes %s', async (from, to) => {
    const router = mount();

    await router.navigateByUrl(from);

    expect(router.url).toBe(to);
  });

  it('deep links into a page without going through the front door', async () => {
    // An installed app reopened on a page, and the acceptance criterion that the
    // origin serves more than its root. A public page, because an authenticated one
    // would be testing the auth guard instead of the mount.
    const router = mount();

    await router.navigateByUrl('/en/auth/login');

    expect(router.url).toBe('/en/auth/login');
  });

  it('still turns an anonymous visitor away from the dashboard', async () => {
    // Not a mount problem, and worth pinning so it is not mistaken for one: the home
    // guard sends somebody who is not signed in to the front door, and nothing is
    // constructed and no request is fired on their behalf (plan 0003). The locale
    // survives the redirect, which is the part this file is responsible for.
    const router = mount();

    await router.navigateByUrl('/en/home');

    expect(router.url).toBe('/en');
  });

  it.each([
    ['/qwfp', '/es/qwfp'],
    ['/zz/qwfp', '/es/qwfp'],
  ])('%s becomes %s and reaches the app 404', async (from, to) => {
    // The guard settles a locale rather than declining the URL, because this app's
    // own not found page is localized and cannot be drawn until the language is.
    const router = mount();

    await router.navigateByUrl(from);

    expect(router.url).toBe(to);
  });
});
