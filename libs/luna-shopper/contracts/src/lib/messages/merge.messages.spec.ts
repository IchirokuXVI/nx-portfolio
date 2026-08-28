import { MergeRequestStatus } from '../enums/merge.enums';
import { RealtimeEvent } from '../events/realtime.events';
import { MERGE_PATTERNS } from './merge.messages';

describe('merge contracts', () => {
  it('pins the enum wire values', () => {
    expect(MergeRequestStatus.PENDING).toBe('PENDING');
    expect(MergeRequestStatus.APPROVED).toBe('APPROVED');
    expect(MergeRequestStatus.REJECTED).toBe('REJECTED');
    expect(MergeRequestStatus.CANCELLED).toBe('CANCELLED');
  });

  it('pins the message subjects', () => {
    expect(MERGE_PATTERNS.request).toBe('merge.request');
    expect(MERGE_PATTERNS.approve).toBe('merge.approve');
    expect(MERGE_PATTERNS.reject).toBe('merge.reject');
    expect(MERGE_PATTERNS.cancel).toBe('merge.cancel');
  });

  it('pins the realtime event subjects', () => {
    expect(RealtimeEvent.MergeRequested).toBe('merge.requested');
    expect(RealtimeEvent.MergeApproved).toBe('merge.approved');
    expect(RealtimeEvent.MergeRejected).toBe('merge.rejected');
  });
});
