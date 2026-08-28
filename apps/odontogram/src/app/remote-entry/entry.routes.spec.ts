import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { writeAppLocale } from '@portfolio/localization/rokutranslator-angular';
import { remoteRoutes } from './entry.routes';

@Component({ selector: 'ng-odtg-shell-stub', template: '' })
class ShellStub {}

/**
 * The app mounted the way the shell mounts it: a top level `odontogram` route whose
 * children are this app's exposed routes. Everything the locale guard decides depends
 * on that nesting, so the spec reproduces it rather than testing the app's table in
 * isolation.
 */
function mount() {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'odontogram', children: remoteRoutes },
        { path: '**', component: ShellStub },
      ]),
    ],
  });

  return TestBed.inject(Router);
}

describe('odontogram mounted under the shell', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    writeAppLocale('odontogram', 'es');
  });

  it('serves /odontogram/{locale}', async () => {
    const router = mount();

    await router.navigateByUrl('/odontogram/en');

    expect(router.url).toBe('/odontogram/en');
  });

  /**
   * The one that was failing, and the reason the app's parent route needs a child
   * that always matches. The guard's job here is to *insert* the locale, and a guard
   * only runs once its route matches.
   */
  it('inserts the locale when the URL has none', async () => {
    const router = mount();

    await router.navigateByUrl('/odontogram');

    expect(router.url).toBe('/odontogram/es');
  });

  it('replaces a locale the app does not support', async () => {
    const router = mount();

    await router.navigateByUrl('/odontogram/zz');

    expect(router.url).toBe('/odontogram/es');
  });

  it('keeps an unroutable tail so the app can 404 in a settled locale', async () => {
    const router = mount();

    await router.navigateByUrl('/odontogram/qwfp');

    expect(router.url).toBe('/odontogram/es/qwfp');
  });
});
