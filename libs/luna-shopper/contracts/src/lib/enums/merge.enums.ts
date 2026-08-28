/**
 * Account merge enums (plan 0008, section 2). A merge reassigns one zone's data
 * from a source account to a target account and requires owner approval. String
 * values are the wire format and must stay stable.
 */

/** Lifecycle of a per zone merge request. */
export enum MergeRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}
