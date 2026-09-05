import { TestBed } from '@angular/core/testing';
import {
  UNKNOWN_ENVIRONMENT,
  type AdminEnvironment,
  type AdminSession,
} from '@portfolio/luna-shopper-admin/models';
import {
  DEPLOYMENT_SERVICE,
  type DeploymentServiceI,
} from '../deployment/deployment-service';
import { DeploymentStore } from '../deployment/deployment-store';
import { GatewayError } from '../gateway-error';
import { HEALTH_SERVICE, type HealthServiceI } from '../health/health-service';
import { ServerReachability } from '../health/server-reachability';
import { SessionBootstrap } from './session-bootstrap';
import { SESSION_SERVICE, type SessionServiceI } from './session-service';
import { SessionStorage } from './session-storage';
import { SessionStore } from './session-store';

/**
 * Development signs in by itself, and only because the server said it may (plan
 * 0002, section 5).
 *
 * The assertions are mostly negative, and deliberately so. A build time flag
 * deciding to skip authentication is precisely the kind of thing that ships
 * wrong, so what is worth proving is the list of situations in which this does
 * nothing: no answer, a plain answer, a refused autologin, and a session already
 * held.
 */

const session: AdminSession = {
  adminId: 'adm_1',
  username: 'ops',
  displayName: null,
  accessToken: 'a.b.c',
  expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  receivedAt: new Date(),
};

/**
 * `null` for a read that produced no response at all, which is the one thing
 * `DeploymentServiceI` rejects for (plan 0008, section 3).
 */
function build(
  environment: AdminEnvironment | null,
  autologinFails = false,
  reachable = true
) {
  const calls = { signIn: 0, signInForDevelopment: 0, probes: 0 };

  const sessionService: SessionServiceI = {
    signIn: async () => {
      calls.signIn += 1;
      return session;
    },
    signInForDevelopment: async () => {
      calls.signInForDevelopment += 1;
      if (autologinFails) {
        throw new GatewayError({
          code: 'not_configured',
          status: 501,
          correlationId: 'cid',
        });
      }
      return session;
    },
    refresh: async () => session,
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

  const deploymentService: DeploymentServiceI = {
    read: async () => {
      if (environment === null) {
        throw new GatewayError({
          code: '',
          status: 0,
          correlationId: '',
        });
      }
      return environment;
    },
  };

  const healthService: HealthServiceI = {
    probe: async () => {
      calls.probes += 1;
      return reachable;
    },
  };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      ServerReachability,
      { provide: SESSION_SERVICE, useValue: sessionService },
      { provide: DEPLOYMENT_SERVICE, useValue: deploymentService },
      { provide: HEALTH_SERVICE, useValue: healthService },
      SessionStorage,
      SessionStore,
      DeploymentStore,
      SessionBootstrap,
    ],
  });

  return {
    calls,
    bootstrap: TestBed.inject(SessionBootstrap),
    sessions: TestBed.inject(SessionStore),
    deployments: TestBed.inject(DeploymentStore),
    reachability: TestBed.inject(ServerReachability),
  };
}

describe('SessionBootstrap', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('signs in when the server offers an autologin', async () => {
    const { bootstrap, sessions, calls } = build({
      deployment: 'development',
      devAutologin: true,
    });

    await bootstrap.run();

    expect(calls.signInForDevelopment).toBe(1);
    expect(sessions.signedIn()).toBe(true);
  });

  /**
   * The client never decides for itself that it is in development. A gateway
   * reporting `development` and offering nothing gets the login screen, which is
   * what stops the app inferring permission from an environment name.
   */
  it('does not sign in on a development gateway that offers nothing', async () => {
    const { bootstrap, sessions, calls } = build({
      deployment: 'development',
      devAutologin: false,
    });

    await bootstrap.run();

    expect(calls.signInForDevelopment).toBe(0);
    expect(sessions.signedIn()).toBe(false);
  });

  it('does not sign in when the gateway could not be reached', async () => {
    const { bootstrap, sessions, calls } = build(UNKNOWN_ENVIRONMENT);

    await bootstrap.run();

    expect(calls.signInForDevelopment).toBe(0);
    expect(sessions.signedIn()).toBe(false);
  });

  it.each(['production', 'staging'] as const)(
    'does not sign in against %s',
    async (deployment) => {
      const { bootstrap, sessions } = build({
        deployment,
        devAutologin: false,
      });

      await bootstrap.run();

      expect(sessions.signedIn()).toBe(false);
    }
  );

  /**
   * The server is entitled to change its mind between the two calls. The screen
   * the autologin would have skipped is the login screen, which is exactly where
   * the operator should be, so this must not reject and strand the bootstrap.
   */
  it('swallows a refused autologin and leaves the operator at the login screen', async () => {
    const { bootstrap, sessions } = build(
      { deployment: 'development', devAutologin: true },
      true
    );

    await expect(bootstrap.run()).resolves.toBeUndefined();
    expect(sessions.signedIn()).toBe(false);
  });

  /**
   * Plan 0008, section 3. The environment read is the first request the app
   * makes, so it is the first thing an outage breaks, and the answer decides
   * between a login screen and a cover over one.
   */
  describe('when the environment read never arrived', () => {
    it('asks whether the server is there, and says so when it is not', async () => {
      const { bootstrap, reachability, calls } = build(null, false, false);

      await bootstrap.run();

      expect(calls.probes).toBe(1);
      expect(reachability.down()).toBe(true);
    });

    /**
     * One failed request against a server that is up is a blink, and a blink must
     * not stop an operator from signing in.
     */
    it('carries on to the login screen when the probe answers', async () => {
      const { bootstrap, reachability, calls } = build(null, false, true);

      await bootstrap.run();

      expect(calls.probes).toBe(1);
      expect(reachability.down()).toBe(false);
    });

    /** A gateway that answered has answered. Nothing to probe about. */
    it('asks nothing when the gateway answered', async () => {
      const { bootstrap, calls } = build({
        deployment: 'development',
        devAutologin: false,
      });

      await bootstrap.run();

      expect(calls.probes).toBe(0);
    });
  });

  describe('with a session already held', () => {
    /**
     * A reload of a signed in tab. It neither waits on the network nor asks for a
     * second token, but the environment read still has to start, because the
     * accent colour depends on it.
     */
    it('keeps it, asks for no second token, and still reads the environment', async () => {
      const first = build({ deployment: 'development', devAutologin: true });
      await first.sessions.signIn('ops', 'ops');

      const { bootstrap, sessions, deployments, calls } = build({
        deployment: 'production',
        devAutologin: true,
      });
      expect(sessions.signedIn()).toBe(true);

      await bootstrap.run();
      // Let the environment read, which is deliberately not awaited, settle.
      await Promise.resolve();

      expect(calls.signInForDevelopment).toBe(0);
      expect(sessions.token()).toBe('a.b.c');
      expect(deployments.deployment()).toBe('production');
    });
  });
});
