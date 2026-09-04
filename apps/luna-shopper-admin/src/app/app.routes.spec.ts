import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  DEPLOYMENT_SERVICE,
  DeploymentStore,
  ServerReachability,
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
import { ADMIN_RESOURCES } from './resources';

/**
 * The two branches and the guards that pair them (plan 0002, then 0004).
 *
 * Nothing renders without a session, and an operator who has one has no business
 * on the login screen. The second half is the one worth a spec: a guard that
 * redirects to the URL it is guarding loops forever with **no error at all** —
 * a white tab in a browser and a hang in jest — and this is precisely the pair
 * of routes where that mistake is available.
 *
 * Since `0004` the guarded branch is the chrome and the resources under it, so
 * a signed in operator asking for `/` lands on the first resource rather than on
 * a landing page. The guard is on the branch and not on its children, which is
 * what keeps an unknown URL from a signed out operator going to the login
 * screen rather than to a "no such screen" page they could not act on anyway.
 */

/** Where `/` settles for a signed in operator: the app's first resource. */
const FIRST_SCREEN = `/${ADMIN_RESOURCES[0].segment}`;

const session: AdminSession = {
  adminId: 'adm_1',
  username: 'ops',
  displayName: null,
  accessToken: 'a.b.c',
  expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  receivedAt: new Date(),
};

const service: SessionServiceI = {
  signIn: async () => session,
  refresh: async () => session,
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
      ServerReachability,
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

  it('lets an operator with a session reach the first screen', async () => {
    const { router } = await boot(true);

    await router.navigateByUrl('/');

    expect(router.url).toBe(FIRST_SCREEN);
  });

  /**
   * The other side of the second test. The same URL is a login redirect for
   * somebody with no session and a not found page for somebody with one, and
   * only the second of those is a URL they can do anything about.
   */
  it('keeps an unknown URL from a signed in operator where it is', async () => {
    const { router } = await boot(true);

    await router.navigateByUrl('/catalog/products');

    expect(router.url).toBe('/catalog/products');
  });

  /**
   * The loop guard. A reload onto the login screen with a session held must land
   * on the first screen and *stop*, rather than bounce between the two.
   */
  it('sends an operator who already has a session away from the login screen', async () => {
    const { router } = await boot(true);

    await router.navigateByUrl('/sign-in');

    expect(router.url).toBe(FIRST_SCREEN);
  });

  /**
   * A reload after the session is gone, which is what a 401 leaves behind: the
   * interceptor cleared it, and the next cold start finds nothing in storage.
   *
   * It is asserted across two boots rather than by signing out inside one,
   * because a guard only runs on a navigation: an operator standing on a screen
   * when the session ends stays there until they move. That is not a gap, it is
   * why `0003`'s overlay exists.
   */
  it('sends the operator back to the login screen once the session is gone', async () => {
    const signedIn = await boot(true);
    await signedIn.router.navigateByUrl('/');
    expect(signedIn.router.url).toBe(FIRST_SCREEN);

    signedIn.sessions.signOut();

    const afterReload = await boot(false);
    await afterReload.router.navigateByUrl('/');

    expect(afterReload.router.url).toBe('/sign-in');
  });
});
