import { Injectable, signal } from '@angular/core';
import type { Comment, Page } from '@portfolio/velista/models';
import { GatewayError } from '../errors';
import { SEED_USER_ID } from '../zones/static-zone-data';
import type { CommentServiceI } from './comment-service';

/**
 * Comments, in memory. Asked for by name, never a default.
 *
 * The seed covers the three states the sheet has: a line with a conversation on it, a
 * line with nothing said about it, and **a comment whose author is no longer in the
 * group**. The third is the one worth seeding, because it is the state section 5.4 was
 * written for and the only one that proves the fallback: `user-gone` appears on no
 * membership, so the sheet has to name them without an id and without the word Unknown.
 */
@Injectable()
export class CommentMemory implements CommentServiceI {
  private readonly _byLine = signal<ReadonlyMap<string, readonly Comment[]>>(
    new Map(Object.entries(SEED_COMMENTS))
  );

  /** Blobs by comment id, so a recording left here can be played back. */
  private readonly _audio = new Map<string, Blob>();

  private _nextWriteFails: GatewayError['code'] | null = null;

  /** Newest first, which is the order core returns and the order the sheet draws. */
  async listComments(
    lineId: string,
    options?: { cursor?: string; limit?: number }
  ): Promise<Page<Comment>> {
    const all = [...(this._byLine().get(lineId) ?? [])].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );

    const limit = options?.limit ?? 50;
    const start =
      options?.cursor === undefined ? 0 : Number(options.cursor) || 0;
    const slice = all.slice(start, start + limit);
    const end = start + slice.length;

    return {
      items: slice,
      nextCursor: end < all.length ? String(end) : null,
    };
  }

  async addComment(lineId: string, body: string): Promise<Comment> {
    const code = this._nextWriteFails;
    if (code !== null) {
      this._nextWriteFails = null;
      throw memoryFailure(code);
    }

    const comment: Comment = {
      id: newId(),
      lineId,
      authorUserId: SEED_USER_ID,
      body,
      recording: null,
      transcription: null,
      createdAt: new Date(),
    };

    this._byLine.update((current) =>
      new Map(current).set(lineId, [...(current.get(lineId) ?? []), comment])
    );

    return comment;
  }

  /**
   * A voice comment, in memory.
   *
   * It settles as `READY` with a fixed transcript rather than staying `PENDING`,
   * because there is no provider here to fill one in later and a bubble that waits
   * forever is a worse fixture than one that finished. Ask for a different outcome
   * with {@link setComments} when the state under test is the untranscribed one.
   *
   * The recording is a real blob and its object URL is real, so a player driven
   * against this memory plays silence rather than failing to load.
   */
  async addVoiceComment(
    lineId: string,
    recording: Blob,
    durationSeconds: number
  ): Promise<Comment> {
    const code = this._nextWriteFails;
    if (code !== null) {
      this._nextWriteFails = null;
      throw memoryFailure(code);
    }

    const id = newId();
    this._audio.set(id, recording);

    const comment: Comment = {
      id,
      lineId,
      authorUserId: SEED_USER_ID,
      body: 'A recording, transcribed by nothing in particular',
      recording: {
        contentType: recording.type || 'audio/webm',
        byteLength: recording.size,
        durationSeconds: durationSeconds > 0 ? durationSeconds : null,
      },
      transcription: 'READY',
      createdAt: new Date(),
    };

    this._byLine.update((current) =>
      new Map(current).set(lineId, [...(current.get(lineId) ?? []), comment])
    );

    return comment;
  }

  async commentAudioUrl(commentId: string): Promise<string> {
    const blob = this._audio.get(commentId);
    if (blob === undefined) {
      throw memoryFailure('not_found');
    }
    return URL.createObjectURL(blob);
  }

  /** Test and development seam: replace one line's comments outright. */
  setComments(lineId: string, comments: readonly Comment[]): void {
    this._byLine.update((current) => new Map(current).set(lineId, comments));
  }

  /** Test seam: the next write throws this code, once. */
  failNextWrite(code: GatewayError['code']): void {
    this._nextWriteFails = code;
  }
}

/** A fixed instant, so a fixture's timestamps do not drift with the clock. */
const T0 = new Date('2026-08-20T09:00:00.000Z').getTime();

function at(minutes: number): Date {
  return new Date(T0 + minutes * 60_000);
}

const SEED_COMMENTS: Readonly<Record<string, readonly Comment[]>> = {
  'ln-w-01': [
    comment(
      'cm-01',
      'ln-w-01',
      'user-toni',
      'The big one, not the small one',
      0
    ),
    comment('cm-02', 'ln-w-01', SEED_USER_ID, 'Got it', 12),
    // The author has left the group, so no membership names them. The row falls back
    // to a neutral word rather than to this id, and never to "Unknown" (section 5.4).
    comment('cm-03', 'ln-w-01', 'user-gone', 'They had none last week', 40),
  ],
  'ln-w-10': [
    comment('cm-04', 'ln-w-10', 'user-marta', 'Can we get this one?', 5),
  ],
};

function comment(
  id: string,
  lineId: string,
  authorUserId: string,
  body: string,
  minutes: number
): Comment {
  return {
    id,
    lineId,
    authorUserId,
    body,
    recording: null,
    transcription: null,
    createdAt: at(minutes),
  };
}

function newId(): string {
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `cm-${Math.random().toString(36).slice(2, 10)}`;
}

function memoryFailure(code: GatewayError['code']): GatewayError {
  return new GatewayError({
    code,
    status: code === 'forbidden' ? 403 : code === 'not_found' ? 404 : 400,
    correlationId: `memory-${Math.random().toString(36).slice(2, 10)}`,
    detail: 'produced by CommentMemory, no request was sent',
  });
}
