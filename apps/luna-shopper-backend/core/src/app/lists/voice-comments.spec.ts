import type { ConfigService } from '@nestjs/config';
import {
  CommentTranscription,
  ListPermission,
  MembershipStatus,
  RealtimeEvent,
  VOICE_COMMENT_CONTENT_TYPES,
  ZoneRole,
} from '@portfolio/luna-shopper/contracts';
import type { DataSource } from 'typeorm';
import type {
  CommentAudio,
  LineComment,
  ListAccess,
  ListLine,
  ShoppingList,
} from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { CommentService } from './comment.service';
import { ListAccessService } from './list-access.service';

/**
 * A comment that carries a recording (plan 0045, section 9).
 *
 * The doubles are hand rolled in the style of `list-permissions.spec.ts`: a
 * repository is an object with the two or three methods the code under test
 * calls, and nothing pretends to be TypeORM. A mock deep enough to fake a query
 * builder is a mock that can be made to agree with anything.
 *
 * **No test here sends a byte of audio to a provider** (rule A4), and none can:
 * core holds no provider and this file constructs none. The transcript arrives
 * through `setTranscription`, which is the seam the gateway calls, and driving it
 * directly is exactly how a provider outage is reproduced.
 */

const LIST_ID = 'l1';
const ZONE_ID = 'z1';
const LINE_ID = 'li1';
const USER_ID = 'u1';
const MEMBERSHIP_ID = 'm1';
const MAX_BYTES = 2 * 1024 * 1024;

/** Base64 for `size` bytes, which is the shape the broker actually carries. */
function audioOf(size: number): string {
  return Buffer.alloc(size, 7).toString('base64');
}

interface World {
  comments: CommentService;
  events: { event: string; payload: unknown }[];
  /** Every `line_comments` row written, in order. */
  savedComments: Partial<LineComment>[];
  /** Every `comment_audio` row written, in order. */
  savedAudio: Partial<CommentAudio>[];
  /** The column list the listing query asked for, so the bytes can be shown absent. */
  selected: string[];
}

function world(
  options: {
    permissions?: ListPermission[];
    /** An existing comment `getAudio` and `setTranscription` resolve against. */
    existing?: Partial<LineComment>;
    audioRow?: Partial<CommentAudio> | null;
  } = {}
): World {
  const list = {
    id: LIST_ID,
    zoneId: ZONE_ID,
    name: 'Groceries',
    createdByUserId: 'somebody-else',
    autoApproveLines: false,
  } as ShoppingList;

  const line = { id: LINE_ID, listId: LIST_ID } as ListLine;

  const events: { event: string; payload: unknown }[] = [];
  const savedComments: Partial<LineComment>[] = [];
  const savedAudio: Partial<CommentAudio>[] = [];
  const selected: string[] = [];

  const memberships = {
    findOne: async () =>
      ({
        id: MEMBERSHIP_ID,
        zoneId: ZONE_ID,
        userId: USER_ID,
        role: ZoneRole.MEMBER,
        status: MembershipStatus.APPROVED,
      }) as never,
  };

  const accessRepo = {
    findOne: async () =>
      ({
        id: 'a1',
        listId: LIST_ID,
        membershipId: MEMBERSHIP_ID,
        permissions: options.permissions ?? [
          ListPermission.READ,
          ListPermission.WRITE,
        ],
      }) as ListAccess,
  };

  const listAccess = new ListAccessService(
    { findOne: async () => list } as never,
    accessRepo as never,
    { findOne: async () => line } as never,
    new ZoneAuthzService(memberships as never)
  );

  const existing = options.existing;

  const commentRepo = {
    findOne: async () =>
      existing === undefined
        ? null
        : ({
            id: 'c1',
            lineId: LINE_ID,
            authorUserId: USER_ID,
            body: '',
            audioContentType: 'audio/webm',
            audioByteLength: 64,
            audioDurationSeconds: 4,
            transcription: CommentTranscription.PENDING,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            ...existing,
          } as LineComment),
    save: async (row: Partial<LineComment>) => {
      savedComments.push(row);
      return {
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        ...row,
        id: row.id ?? 'c1',
      } as LineComment;
    },
    createQueryBuilder: () => {
      const qb = {
        select: (columns: string[]) => {
          selected.push(...columns);
          return qb;
        },
        where: () => qb,
        andWhere: () => qb,
        orderBy: () => qb,
        addOrderBy: () => qb,
        take: () => qb,
        getMany: async () => [],
      };
      return qb;
    },
  };

  const audioRepo = {
    findOne: async () =>
      options.audioRow === undefined
        ? ({
            commentId: 'c1',
            contentType: 'audio/webm',
            audio: Buffer.from('hello'),
          } as CommentAudio)
        : options.audioRow,
  };

  // One transaction, and it records both writes so the test can assert the
  // comment and its bytes landed together.
  const dataSource = {
    transaction: async <T>(run: (m: unknown) => Promise<T>) =>
      run({
        create: (_entity: unknown, data: unknown) => data,
        save: async (row: Record<string, unknown>) => {
          if ('audio' in row) {
            savedAudio.push(row as Partial<CommentAudio>);
            return row;
          }
          const stored = {
            ...row,
            id: 'c-new',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          };
          savedComments.push(stored);
          return stored;
        },
      }),
  } as unknown as DataSource;

  const publisher = {
    emit: (event: string, _zoneId: string, payload: unknown) =>
      events.push({ event, payload }),
    emitTo: (event: string, _audience: unknown, payload: unknown) =>
      events.push({ event, payload }),
  } as unknown as CoreEventsPublisher;

  const config = {
    getOrThrow: () => ({
      voiceComment: {
        maxBytes: MAX_BYTES,
        contentTypes: [...VOICE_COMMENT_CONTENT_TYPES],
      },
    }),
  } as unknown as ConfigService;

  const comments = new CommentService(
    commentRepo as never,
    audioRepo as never,
    dataSource,
    listAccess,
    publisher,
    config
  );

  return { comments, events, savedComments, savedAudio, selected };
}

describe('a voice comment is stored before anything is transcribed', () => {
  it('comes back playable, with a recording and no body', async () => {
    const w = world();

    const view = await w.comments.addVoice({
      userId: USER_ID,
      lineId: LINE_ID,
      audio: audioOf(4096),
      contentType: 'audio/webm;codecs=opus',
      durationSeconds: 12,
    });

    // The assertion section 4 exists for: no provider was consulted, none could
    // be, and the message exists regardless.
    expect(view.recording).toEqual({
      contentType: 'audio/webm',
      byteLength: 4096,
      durationSeconds: 12,
    });
    expect(view.body).toBe('');
    expect(view.transcription).toBe(CommentTranscription.PENDING);
  });

  it('writes the comment and its bytes in one transaction', async () => {
    const w = world();

    await w.comments.addVoice({
      userId: USER_ID,
      lineId: LINE_ID,
      audio: audioOf(1024),
      contentType: 'audio/webm',
      durationSeconds: null,
    });

    expect(w.savedAudio).toHaveLength(1);
    expect(w.savedAudio[0].audio).toBeInstanceOf(Buffer);
    expect(w.savedAudio[0].audio?.byteLength).toBe(1024);
    // Keyed on the comment that was written in the same transaction, so neither
    // can exist without the other.
    expect(w.savedAudio[0].commentId).toBe('c-new');
  });

  it('announces it to the line room like any other comment', async () => {
    const w = world();

    await w.comments.addVoice({
      userId: USER_ID,
      lineId: LINE_ID,
      audio: audioOf(512),
      contentType: 'audio/ogg;codecs=opus',
      durationSeconds: 3,
    });

    expect(w.events.map((entry) => entry.event)).toEqual([
      RealtimeEvent.CommentAdded,
    ]);
  });

  it('refuses a recording over the cap, and names the limit', async () => {
    const w = world();

    await expect(
      w.comments.addVoice({
        userId: USER_ID,
        lineId: LINE_ID,
        audio: audioOf(MAX_BYTES + 1),
        contentType: 'audio/webm',
        durationSeconds: 90,
      })
    ).rejects.toThrow(/2\.0 MB/);
  });

  it('refuses a format it cannot read, with a sentence', async () => {
    const w = world();

    await expect(
      w.comments.addVoice({
        userId: USER_ID,
        lineId: LINE_ID,
        audio: audioOf(128),
        contentType: 'video/mp4',
        durationSeconds: 2,
      })
    ).rejects.toThrow(/cannot read \(video\/mp4\)/);
  });

  it('is refused for somebody who can only read the list', async () => {
    const w = world({ permissions: [ListPermission.READ] });

    await expect(
      w.comments.addVoice({
        userId: USER_ID,
        lineId: LINE_ID,
        audio: audioOf(128),
        contentType: 'audio/webm',
        durationSeconds: 2,
      })
    ).rejects.toThrow(/not write to it/);
  });

  it('never trusts a duration, and stores null for a nonsense one', async () => {
    const w = world();

    const view = await w.comments.addVoice({
      userId: USER_ID,
      lineId: LINE_ID,
      audio: audioOf(256),
      contentType: 'audio/webm',
      durationSeconds: -5,
    });

    // Nothing authorizes on it and nothing rejects on it: the byte count is the
    // enforcement, so a malformed hint costs the row a figure and not the message.
    expect(view.recording?.durationSeconds).toBeNull();
  });
});

describe('the transcript arrives afterwards', () => {
  it('fills in the body and emits comment.updated exactly once', async () => {
    const w = world({ existing: {} });

    const view = await w.comments.setTranscription({
      userId: USER_ID,
      commentId: 'c1',
      body: '  Bring the big one  ',
      transcription: CommentTranscription.READY,
    });

    expect(view.body).toBe('Bring the big one');
    expect(view.transcription).toBe(CommentTranscription.READY);
    expect(w.events).toHaveLength(1);
    expect(w.events[0].event).toBe(RealtimeEvent.CommentUpdated);
  });

  it('leaves the message intact when the provider produced nothing', async () => {
    const w = world({ existing: {} });

    const view = await w.comments.setTranscription({
      userId: USER_ID,
      commentId: 'c1',
      body: '',
      transcription: CommentTranscription.FAILED,
    });

    // The comment still exists, still has its recording, and says which kind of
    // silence this is so the client can draw the right phrase.
    expect(view.transcription).toBe(CommentTranscription.FAILED);
    expect(view.recording).not.toBeNull();
    expect(view.body).toBe('');
  });

  it('calls a whitespace transcript what it is, rather than READY', async () => {
    const w = world({ existing: {} });

    const view = await w.comments.setTranscription({
      userId: USER_ID,
      commentId: 'c1',
      body: '   ',
      transcription: CommentTranscription.READY,
    });

    // READY with an empty body would leave the client drawing an empty bubble
    // rather than the phrase it has for exactly this.
    expect(view.transcription).toBe(CommentTranscription.FAILED);
  });

  it('only ever moves a comment out of PENDING, so a retry cannot overwrite', async () => {
    const w = world({
      existing: {
        body: 'The words that already landed',
        transcription: CommentTranscription.READY,
      },
    });

    const view = await w.comments.setTranscription({
      userId: USER_ID,
      commentId: 'c1',
      body: 'A second reading of the same audio',
      transcription: CommentTranscription.READY,
    });

    expect(view.body).toBe('The words that already landed');
    // Nothing was written and nothing was announced: a settled comment is settled.
    expect(w.savedComments).toEqual([]);
    expect(w.events).toEqual([]);
  });

  it('will not write words into somebody else’s message', async () => {
    const w = world({ existing: { authorUserId: 'somebody-else' } });

    await expect(
      w.comments.setTranscription({
        userId: USER_ID,
        commentId: 'c1',
        body: 'not mine to write',
        transcription: CommentTranscription.READY,
      })
    ).rejects.toThrow(/not your comment/);
  });
});

describe('playback', () => {
  it('answers the bytes to somebody who can read the list', async () => {
    const w = world({ existing: {}, permissions: [ListPermission.READ] });

    const audio = await w.comments.getAudio({
      userId: USER_ID,
      commentId: 'c1',
    });

    // READ and nothing else, which is the same gate as reading the comment's
    // text: there is deliberately no separate permission for a recording.
    expect(audio.contentType).toBe('audio/webm');
    expect(Buffer.from(audio.audio, 'base64').toString()).toBe('hello');
  });

  it('says a typed comment has no recording rather than answering nothing', async () => {
    const w = world({ existing: {}, audioRow: null });

    await expect(
      w.comments.getAudio({ userId: USER_ID, commentId: 'c1' })
    ).rejects.toThrow(/no recording/);
  });
});

describe('the listing query', () => {
  it('does not select the audio bytes', async () => {
    const w = world();

    await w.comments.list({ userId: USER_ID, lineId: LINE_ID });

    // Asserted on the generated column list rather than on timing, because timing
    // would pass on an empty fixture whatever the query did. The bytes live in
    // their own table and nothing but the playback route ever joins to it.
    expect(w.selected.length).toBeGreaterThan(0);
    expect(w.selected).toContain('c.audioContentType');
    expect(w.selected.some((column) => column.includes('audio.'))).toBe(false);
    expect(w.selected).not.toContain('c.audio');
  });
});
