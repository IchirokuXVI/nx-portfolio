import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { writeAppLocale } from '@portfolio/localization/rokutranslator-angular';
import { remoteRoutes } from './entry.routes';

@Component({ selector: 'app-shell-stub', template: '' })
class ShellStub {}

/**
 * The app mounted the way the shell mounts it: a top level `damoclesSword` route
 * whose children are this app's exposed routes. Everything the locale guard decides
 * depends on that nesting, so the spec reproduces it rather than testing the app's
 * table in isolation.
 */
function mount() {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'damoclesSword', children: remoteRoutes },
        { path: '**', component: ShellStub },
      ]),
    ],
  });

  return TestBed.inject(Router);
}

describe('damoclesSword mounted under the shell', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    writeAppLocale('damoclesSword', 'es');
  });

  it('serves a page below the locale', async () => {
    const router = mount();

    await router.navigateByUrl('/damoclesSword/en/about');

    expect(router.url).toBe('/damoclesSword/en/about');
  });

  it('inserts the locale at the bare mount', async () => {
    const router = mount();

    await router.navigateByUrl('/damoclesSword');

    expect(router.url).toBe('/damoclesSword/es');
  });

  it('inserts the locale in front of a page path', async () => {
    const router = mount();

    await router.navigateByUrl('/damoclesSword/about');

    expect(router.url).toBe('/damoclesSword/es/about');
  });

  it('replaces a locale the app does not support', async () => {
    const router = mount();

    await router.navigateByUrl('/damoclesSword/zz/about');

    expect(router.url).toBe('/damoclesSword/es/about');
  });

  it('rewrites a supported locale to its canonical form', async () => {
    const router = mount();

    await router.navigateByUrl('/damoclesSword/en-US/about');

    expect(router.url).toBe('/damoclesSword/en/about');
  });

  it('serves French, which only this app supports', async () => {
    const router = mount();

    await router.navigateByUrl('/damoclesSword/fr/contact');

    expect(router.url).toBe('/damoclesSword/fr/contact');
  });

  it('sends an unknown path below the locale home, in that locale', async () => {
    const router = mount();

    await router.navigateByUrl('/damoclesSword/en/qwfp');

    expect(router.url).toBe('/damoclesSword/en');
  });
});
