import {
  LineApprovalStatus,
  LineStatus,
  ListPermission,
} from '../enums/list.enums';
import { RealtimeEvent } from '../events/realtime.events';
import {
  COMMENT_PATTERNS,
  LINE_PATTERNS,
  LIST_PATTERNS,
} from './list.messages';

describe('list contracts', () => {
  it('pins the enum wire values', () => {
    expect(ListPermission.READ).toBe('READ');
    expect(ListPermission.WRITE).toBe('WRITE');
    expect(ListPermission.DECIDE).toBe('DECIDE');
    expect(ListPermission.MANAGE).toBe('MANAGE');
    expect(LineApprovalStatus.APPROVED).toBe('APPROVED');
    expect(LineApprovalStatus.REJECTED).toBe('REJECTED');
    expect(LineStatus.READY).toBe('READY');
    expect(LineStatus.NOT_AVAILABLE).toBe('NOT_AVAILABLE');
  });

  it('pins the message subjects', () => {
    expect(LIST_PATTERNS.create).toBe('list.create');
    expect(LIST_PATTERNS.setAccess).toBe('list.setAccess');
    expect(LIST_PATTERNS.getAccess).toBe('list.getAccess');
    expect(LINE_PATTERNS.add).toBe('line.add');
    expect(LINE_PATTERNS.reorder).toBe('line.reorder');
    expect(COMMENT_PATTERNS.add).toBe('comment.add');
  });

  it('pins the realtime event subjects', () => {
    expect(RealtimeEvent.ListCreated).toBe('list.created');
    expect(RealtimeEvent.ListMyAccessChanged).toBe('list.myAccessChanged');
    expect(RealtimeEvent.LineAdded).toBe('line.added');
    expect(RealtimeEvent.CommentAdded).toBe('comment.added');
  });
});
