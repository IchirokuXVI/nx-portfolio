import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';
import {
  provideRokuTranslator,
  RokuTranslatorService,
  type TranslationSource,
} from '@portfolio/localization/rokutranslator-angular';
import { composeTranslationLoader } from './translation-providers';

/**
 * Plan 0006's acceptance criteria 2 and 5.
 *
 * Both are about composition rather than about translation: that a second library can
 * be added without the composition site learning where its assets are, and that a
 * library whose assets fail to load costs the app some words rather than the whole
 * app.
 */
describe('composeTranslationLoader', () => {
  /** Criterion 2: each namespace reaches its own library's loader, and nobody else's. */
  it('routes every namespace to the source that declared it', async () => {
    const velista = jest.fn().mockResolvedValue({ greeting: 'from velista' });
    const lists = jest.fn().mockResolvedValue({ greeting: 'from lists' });

    const sources: TranslationSource[] = [
      { namespace: 'velista', locales: ['en'], loader: velista },
      { namespace: 'lists', locales: ['en'], loader: lists },
    ];

    const load = composeTranslationLoader(sources);

    await expect(load('en', 'velista')).resolves.toEqual({
      greeting: 'from velista',
    });
    await expect(load('en', 'lists')).resolves.toEqual({
      greeting: 'from lists',
    });

    // Not just "the right one answered": the wrong one was never asked. A dispatch
    // that called both and picked a result would satisfy the assertions above while
    // fetching every library's assets for every namespace.
    expect(velista).toHaveBeenCalledTimes(1);
    expect(velista).toHaveBeenCalledWith('en', 'velista');
    expect(lists).toHaveBeenCalledTimes(1);
    expect(lists).toHaveBeenCalledWith('en', 'lists');
  });

  /**
   * The library only asks for namespaces it was configured with, so this is
   * unreachable through `provideRokuTranslator`. It is asserted anyway because the
   * alternative behaviour is a rejected promise, and section 4.4 is entirely about
   * what a rejected loader does to a blocking resolver.
   */
  it('falls back to the first source rather than rejecting on an unknown namespace', async () => {
    const first = jest.fn().mockResolvedValue({ ok: true });

    const load = composeTranslationLoader([
      { namespace: 'velista', locales: ['en'], loader: first },
    ]);

    await expect(load('en', 'nobody-owns-this')).resolves.toEqual({ ok: true });
  });
});

@Component({ selector: 'lib-stub-page', template: 'page' })
class StubPage {}

describe('the translationsReady resolver', () => {
  beforeAll(async () => {
    // The eager load path only runs with an i18next instance behind it, which an app
    // gets from its initializer. Without this the service settles without ever calling
    // a loader, and a test of a rejecting loader would prove nothing at all.
    await RokuTranslator.init({ locale: 'en', supportedLocales: ['en'] });
  });

  afterEach(() => jest.useRealTimers());

  /**
   * Criterion 5, and the reason rokutranslator 0004's Problem 3 was a hard
   * prerequisite. Before it, `Promise.all` with no rejection handler left `loaded$`
   * pending forever on a single failed chunk, so this resolver's promise never settled
   * and the router never activated anything: a permanently blank app, from one 404.
   *
   * Run under fake timers that are never advanced, which is criterion 6 asserted
   * rather than reviewed. Any `setTimeout` fallback anywhere in this path would leave
   * the navigation pending and fail the test, so the guarantee is that nothing here
   * waits on the clock. What is left to wait on is the microtask queue, which is what
   * `await` drains.
   */
  it('still activates the route when a loader rejects, without waiting on a timer', async () => {
    jest.useFakeTimers();

    const rejecting = jest.fn(() => Promise.reject(new Error('chunk 404')));

    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: '',
            component: StubPage,
            // The same inline resolver `routes.ts` uses. `loaded$` is handed to the
            // router unwrapped, so what this asserts is the router's own `take(1)`
            // over an observable that emits once and completes even on failure.
            resolve: {
              translationsReady: () => inject(RokuTranslatorService).loaded$,
            },
          },
        ]),
        ...provideRokuTranslator({
          locales: ['en'],
          defaultNamespace: 'ns-rejecting-route',
          loader: rejecting,
        }),
      ],
    });

    await expect(TestBed.inject(Router).navigateByUrl('/')).resolves.toBe(true);

    // Guards the test against being vacuous. The eager load path is skipped
    // entirely when the namespace was never activated, and a resolver that waited
    // on a service which never attempted a load would pass this test while proving
    // nothing about a failing one.
    expect(rejecting).toHaveBeenCalled();
  });
});
