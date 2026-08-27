import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import {
  provideRokuTranslator,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';

@Component({ selector: 'app-stub-page', template: 'page' })
class StubPage {}

describe('the translationsReady resolver', () => {
  // No `init` here any more. Since plan 0005 `provideRokuTranslator` creates this
  // app's translator and the service inits it, so the eager load path is live for
  // every test without a process-wide singleton being primed first.
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
