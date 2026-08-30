import {
  LineApprovalStatus,
  LineStatus,
  ListPermission,
} from '../enums/list.enums';
import { RealtimeEvent } from '../events/realtime.events';
import {
  COMMENT_PATTERNS,
  LINE_BATCH_MAX_ITEMS,
  LINE_PATTERNS,
  LINE_QUANTITY_MAX,
  LINE_QUANTITY_MIN,
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
    expect(LINE_PATTERNS.addMany).toBe('line.addMany');
    expect(LINE_PATTERNS.addQuantity).toBe('line.addQuantity');
    expect(LINE_PATTERNS.reorder).toBe('line.reorder');
    expect(COMMENT_PATTERNS.add).toBe('comment.add');
  });

  it('pins the quantity bounds, which the gateway DTOs and core now share', () => {
    // Plan 0040, section 3.5: the ceiling used to exist at exactly one layer, and
    // a delta is computed inside core, so core is now the only place that can
    // check the result. Two files stating the same number is how they disagree.
    expect(LINE_QUANTITY_MIN).toBe(1);
    expect(LINE_QUANTITY_MAX).toBe(100000);
    expect(LINE_BATCH_MAX_ITEMS).toBe(50);
  });

  it('pins the realtime event subjects', () => {
    expect(RealtimeEvent.ListCreated).toBe('list.created');
    expect(RealtimeEvent.ListMyAccessChanged).toBe('list.myAccessChanged');
    expect(RealtimeEvent.LineAdded).toBe('line.added');
    expect(RealtimeEvent.CommentAdded).toBe('comment.added');
  });
});
