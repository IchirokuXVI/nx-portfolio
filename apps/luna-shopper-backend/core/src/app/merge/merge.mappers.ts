import type { MergeRequestView } from '@portfolio/luna-shopper/contracts';
import type { MergeRequest } from '../entities';

/** Maps a merge request entity to the client view. */
export function toMergeRequestView(merge: MergeRequest): MergeRequestView {
  return {
    id: merge.id,
    zoneId: merge.zoneId,
    sourceUserId: merge.sourceUserId,
    targetUserId: merge.targetUserId,
    requestedByUserId: merge.requestedByUserId,
    status: merge.status,
    resolvedByUserId: merge.resolvedByUserId,
  };
}
