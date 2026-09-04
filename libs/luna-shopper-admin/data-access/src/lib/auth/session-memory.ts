import { Injectable } from '@angular/core';
import type {
  AdminMe,
  AdminSession,
} from '@portfolio/luna-shopper-admin/models';
import { GatewayError } from '../gateway-error';
import type { SessionServiceI } from './session-service';

/** The one account a backendless run knows about. */
export const MEMORY_ADMIN = {
  adminId: 'adm_memory',
  username: 'ops',
  password: 'ops',
  displayName: 'Operations',
} as const;

/** How long a session minted here lasts, matching the server's token lifetime. */
const TOKEN_LIFETIME_MS = 15 * 60 * 1000;

/**
 * The default behind {@link SESSION_SERVICE}: no backend, one account, and it
 * refuses everything else.
 *
 * What every spec and every run without a gateway gets. It **refuses a wrong
 * password** rather than waving anything through, which is the point of having
 * it at all: a memory implementation that accepted any credentials would make
 * the login screen untestable in the state it spends most of its life in, and
 * would hide a form that never actually reads its own fields.
 *
 * It cannot produce a lockout or a throttle. Those are counted on the server
 * across attempts, and inventing a local counter here would be modelling a
 * mechanism this app does not own. The specs that cover section 2's other
 * outcomes drive the mapping directly, which is where the behaviour actually
 * lives.
 */
@Injectable({ providedIn: 'root' })
export class SessionMemory implements SessionServiceI {
  async signIn(username: string, password: string): Promise<AdminSession> {
    if (
      username.trim() !== MEMORY_ADMIN.username ||
      password !== MEMORY_ADMIN.password
    ) {
      // The same refusal the server gives, so the mapping under test is the one
      // that runs in production rather than a second one that only looks like it.
      throw new GatewayError({
        code: 'unauthorized',
        status: 401,
        correlationId: 'memory',
      });
    }

    return this.issue();
  }

  /**
   * Always succeeds. Reaching this at all means something already asked the
   * server whether it would, and a memory service stands in for a server that
   * said yes.
   */
  async signInForDevelopment(): Promise<AdminSession> {
    return this.issue();
  }

  /**
   * A new token, always.
   *
   * It cannot refuse, and that is the honest answer for a service standing in
   * for a server: the only refusal a real refresh gives is a token that has
   * already died, and this class has no clock of its own to have let one die
   * on. Specs that need a refusal drive {@link SessionServiceI} with a fake, the
   * same way they drive a lockout.
   */
  async refresh(): Promise<AdminSession> {
    return this.issue();
  }

  async readMe(): Promise<AdminMe> {
    return {
      admin: {
        adminId: MEMORY_ADMIN.adminId,
        username: MEMORY_ADMIN.username,
        displayName: MEMORY_ADMIN.displayName,
        lastLoginAt: null,
      },
      // The same answer `DeploymentMemory` gives, and the one that is safe to be
      // wrong about: nothing binds this class once the app provides `SessionApi`.
      deployment: 'development',
    };
  }

  private issue(): AdminSession {
    const now = Date.now();
    return {
      adminId: MEMORY_ADMIN.adminId,
      username: MEMORY_ADMIN.username,
      displayName: MEMORY_ADMIN.displayName,
      accessToken: 'memory-token',
      expiresAt: new Date(now + TOKEN_LIFETIME_MS),
      // Both instants from one `now`, so a session minted here has exactly the
      // lifetime named above rather than one a millisecond short of it.
      receivedAt: new Date(now),
    };
  }
}
