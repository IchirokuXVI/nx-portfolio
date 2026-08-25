/**
 * Shopping list enums (plan 0007, section 1). A line carries two independent
 * states: whether it is approved, and its item state. String values are the wire
 * format and must stay stable.
 */

/** Per list write permission for a zone member. */
export enum ListRole {
  READER = 'READER',
  WRITER = 'WRITER',
}

/** A line's approval state (it has to be approved). */
export enum LineApprovalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

/** A line's item state, independent of approval. */
export enum LineStatus {
  PENDING = 'PENDING',
  READY = 'READY',
  NOT_AVAILABLE = 'NOT_AVAILABLE',
}
