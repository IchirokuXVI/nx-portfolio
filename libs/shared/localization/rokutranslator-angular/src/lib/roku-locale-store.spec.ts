import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideRokuTranslator } from './provide-rokutranslator';
import { refetchOnLocaleChange } from './refetch-on-locale-change';
import { RokuLocaleStore } from './roku-locale-store';
import { ROKU_TRANSLATOR } from './roku-translator-token';

@Component({ selector: 'lib-any', template: '' })
class AnyPage {}

function configure(): void {
  TestBed.configureTestingModule({
    providers: [
      // A catch-all, so `switchAppLocale`'s navigation actually lands and
      // `router.url` reflects the rewritten tree rather than the failed one.
      provideRouter([{ path: '**', component: AnyPage }]),
      provideRokuTranslator({
        locales: ['en', 'es'],
        defaultNamespace: 'ns-store',
        loader: () => Promise.resolve({ greeting: 'hi' }),
      }),
    ],
  });
}

describe('RokuLocaleStore', () => {
  beforeEach(() => configure());

  it('updates its locale signal when its own translator emits a change', async () => {
    const store = TestBed.inject(RokuLocaleStore);
    const translator = TestBed.inject(ROKU_TRANSLATOR);

    await translator.changeLocale('es');
    expect(store.getLocale()).toBe('es');
    expect(store.locale()).toBe('es');

    await translator.changeLocale('en');
    expect(store.locale()).toBe('en');
  });

  describe('switchAppLocale rewrites the locale relative to the mount', () => {
    it('rewrites the first segment for an app mounted at the root', async () => {
      const router = TestBed.inject(Router);
      const store = TestBed.inject(RokuLocaleStore);

      await router.navigateByUrl('/en/projects');
      await store.switchAppLocale('landingV2', 'es');

      expect(router.url).toBe('/es/projects');
    });

    it('rewrites the segment after the mount for a mounted app', async () => {
      const router = TestBed.inject(Router);
      const store = TestBed.inject(RokuLocaleStore);

      await router.navigateByUrl('/velista/en/home');
      await store.switchAppLocale('velista', 'es', '/velista');

      // The mount is untouched and only the locale below it moves. Rewriting
      // index 0, which is what this did before plan 0005 D7, would have produced
      // `/es/en/home`.
      expect(router.url).toBe('/velista/es/home');
    });

    it('appends the locale when the path stops at the mount', async () => {
      const router = TestBed.inject(Router);
      const store = TestBed.inject(RokuLocaleStore);

      await router.navigateByUrl('/velista');
      await store.switchAppLocale('velista', 'es', '/velista');

      expect(router.url).toBe('/velista/es');
    });
  });
});

describe('refetchOnLocaleChange', () => {
  it('throws when built outside an injection context (no service passed)', () => {
    // inject() has nothing to resolve against here, so the fail-fast is automatic.
    expect(() => refetchOnLocaleChange()).toThrow();
  });
});
