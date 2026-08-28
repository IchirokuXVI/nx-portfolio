import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { writeAppLocale } from '@portfolio/localization/rokutranslator-angular';
import { remoteRoutes } from './entry.routes';

@Component({ selector: 'app-shell-stub', template: '' })
class ShellStub {}

/**
 * The app mounted the way the shell mounts it: a top level `velista` route whose
 * children are this app's exposed routes. Everything the locale guard decides depends
 * on that nesting, so the spec reproduces it rather than testing the app's table in
 * isolation.
 *
 * These are the worked examples from plan 0005 D6, which use velista's URLs, run
 * against the real router rather than read off a table.
 */
function mount() {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'velista', children: remoteRoutes },
        { path: '**', component: ShellStub },
      ]),
    ],
  });

  return TestBed.inject(Router);
}

describe('velista mounted under the shell', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    // This visitor's resolved locale, which is what every "resolve" row lands on.
    writeAppLocale('velista', 'es');
  });

  it.each([
    ['/velista/es', '/velista/es'],
    ['/velista/en', '/velista/en'],
    ['/velista/en-US', '/velista/en'],
    ['/velista/es-ES', '/velista/es'],
    ['/velista/zz', '/velista/es'],
    // Locale shaped, passes the regex, is not one velista has: consumed like any
    // other unsupported locale rather than kept as a path segment.
    ['/velista/de', '/velista/es'],
    ['/velista', '/velista/es'],
  ])('%s becomes %s', async (from, to) => {
    const router = mount();

    await router.navigateByUrl(from);

    expect(router.url).toBe(to);
  });

  /**
   * The rows that end on this app's own 404, and the reason the guard settles a
   * locale rather than declining the URL: `qwfp` is not a route, so the not found
   * page renders, in Spanish, which is only possible because the locale was settled
   * first.
   */
  it.each([
    ['/velista/qwfp', '/velista/es/qwfp'],
    ['/velista/zz/qwfp', '/velista/es/qwfp'],
  ])('%s becomes %s and reaches the app 404', async (from, to) => {
    const router = mount();

    await router.navigateByUrl(from);

    expect(router.url).toBe(to);
  });

  it('does not swallow a sibling mount', async () => {
    const router = mount();

    await router.navigateByUrl('/somewhere-else');

    expect(router.url).toBe('/somewhere-else');
  });
});
