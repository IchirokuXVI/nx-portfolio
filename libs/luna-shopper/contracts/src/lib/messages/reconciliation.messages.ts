/**
 * Reconciliation queries the cleanup jobs use (plan 0011, section 3). Core is the
 * authority on zone membership; the auth orphan-user reaper asks core which of its
 * aged temporary users hold no membership before deleting them, so the two sides
 * never disagree on whether a temporary account is truly abandoned.
 */
export const RECONCILIATION_PATTERNS = {
  /** Given candidate userIds, return the subset that hold NO zone membership. */
  usersWithoutMemberships: 'core.usersWithoutMemberships',
} as const;

export type ReconciliationPattern =
  (typeof RECONCILIATION_PATTERNS)[keyof typeof RECONCILIATION_PATTERNS];

export interface UsersWithoutMembershipsRequest {
  userIds: string[];
}

export interface UsersWithoutMembershipsResponse {
  /** The subset of the input that has no zone membership at all. */
  userIds: string[];
}
