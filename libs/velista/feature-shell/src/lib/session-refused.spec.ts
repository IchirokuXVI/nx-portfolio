import {
  Component,
  provideEnvironmentInitializer,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, type Route } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { SessionStore, TokenStore } from '@portfolio/velista/data-access';
import { authenticatedGuard } from './auth-guards';
import { leavePageWhenSessionRefused } from './session-refused';

@Component({ template: '' })
class Blank {}

/**
 * A session the server refuses while a page is open (a pair Android restored after a
 * reinstall is the usual one) must leave that page at once. Before, the page stayed
 * drawn and empty until the next tap met the guard.
 */
describe('leavePageWhenSessionRefused', () => {
  const signedIn = signal(true);
  const refused = signal(0);

  async function openAt(url: string): Promise<Router> {
    signedIn.set(true);
    refused.set(0);

    const routes: Route[] = [
      {
        path: '',
        providers: [provideEnvironmentInitializer(leavePageWhenSessionRefused)],
        children: [
          {
            path: ':locale',
            children: [
              {
                path: 'home',
                canActivate: [authenticatedGuard],
                component: Blank,
              },
              { path: 'legal', component: Blank },
              { path: '', component: Blank },
            ],
          },
        ],
      },
    ];

    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        {
          provide: SessionStore,
          useValue: { isAuthenticated: signedIn.asReadonly() },
        },
        { provide: TokenStore, useValue: { refused: refused.asReadonly() } },
      ],
    });

    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    return TestBed.inject(Router);
  }

  /** The server refused the pair: the store cleared it and counted it. */
  async function refuse(): Promise<void> {
    signedIn.set(false);
    refused.update((count) => count + 1);
    TestBed.tick();
    await TestBed.inject(Router).navigated;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('sends a signed in page to the front door with the page as returnUrl', async () => {
    const router = await openAt('/en/home');

    await refuse();

    expect(router.url).toBe('/en?returnUrl=%2Fen%2Fhome');
  });

  it('leaves a page that anybody may see where it is', async () => {
    const router = await openAt('/en/legal');

    await refuse();

    expect(router.url).toBe('/en/legal');
  });

  it('does nothing for a sign out, which counts no refusal', async () => {
    const router = await openAt('/en/home');

    signedIn.set(false);
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(router.url).toBe('/en/home');
  });
});
