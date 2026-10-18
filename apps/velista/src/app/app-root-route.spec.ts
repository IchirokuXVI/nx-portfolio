import { APP_BASE_HREF } from '@angular/common';
import {
  ApplicationRef,
  createEnvironmentInjector,
  EnvironmentInjector,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { bootstrapApplication } from '@angular/platform-browser';
import { APP_MOUNT_PATH } from '@portfolio/localization/rokutranslator-angular';
import {
  SOCKET_FACTORY,
  type SocketLike,
} from '@portfolio/velista/data-access';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import {
  provideFakeBrowserFacade,
  StorageKeys,
} from '@portfolio/velista/platform';
import { AppRoot } from './app-root';
import { appRootRoute } from './app-root-route';
import { appConfig } from './app.config';

/**
 * D2, asserted. This is the whole reason the factory exists.
 *
 * velista is mounted at `/velista` by the shell and at `''` on its own origin, and
 * the mount reaches two different consumers by two different mechanisms: route
 * `data`, which `localeGuard` reads because a guard cannot rely on a route's own
 * injector, and `APP_BASE_PATH`, which components read to build links.
 *
 * If the standalone build inherited `/velista` the guard would look for the locale
 * one segment too far in and rewrite every URL wrongly on the first navigation. That
 * failure throws nothing and logs nothing, so it is asserted here rather than left to
 * whoever next reads the route table.
 */
describe('appRootRoute', () => {
  /** The child injector the router builds for a route's `providers`. */
  function providersOf(mount: string): EnvironmentInjector {
    return createEnvironmentInjector(
      appRootRoute(mount).providers ?? [],
      TestBed.inject(EnvironmentInjector),
      `Route: velista at "${mount}"`
    );
  }

  beforeEach(() => TestBed.resetTestingModule());

  it.each([
    ['standalone, on velista own origin', ''],
    ['mounted under the portfolio shell', '/velista'],
  ])('%s: data.mountPath is the mount it was given', (_name, mount) => {
    expect(appRootRoute(mount).data?.['mountPath']).toBe(mount);
  });

  it.each([
    ['standalone, on velista own origin', ''],
    ['mounted under the portfolio shell', '/velista'],
  ])('%s: APP_BASE_PATH is the mount it was given', (_name, mount) => {
    expect(providersOf(mount).get(APP_BASE_PATH)).toBe(mount);
  });

  it.each([
    ['standalone, on velista own origin', ''],
    ['mounted under the portfolio shell', '/velista'],
  ])('%s: APP_MOUNT_PATH follows APP_BASE_PATH', (_name, mount) => {
    // The alias lives in `appProviders`, which knows no mount. It resolves in the
    // injector the route builds, so it picks up whichever value that route bound.
    // If it ever stops following, the locale switcher rewrites the mount segment
    // instead of the locale one.
    expect(providersOf(mount).get(APP_MOUNT_PATH)).toBe(mount);
  });

  it('states the mount in both places from one argument', () => {
    // Not a third assertion of the two above: this one is about them agreeing. The
    // guard and the link builders reading different mounts is the shape of the bug
    // that two hand-written route files used to make possible.
    const route = appRootRoute('/velista');

    expect(route.data?.['mountPath']).toBe(
      providersOf('/velista').get(APP_BASE_PATH)
    );
  });
});

/**
 * One environment injector for `appProviders` on velista's own origin (velista
 * `0155`, item 4).
 *
 * `appConfig` used to spread the list at the root as well as on the route, so the
 * standalone build held two copies of everything on it. Each copy ran its own
 * initializers, each built a `ProfileStore`, and each `ProfileStore` built a
 * `RealtimeSocket` joined to the same user room: every frame arrived twice before the
 * basket socket made it three. Only a real bootstrap shows it, because the second
 * copy comes from the root and the router together.
 */
// The pages are not what this counts, and drawing them would pull every screen
// into the spec. An empty table still matches `/`, so the root route and its
// injector are built exactly as they are in the browser.
jest.mock('@portfolio/velista/feature-shell', () => ({ AppShellRoutes: [] }));

describe('the standalone bootstrap', () => {
  const host = 'app-velista-root';
  const realFetch = globalThis.fetch;
  let opened: string[];
  let app: ApplicationRef | null;

  function freshToken(): string {
    const encode = (value: object) =>
      btoa(JSON.stringify(value))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    return `${encode({ alg: 'RS256' })}.${encode({ exp, sub: 'u1' })}.sig`;
  }

  /** A socket that never comes up. Only how many were asked for matters here. */
  function inertSocket(): SocketLike {
    return {
      connected: false,
      connect: () => undefined,
      disconnect: () => undefined,
      on: () => undefined,
      onAny: () => undefined,
      timeout: () => ({ emitWithAck: () => new Promise(() => undefined) }),
    };
  }

  beforeEach(() => {
    opened = [];
    app = null;
    document.body.appendChild(document.createElement(host));
    // No backend: every request stays in flight, so nothing answers and nothing fails.
    globalThis.fetch = jest.fn(() => new Promise<Response>(() => undefined));
  });

  afterEach(() => {
    app?.destroy();
    document.querySelector(host)?.remove();
    globalThis.fetch = realFetch;
  });

  it('opens one user socket for a signed in session', async () => {
    const storage = new Map([
      [
        StorageKeys.session,
        JSON.stringify({
          userId: 'u1',
          kind: 'REGISTERED',
          username: 'Calm Harbour',
          accessToken: freshToken(),
          refreshToken: 'r1',
        }),
      ],
    ]);

    app = await bootstrapApplication(AppRoot, {
      providers: [
        ...appConfig.providers,
        { provide: APP_BASE_HREF, useValue: '/' },
        provideFakeBrowserFacade(storage),
        {
          provide: SOCKET_FACTORY,
          useValue: (url: string) => {
            opened.push(url);
            return inertSocket();
          },
        },
      ],
    });

    // The route injector is built by the first navigation, and a socket opens after
    // an awaited token read, so both get a few turns to happen. A second socket has
    // every chance to appear: the loop waits past one before it stops.
    for (let turn = 0; turn < 20; turn++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(opened).toHaveLength(1);
  });
});
