import type { UsernamePropagation } from '../enums/auth.enums';

/**
 * Identity events auth publishes (plan 0005, section 5).
 *
 * Consumers are free to ignore these; core does not need them for the in place
 * upgrade because `userId` is stable. They are published on the broker so future
 * services (and the orphan cleanup job) can react.
 */
export const IDENTITY_EVENTS = {
  userRegistered: 'user.registered',
  userUpgraded: 'user.upgraded',
  userEmailVerified: 'user.emailVerified',
  userDeleted: 'user.deleted',
  userUsernameChanged: 'user.usernameChanged',
} as const;

export type IdentityEvent =
  (typeof IDENTITY_EVENTS)[keyof typeof IDENTITY_EVENTS];

export interface UserRegisteredEvent {
  userId: string;
}

export interface UserUpgradedEvent {
  userId: string;
}

export interface UserEmailVerifiedEvent {
  userId: string;
}

/**
 * Emitted after auth removes a user and its personal data (plan 0011). Core
 * reacts by retiring the user's memberships and marking any zones they owned for
 * deletion. Idempotent: a redelivered event is a no-op.
 */
export interface UserDeletedEvent {
  userId: string;
}

/**
 * Emitted after auth commits a global username change (plan 0018, section 4.3).
 * It fires for every propagation mode, GLOBAL_ONLY included, so a consumer sees
 * every rename; core simply records a GLOBAL_ONLY event as processed and touches
 * nothing. Idempotent on the consumer via the processed-events inbox.
 */
export interface UserUsernameChangedEvent {
  /**
   * Unique per emission, so the consumer's inbox dedupes redeliveries without
   * suppressing a genuine repeat: renaming to a name the user held before is a
   * new change and must apply, which a key built from the names alone would
   * swallow.
   */
  eventId: string;
  userId: string;
  /** Needed by MATCHING_ZONES; always sent so the consumer needs no lookup. */
  oldUsername: string;
  newUsername: string;
  propagation: UsernamePropagation;
}
