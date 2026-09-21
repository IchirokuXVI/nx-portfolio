import type { UserProfileView } from './auth.messages';

/**
 * What an account has been shown (plan 0145).
 *
 * velista asks a new account three questions and then offers a walk through the
 * app, and both need one fact: whether this person has already been through it.
 * The answer has to be the same on a second device, so it is not browser
 * storage, and it has to arrive on a read the app already makes at startup, so
 * it rides on `GET /v1/account/me` rather than costing a request of its own.
 *
 * **Core owns it, not auth** (section 1). Whether somebody has seen a walk
 * through of velista is not identity, and the moment it goes in auth the next
 * three product flags follow it there. Core already owns everything about how
 * this person shops, and it already keys per user rows off an opaque `userId`
 * without holding a user table.
 */
export const APP_STATE_PATTERNS = {
  /** Read one account's state. Never writes: a missing row reads as two nulls. */
  get: 'appState.get',
  /** Stamp one flag or both, idempotently. Creates the row on demand. */
  set: 'appState.set',
} as const;

export type AppStatePattern =
  (typeof APP_STATE_PATTERNS)[keyof typeof APP_STATE_PATTERNS];

/**
 * Read one account's state. `userId` is set by the gateway from the verified
 * token, never from a body, so a caller can only ever read themselves.
 */
export interface GetUserAppStateRequest {
  userId: string;
}

/**
 * Stamp what this account has been shown (section 3).
 *
 * Both flags are optional and both are `true` or absent. **`false` is not
 * accepted**: unsetting is not a thing the app needs, and a route that can unset
 * is a route that can unset by accident. Replaying the tour does not clear
 * `tourSeenAt`, because it is a fact about the past rather than a switch.
 *
 * Asking for neither is a client mistake, and the gateway refuses it with a 400
 * rather than answering an unchanged state.
 */
export interface SetUserAppStateRequest {
  userId: string;
  setupCompleted?: true;
  tourSeen?: true;
}

/**
 * When this account finished the setup and the tour, or null for never.
 *
 * **A timestamp and not a boolean**, for both. The answer to "have they seen
 * it" is yes or no, but the answer to "when" is what makes a later question
 * answerable: whether to offer the tour again after a release that adds a
 * screen is a decision nobody can take without knowing how old the last one is.
 */
export interface UserAppStateView {
  /** Set when the setup was finished **or dismissed**. The two are one fact. */
  setupCompletedAt: string | null;
  /** Set when the tour was finished or skipped. */
  tourSeenAt: string | null;
}

/**
 * What `GET /v1/account/me` answers (section 2): auth's profile and core's
 * state, composed by the gateway in one round trip.
 *
 * A view of its own beside {@link UserProfileView} rather than a change to it.
 * Auth keeps answering exactly what it answers today, and every other caller of
 * `AUTH_PATTERNS.getProfile` is untouched.
 */
export interface AccountMeView extends UserProfileView {
  appState: UserAppStateView;
}
