import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  DEPLOYMENT_SERVICE,
  DeploymentStore,
  SESSION_SERVICE,
  SessionStorage,
  SessionStore,
  type SessionServiceI,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  UNKNOWN_ENVIRONMENT,
  type AdminSession,
} from '@portfolio/luna-shopper-admin/models';
import { appRoutes } from './app.routes';

/**
 * The two routes and the guards that pair them (plan 0002).
 *
 * Nothing renders without a session, and an operator who has one has no business
 * on the login screen. The second half is the one worth a spec: a guard that
 * redirects to the URL it is guarding loops forever with **no error at all** —
 * a white tab in a browser and a hang in jest — and this is precisely the pair
 * of routes where that mistake is available.
 */

const session: AdminSession = {
  adminId: 'adm_1',
  username: 'ops',
  displayName: null,
  accessToken: 'a.b.c',
  expiresAt: new Date(Date.now() + 15 * 60 * 1000),
};

const service: SessionServiceI = {
  signIn: async () => session,
  signInForDevelopment: async () => session,
  readMe: async () => ({
    admin: {
      adminId: 'adm_1',
      username: 'ops',
      displayName: null,
      lastLoginAt: null,
    },
    deployment: 'development',
  }),
};

async function boot(signedIn: boolean) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter(appRoutes),
      provideLocationMocks(),
      { provide: SESSION_SERVICE, useValue: service },
      {
        provide: DEPLOYMENT_SERVICE,
        useValue: { read: async () => UNKNOWN_ENVIRONMENT },
      },
      SessionStorage,
      SessionStore,
      DeploymentStore,
    ],
  }).compileComponents();

  const sessions = TestBed.inject(SessionStore);
  if (signedIn) {
    await sessions.signIn('ops', 'pw');
  }

  return { router: TestBed.inject(Router), sessions };
}

describe('appRoutes', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  it('sends an operator with no session to the login screen', async () => {
    const { router } = await boot(false);

    await router.navigateByUrl('/');

    expect(router.url).toBe('/sign-in');
  });

  it('sends an unknown URL from a signed out operator to the login screen', async () => {
    const { router } = await boot(false);

    await router.navigateByUrl('/catalog/products');

    expect(router.url).toBe('/sign-in');
  });

  it('lets an operator with a session reach the landing page', async () => {
    const { router } = await boot(true);

    await router.navigateByUrl('/');

    expect(router.url).toBe('/');
  });

  /**
   * The loop guard. A reload onto the login screen with a session held must land
   * on the landing route and *stop*, rather than bounce between the two.
   */
  it('sends an operator who already has a session away from the login screen', async () => {
    const { router } = await boot(true);

    await router.navigateByUrl('/sign-in');

    expect(router.url).toBe('/');
  });

  /**
   * A reload after the session is gone, which is what a 401 leaves behind: the
   * interceptor cleared it, and the next cold start finds nothing in storage.
   *
   * Navigating again inside the same tab would *not* show this, because the
   * router skips a navigation that resolves to the URL it is already on — the
   * wildcard redirects to `''`, which is where it already is. That is a property
   * of the router rather than of these guards, and it is part of why `0003`'s
   * overlay exists: a session ending mid session is not felt until the operator
   * moves.
   */
  it('sends the operator back to the login screen once the session is gone', async () => {
    const signedIn = await boot(true);
    await signedIn.router.navigateByUrl('/');
    expect(signedIn.router.url).toBe('/');

    signedIn.sessions.signOut();

    const afterReload = await boot(false);
    await afterReload.router.navigateByUrl('/');

    expect(afterReload.router.url).toBe('/sign-in');
  });
});
