import type { ImpersonationReason } from '../enums/auth.enums';
import type { AdminCredential } from './admin-auth.messages';

/**
 * Support sessions: an operator opens the app as a user (plan 0194).
 *
 * The word in code is `impersonation`. Auth answers every subject here, because
 * auth holds the session row and the key that signs its tokens. The first two
 * are operator subjects and are gated on the forwarded operator token. The
 * others are reached with a handoff code or a token of the session itself.
 */
export const IMPERSONATION_PATTERNS = {
  /** Whether this deployment allows a support session at all. */
  status: 'auth.impersonation.status',
  /** Start a session for one user, and mint the code that hands it to the app. */
  start: 'auth.impersonation.start',
  /** Trade the handoff code for the token pair of the session, one time. */
  exchange: 'auth.impersonation.exchange',
  /** End the session that the caller's token belongs to. */
  end: 'auth.impersonation.end',
  /**
   * Whether a session is live right now. The gateway asks on each request of a
   * session, and realtime asks as a socket connects, which is what makes "End"
   * and the deadline exact and not late by the life of an access token.
   */
  check: 'auth.impersonation.check',
} as const;

export type ImpersonationPattern =
  (typeof IMPERSONATION_PATTERNS)[keyof typeof IMPERSONATION_PATTERNS];

/** Only the operator's own credential. */
export type ImpersonationStatusRequest = AdminCredential;

export interface ImpersonationStatusView {
  /** `IMPERSONATION_ENABLED` of this deployment. */
  enabled: boolean;
}

export interface StartImpersonationRequest extends AdminCredential {
  /** The user the app is opened as. A guest is a user like any other. */
  targetUserId: string;
  reason: ImpersonationReason;
  /** Required for `OTHER`, refused for every other reason. */
  note?: string;
}

/**
 * What auth answers a start with. It carries the raw code, which exists in
 * this message and in the URL the gateway builds from it, and nowhere else.
 */
export interface StartImpersonationResult {
  sessionId: string;
  code: string;
  codeExpiresAt: string;
  expiresAt: string;
}

/**
 * What `POST /v1/admin/users/:id/impersonation` answers with. The gateway
 * builds `url` from `APP_BASE_URL`, with the code in the fragment, so the code
 * is in no query string and no access log holds it.
 */
export interface StartImpersonationView {
  sessionId: string;
  url: string;
  codeExpiresAt: string;
  expiresAt: string;
}

export interface ExchangeImpersonationRequest {
  code: string;
}

/**
 * End a session. Both fields come from the verified token and never from a
 * body. `sessionId` is absent for a token with no `act`, and auth refuses that.
 */
export interface EndImpersonationRequest {
  userId: string;
  sessionId?: string;
}

export interface EndImpersonationResult {
  /** False for a session that was already over, which is not an error. */
  ended: boolean;
}

export interface CheckImpersonationRequest {
  sessionId: string;
}

export interface CheckImpersonationResult {
  live: boolean;
}

/** The one event of a support session. Realtime drops its sockets on it. */
export const IMPERSONATION_EVENTS = {
  ended: 'impersonation.ended',
} as const;

export interface ImpersonationEndedEvent {
  sessionId: string;
  userId: string;
}
