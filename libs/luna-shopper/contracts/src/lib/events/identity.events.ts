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
