import { LineApprovalStatus, LineStatus, ListRole } from '../enums/list.enums';
import { RealtimeEvent } from '../events/realtime.events';
import {
  COMMENT_PATTERNS,
  LINE_PATTERNS,
  LIST_PATTERNS,
} from './list.messages';

describe('list contracts', () => {
  it('pins the enum wire values', () => {
    expect(ListRole.READER).toBe('READER');
    expect(ListRole.WRITER).toBe('WRITER');
    expect(LineApprovalStatus.APPROVED).toBe('APPROVED');
    expect(LineApprovalStatus.REJECTED).toBe('REJECTED');
    expect(LineStatus.READY).toBe('READY');
    expect(LineStatus.NOT_AVAILABLE).toBe('NOT_AVAILABLE');
  });

  it('pins the message subjects', () => {
    expect(LIST_PATTERNS.create).toBe('list.create');
    expect(LIST_PATTERNS.setAccess).toBe('list.setAccess');
    expect(LINE_PATTERNS.add).toBe('line.add');
    expect(LINE_PATTERNS.reorder).toBe('line.reorder');
    expect(COMMENT_PATTERNS.add).toBe('comment.add');
  });

  it('pins the realtime event subjects', () => {
    expect(RealtimeEvent.ListCreated).toBe('list.created');
    expect(RealtimeEvent.LineAdded).toBe('line.added');
    expect(RealtimeEvent.CommentAdded).toBe('comment.added');
  });
});
