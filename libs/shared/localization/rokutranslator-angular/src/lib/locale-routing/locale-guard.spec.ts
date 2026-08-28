import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Route, Router } from '@angular/router';
import { provideRokuTranslator } from '../provide-rokutranslator';
import { ROKU_TRANSLATOR } from '../roku-translator-token';
import { writeAppLocale } from './app-locale-storage';
import { localeGuard } from './locale-guard';

@Component({ selector: 'lib-page', template: 'page' })
class Page {}

@Component({ selector: 'lib-missing', template: 'not found' })
class NotFound {}

/**
 * velista's shape: mounted at `/velista`, locale below the mount, and the app's own
 * wildcard underneath so the 404 rows can be asserted for real rather than reasoned
 * about.
 */
function routes(mountPath: string, path: string): Route[] {
  return [
    {
      path,
      canActivate: [localeGuard],
      data: {
        appKey: 'velista',
        supportedLocales: ['en', 'es'],
        defaultLocale: 'en',
        mountPath,
      },
      children: [
        { path: ':locale/home', component: Page },
        { path: ':locale', component: Page },
        { path: ':locale/**', component: NotFound },
      ],
    },
  ];
}

async function navigate(url: string, mountPath = '/velista') {
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes(mountPath, mountPath.replace(/^\//, ''))),
      provideRokuTranslator({
        locales: ['en', 'es'],
        defaultNamespace: 'ns-guard',
        loader: () => Promise.resolve({ greeting: 'hi' }),
      }),
    ],
  });

  const router = TestBed.inject(Router);
  await router.navigateByUrl(url);

  return { router, translator: TestBed.inject(ROKU_TRANSLATOR) };
}

describe('localeGuard', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    writeAppLocale('velista', 'es');
  });

  it('leaves a supported canonical locale alone and adopts it', async () => {
    const { router, translator } = await navigate('/velista/en/home');

    expect(router.url).toBe('/velista/en/home');
    expect(translator.getLocale()).toBe('en');
  });

  it('rewrites a supported non canonical locale', async () => {
    const { router, translator } = await navigate('/velista/en-US');

    expect(router.url).toBe('/velista/en');
    expect(translator.getLocale()).toBe('en');
  });

  it('replaces an unsupported locale shaped segment', async () => {
    const { router, translator } = await navigate('/velista/de/home');

    expect(router.url).toBe('/velista/es/home');
    expect(translator.getLocale()).toBe('es');
  });

  it('inserts the resolved locale in front of a path segment', async () => {
    const { router } = await navigate('/velista/home');

    expect(router.url).toBe('/velista/es/home');
  });

  /**
   * The invariant, end to end: nothing below the mount renders before the locale is
   * settled, so the app's own 404 is drawn in a language the visitor can read.
   */
  it('settles a locale before an unroutable path reaches the app 404', async () => {
    const { router, translator } = await navigate('/velista/qwfp');

    expect(router.url).toBe('/velista/es/qwfp');
    expect(translator.getLocale()).toBe('es');
  });

  it('preserves the query string and fragment while correcting', async () => {
    const { router } = await navigate('/velista/home?tab=lists#top');

    expect(router.url).toBe('/velista/es/home?tab=lists#top');
  });

  it('persists a locale taken from the URL, so it survives the next visit', async () => {
    // Arrives at English while the app remembers Spanish: the link wins, and the
    // preference is rewritten rather than merely honoured for this navigation.
    await navigate('/velista/en/home');

    TestBed.resetTestingModule();
    const { router } = await navigate('/velista/home');

    expect(router.url).toBe('/velista/en/home');
  });
});
