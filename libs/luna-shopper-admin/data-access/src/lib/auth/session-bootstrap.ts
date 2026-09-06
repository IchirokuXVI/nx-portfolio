import { inject, Injectable } from '@angular/core';
import { DeploymentStore } from '../deployment/deployment-store';
import { ServerReachability } from '../health/server-reachability';
import { SessionStore } from './session-store';

/**
 * What happens before the first screen: ask the server about itself, and take a
 * passwordless session if it offers one (plan 0002, section 5).
 *
 * **The client never decides for itself that it is in development.** It asks,
 * and the server is entitled to say no. A build time flag deciding to skip
 * authentication is precisely the kind of thing that ships wrong, and it is
 * unnecessary: the server already knows, and `ADMIN_DEV_AUTOLOGIN` is guarded on
 * that side by an auth service that refuses to boot with the switch on against a
 * non local database.
 *
 * Three things make this safe to be small:
 *
 * - The environment read answers `devAutologin: false` for every way of not
 *   being told, so an unreachable gateway shows the login screen, or from
 *   `0008` the cover that replaces it.
 * - A held session short circuits it, so a reload of a signed in tab neither
 *   waits on the network nor asks for a second token.
 * - A refused autologin is swallowed. The screen it would have skipped is the
 *   login screen, which is exactly where the operator should be if the server
 *   changed its mind between the two calls.
 */
@Injectable()
export class SessionBootstrap {
  private readonly _deployments = inject(DeploymentStore);
  private readonly _sessions = inject(SessionStore);
  private readonly _reachability = inject(ServerReachability);

  /**
   * Resolves when the app knows whether it has a session.
   *
   * Awaited by the app initializer, so the router's first navigation runs
   * against a settled answer. Without that the guard would run before the
   * autologin returned, bounce a development operator to the login screen, and
   * sign them in behind it.
   */
  async run(): Promise<void> {
    if (this._sessions.signedIn()) {
      // Restored from `localStorage`, which is what a tab opened beside a signed
      // in one now finds too (plan 0013). The environment read still has to
      // happen, for the accent colour, and so does the identity read, because a
      // restored session was never answered by a `me`. Neither is awaited: both
      // decorate a session that is already usable.
      void this._deployments.load();
      void this._sessions.loadIdentity();
      return;
    }

    await this._deployments.load();

    // The read produced no response at all (plan 0008, section 3). Ask once
    // whether anything is there, and let the answer decide between a login
    // screen and a cover. This is the one probe the app awaits: the router's
    // first navigation is behind it, and a screen drawn before the answer is a
    // login form that may not be able to work.
    if (this._deployments.unreachable()) {
      await this._reachability.check();
    }

    // Nothing to ask for a token, and nothing to sign in to.
    if (this._reachability.down()) {
      return;
    }

    if (this._deployments.devAutologin()) {
      await this._sessions.signInForDevelopment();
    }
  }
}
