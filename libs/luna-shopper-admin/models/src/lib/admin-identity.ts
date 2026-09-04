import { asInstant } from './admin-session';
import { toDeployment, type Deployment } from './deployment';

/**
 * The operator `GET /v1/admin/auth/me` names (plan 0002, section 6).
 *
 * The identity the app chrome shows from `0004`. It overlaps the session's own
 * `username` and `displayName` on purpose: a session is what the login answered
 * with, and this is what the server says now, which is the one that stays true
 * when a display name is changed on another device.
 */
export interface AdminIdentity {
  readonly adminId: string;
  readonly username: string;
  readonly displayName: string | null;
  /** When this account last signed in, or `null` if it never has. */
  readonly lastLoginAt: Date | null;
}

/**
 * Who is signed in, and which deployment they are signed in to.
 *
 * The environment travels with the identity because the gateway composes the two
 * (plan 0071), and from here on it is the app's source for the accent colour.
 * The unauthenticated read of `0001` stays the login screen's source, which is
 * the one moment there is no token to make this call with.
 */
export interface AdminMe {
  readonly admin: AdminIdentity;
  /** `null` when the server named an environment this app does not know. */
  readonly deployment: Deployment | null;
}

/**
 * `GET /v1/admin/auth/me`, as this app's own types.
 *
 * `null` when the identity is unusable, which is the same standard
 * {@link toAdminSession} holds a session to. An unrecognised environment is
 * **not** unusable: it maps to `null` inside a perfectly good identity, because
 * `0001` already settled that an environment this app cannot name is a state it
 * has to be able to draw rather than a reason to fail.
 */
export function toAdminMe(value: unknown): AdminMe | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const body = value as Record<string, unknown>;
  const admin = toAdminIdentity(body['admin']);

  return admin === null
    ? null
    : { admin, deployment: toDeployment(body['environment']) };
}

/** One operator, or `null` when the payload does not describe one. */
export function toAdminIdentity(value: unknown): AdminIdentity | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const body = value as Record<string, unknown>;
  const adminId = body['adminId'];
  const username = body['username'];
  const displayName = body['displayName'];

  if (
    typeof adminId !== 'string' ||
    adminId === '' ||
    typeof username !== 'string' ||
    username === ''
  ) {
    return null;
  }

  return {
    adminId,
    username,
    displayName: typeof displayName === 'string' ? displayName : null,
    lastLoginAt: asInstant(body['lastLoginAt']),
  };
}
