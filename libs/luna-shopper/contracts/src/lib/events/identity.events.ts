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
 * Published after auth removes a user and its personal data (plan 0011). Core
 * and catalog unlink and delete what the person left (plan 0232). Since plan
 * 0232 it travels on {@link ACCOUNT_DELETION_STREAM}, not as a plain NATS event:
 * the message body is this object as JSON. Idempotent: a redelivered event is a
 * no-op.
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

/**
 * The JetStream stream that carries `user.deleted` (plan 0232, section 5).
 *
 * Auth writes an outbox row in the delete's transaction and publishes it here,
 * waiting for the stream's ack before it deletes the row. Auth ensures the
 * stream at boot, because auth is the side that must never publish into
 * nothing. Core and catalog each own a durable consumer with explicit acks, so a
 * deletion that meets a stopped service completes when it starts again.
 */
export const ACCOUNT_DELETION_STREAM = {
  name: 'LUNA_ACCOUNT_DELETIONS',
  /** The only subject the stream captures. */
  subject: IDENTITY_EVENTS.userDeleted,
  /** File storage, kept this long. */
  maxAgeDays: 30,
  consumers: {
    core: 'core-account-deletion',
    catalog: 'catalog-account-deletion',
  },
  /** Before an unacked message is delivered again. */
  ackWaitSeconds: 60,
} as const;
