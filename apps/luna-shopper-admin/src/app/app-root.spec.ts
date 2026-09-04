import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  DeploymentStore,
  ServerReachability,
  SessionLifecycle,
  SessionStore,
} from '@portfolio/luna-shopper-admin/data-access';
import type { Deployment } from '@portfolio/luna-shopper-admin/models';
import { AppRoot } from './app-root';

/**
 * The accent colour is keyed off `data-deployment` on this element, so what the
 * attribute says **is** what colour the app wears (plan 0001, section 6). This is
 * also where the session is drawn (plan 0003), because it is the only component
 * above every route: an expiring session has to be answered without unmounting
 * whatever screen is open.
 *
 * The assertion that matters is the negative one: an app that has not established
 * its environment must carry no attribute at all, so the stylesheet's resting grey
 * applies. If it fell back to a name, a failed read would paint the app in some
 * environment's colour without anybody having said that is the environment, which is
 * exactly the confident wrong answer the feature exists to prevent.
 */
async function render(
  deployment: Deployment | null | undefined,
  session: { warning?: boolean; locked?: boolean; down?: boolean } = {}
) {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [AppRoot, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      {
        provide: DeploymentStore,
        useValue: { deployment: signal(deployment).asReadonly() },
      },
      {
        provide: SessionLifecycle,
        useValue: {
          warning: signal(session.warning ?? false).asReadonly(),
          locked: signal(session.locked ?? false).asReadonly(),
          lockedUsername: signal('ops').asReadonly(),
          keepAlive: () => undefined,
          signOut: () => undefined,
          reauthenticate: async () => null,
        },
      },
      {
        provide: ServerReachability,
        useValue: {
          down: signal(session.down ?? false).asReadonly(),
          checking: signal(false).asReadonly(),
          automaticAttemptsLeft: signal(10).asReadonly(),
          exhausted: signal(false).asReadonly(),
          retry: async () => true,
        },
      },
      // Read by the cover, to decide whether to warn about reloading.
      { provide: SessionStore, useValue: { signedIn: () => true } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(AppRoot);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('AppRoot', () => {
  it.each<Deployment>(['production', 'staging', 'development'])(
    'stamps %s so the stylesheet can colour the app',
    async (deployment) => {
      const host = await render(deployment);

      expect(host.getAttribute('data-deployment')).toBe(deployment);
    }
  );

  it('stamps nothing while the deployment is still being read', async () => {
    const host = await render(undefined);

    expect(host.hasAttribute('data-deployment')).toBe(false);
  });

  it('stamps nothing when the deployment could not be established', async () => {
    const host = await render(null);

    expect(host.hasAttribute('data-deployment')).toBe(false);
  });

  describe('the session', () => {
    it('draws neither the warning nor the overlay while it is healthy', async () => {
      const host = await render('development');

      expect(host.querySelector('lib-session-warning')).toBeNull();
      expect(host.querySelector('lib-reauth-overlay')).toBeNull();
      expect(host.querySelector('.app')?.hasAttribute('inert')).toBe(false);
    });

    it('draws the warning without covering anything', async () => {
      const host = await render('development', { warning: true });

      expect(host.querySelector('lib-session-warning')).not.toBeNull();
      // The session is still perfectly usable and the operator has done nothing
      // wrong, so the app underneath stays reachable.
      expect(host.querySelector('.app')?.hasAttribute('inert')).toBe(false);
    });

    /**
     * Section 5.1. `inert` takes the routed page out of the tab order **and**
     * out of the accessibility tree, so Tab cannot walk the cursor into a
     * covered form and a screen reader cannot be walked through the content the
     * overlay is hiding.
     */
    it('covers the app, and makes what it covers inert', async () => {
      const host = await render('development', { locked: true });

      expect(host.querySelector('lib-reauth-overlay')).not.toBeNull();
      expect(host.querySelector('.app')?.hasAttribute('inert')).toBe(true);
    });

    /**
     * Nothing unmounts, nothing navigates, and no component is destroyed: the
     * outlet the routed screen lives in is still there behind the cover, which
     * is the whole reason for an overlay rather than a redirect.
     */
    it('leaves the routed screen mounted underneath', async () => {
      const host = await render('development', { locked: true });

      expect(host.querySelector('.app router-outlet')).not.toBeNull();
    });
  });

  /**
   * Plan 0008, section 5. The two covers are stacked and reachability is on top,
   * because the app is usually in both states at once: an outage long enough to
   * notice is long enough for the token to expire behind it, and a password
   * prompt against a server that cannot check one is not the screen to show.
   */
  describe('the server', () => {
    it('covers the app when the gateway stopped answering', async () => {
      const host = await render('development', { down: true });

      expect(host.querySelector('lib-server-down-overlay')).not.toBeNull();
      expect(host.querySelector('.app')?.hasAttribute('inert')).toBe(true);
      expect(host.querySelector('.app router-outlet')).not.toBeNull();
    });

    it('draws the outage over the expired session, not beside it', async () => {
      const host = await render('development', { down: true, locked: true });

      expect(host.querySelector('lib-server-down-overlay')).not.toBeNull();
      expect(host.querySelector('lib-reauth-overlay')).toBeNull();
    });

    /**
     * The warning is about a session running down, which is not the operator's
     * problem while the thing that renews it is unreachable.
     */
    it('hides the idle warning while the server is gone', async () => {
      const host = await render('development', { down: true, warning: true });

      expect(host.querySelector('lib-session-warning')).toBeNull();
    });
  });
});
