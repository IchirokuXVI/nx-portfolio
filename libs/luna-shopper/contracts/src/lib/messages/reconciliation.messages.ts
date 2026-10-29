/**
 * Reconciliation queries the cleanup jobs use (plan 0011, section 3). Core is the
 * authority on zone membership; the auth orphan-user reaper asks core which of its
 * aged temporary users hold no membership before deleting them, so the two sides
 * never disagree on whether a temporary account is truly abandoned.
 */
export const RECONCILIATION_PATTERNS = {
  /** Given candidate userIds, return the subset that hold NO zone membership. */
  usersWithoutMemberships: 'core.usersWithoutMemberships',
  /**
   * Given candidate userIds, return the subset auth still holds (plan 0232,
   * section 7): a person in `users` or an operator in `admin_users`, because
   * core stores both in the same actor columns. The release task that cleans
   * what earlier deletions left in core and catalog asks it, at most
   * {@link EXISTING_USER_IDS_MAX} ids at a time.
   */
  existingUserIds: 'auth.existingUserIds',
} as const;

/** The most ids one `auth.existingUserIds` request may carry (plan 0232). */
export const EXISTING_USER_IDS_MAX = 500;

export type ReconciliationPattern =
  (typeof RECONCILIATION_PATTERNS)[keyof typeof RECONCILIATION_PATTERNS];

export interface UsersWithoutMembershipsRequest {
  userIds: string[];
}

export interface UsersWithoutMembershipsResponse {
  /** The subset of the input that has no zone membership at all. */
  userIds: string[];
}

export interface ExistingUserIdsRequest {
  userIds: string[];
}

export interface ExistingUserIdsResponse {
  /** The subset of the input that is still a user or an operator in auth. */
  userIds: string[];
}
