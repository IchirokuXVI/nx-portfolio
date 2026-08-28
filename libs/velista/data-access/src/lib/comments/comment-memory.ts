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
      id:
        typeof crypto?.randomUUID === 'function'
          ? crypto.randomUUID()
          : `cm-${Math.random().toString(36).slice(2, 10)}`,
      lineId,
      authorUserId: SEED_USER_ID,
      body,
      createdAt: new Date(),
    };

    this._byLine.update((current) =>
      new Map(current).set(lineId, [
        ...(current.get(lineId) ?? []),
        comment,
      ])
    );

    return comment;
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
    comment('cm-01', 'ln-w-01', 'user-toni', 'The big one, not the small one', 0),
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
  return { id, lineId, authorUserId, body, createdAt: at(minutes) };
}

function memoryFailure(code: GatewayError['code']): GatewayError {
  return new GatewayError({
    code,
    status: code === 'forbidden' ? 403 : 400,
    correlationId: `memory-${Math.random().toString(36).slice(2, 10)}`,
    detail: 'produced by CommentMemory, no request was sent',
  });
}
