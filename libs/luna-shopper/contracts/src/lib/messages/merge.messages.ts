import type { MergeRequestStatus } from '../enums/merge.enums';
import type { PageQuery, Paginated } from '../pagination';

/**
 * Account merge message contracts (plan 0008). A user who lost their temporary
 * token registers afresh, rejoins the zone, and asks the owner to merge the old
 * account's data into the new one. The gateway calls these on core; core
 * authorizes each against its own membership table using the resolved `userId`,
 * never a body-supplied id. Merge is scoped to a single zone.
 */
export const MERGE_PATTERNS = {
  request: 'merge.request',
  approve: 'merge.approve',
  reject: 'merge.reject',
  cancel: 'merge.cancel',
  list: 'merge.list',
} as const;

/** A merge request as returned to clients. */
export interface MergeRequestView {
  id: string;
  zoneId: string;
  sourceUserId: string;
  targetUserId: string;
  requestedByUserId: string;
  status: MergeRequestStatus;
  resolvedByUserId: string | null;
}

export interface RequestMergeRequest {
  userId: string;
  zoneId: string;
  /** Account whose zone data is taken FROM (kicked from the zone on approval). */
  sourceUserId: string;
  /** Account the zone data is moved INTO. */
  targetUserId: string;
}

export interface MergeIdRequest {
  userId: string;
  mergeId: string;
}

export interface ListMergeRequestsRequest extends PageQuery {
  userId: string;
  zoneId: string;
}

export type MergeRequestPage = Paginated<MergeRequestView>;
