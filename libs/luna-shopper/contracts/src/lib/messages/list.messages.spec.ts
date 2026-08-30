import {
  CommentTranscription,
  LineApprovalStatus,
  LineStatus,
  ListPermission,
} from '../enums/list.enums';
import { RealtimeEvent } from '../events/realtime.events';
import {
  baseContentType,
  COMMENT_PATTERNS,
  LINE_PATTERNS,
  LIST_PATTERNS,
  VOICE_COMMENT_CONTENT_TYPES,
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
    expect(COMMENT_PATTERNS.addVoice).toBe('comment.addVoice');
    expect(COMMENT_PATTERNS.getAudio).toBe('comment.getAudio');
    expect(COMMENT_PATTERNS.setTranscription).toBe('comment.setTranscription');
  });

  it('pins the realtime event subjects', () => {
    expect(RealtimeEvent.ListCreated).toBe('list.created');
    expect(RealtimeEvent.ListMyAccessChanged).toBe('list.myAccessChanged');
    expect(RealtimeEvent.LineAdded).toBe('line.added');
    expect(RealtimeEvent.CommentAdded).toBe('comment.added');
    expect(RealtimeEvent.CommentUpdated).toBe('comment.updated');
  });

  it('pins the transcription states, which are drawn differently', () => {
    // PENDING and FAILED look the same on screen for about three seconds and
    // completely different after a minute (plan 0045, section 4.2), so a client
    // has to be able to tell them apart from the value alone.
    expect(CommentTranscription.PENDING).toBe('PENDING');
    expect(CommentTranscription.READY).toBe('READY');
    expect(CommentTranscription.FAILED).toBe('FAILED');
    expect(CommentTranscription.UNAVAILABLE).toBe('UNAVAILABLE');
  });

  it('accepts what browsers actually record in', () => {
    // Chrome gives WebM/Opus and will not negotiate Ogg, Firefox gives Ogg/Opus,
    // Safari gives MP4/AAC. Losing any one of the three loses a whole browser.
    expect(VOICE_COMMENT_CONTENT_TYPES).toContain('audio/webm');
    expect(VOICE_COMMENT_CONTENT_TYPES).toContain('audio/ogg');
    expect(VOICE_COMMENT_CONTENT_TYPES).toContain('audio/mp4');
  });

  it('strips parameters before matching a content type', () => {
    // What a browser puts on the part is the negotiated type with its codec, and
    // matching that string against the list would refuse every real recording.
    expect(baseContentType('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(baseContentType('AUDIO/OGG; codecs="opus"')).toBe('audio/ogg');
    expect(baseContentType('audio/mp4')).toBe('audio/mp4');
  });
});
