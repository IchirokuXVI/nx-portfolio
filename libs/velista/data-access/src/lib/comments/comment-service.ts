import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type { Comment, Page } from '@portfolio/velista/models';
import { CommentApi } from './comment-api';

/**
 * What people say about one line.
 *
 * A comment still cannot be edited or deleted anywhere in the API, which is worth
 * knowing before designing a sheet that offers either. What plan 0045 added is a
 * second way to *say* one and a way to play it back, not a way to change one: a
 * recording is as immutable as the text beside it, which is what lets the playback
 * route cache immutably.
 *
 * **A reader may comment.** `comment.add` requires only `requireApproved` on the zone,
 * not write access on the list, so the comment affordance stays on every row even in
 * the read only state. That is the backend's choice rather than this client's, and it
 * is the one thing somebody with read access can actually do (section 3.2).
 */
export interface CommentServiceI {
  /**
   * One line's comments (`GET /v1/lines/:id/comments`), newest first.
   *
   * No `order` parameter: the route takes a `ListQueryDto` whose `order` core ignores
   * for comments, so asking for one would be a parameter that reads as a choice and is
   * not one.
   */
  listComments(
    lineId: string,
    options?: { cursor?: string; limit?: number }
  ): Promise<Page<Comment>>;

  /** Say something (`POST /v1/lines/:id/comments`). */
  addComment(lineId: string, body: string): Promise<Comment>;

  /**
   * Say it instead of typing it (`POST /v1/lines/:id/comments/voice`).
   *
   * `durationSeconds` is what the recorder measured. The server stores it to draw
   * a row before the file is fetched and never trusts it for anything: the byte
   * count is the only thing it enforces on.
   *
   * It answers with a comment that has a recording and no body yet. The transcript
   * lands afterwards, as `comment.updated` on the socket.
   */
  addVoiceComment(
    lineId: string,
    recording: Blob,
    durationSeconds: number
  ): Promise<Comment>;

  /**
   * An object URL for a comment's recording (`GET /v1/comments/:id/audio`).
   *
   * The caller **owns the URL and must revoke it**: it holds the whole blob in
   * memory until it does, and a thread somebody scrolls through leaks one per
   * played comment otherwise.
   */
  commentAudioUrl(commentId: string): Promise<string>;
}

/**
 * Inject this, typed as the interface, never a concrete class.
 *
 * The default is the real gateway, matching every other service token here.
 */
export const COMMENT_SERVICE = serviceToken<CommentServiceI>(
  'COMMENT_SERVICE',
  () => inject(CommentApi)
);
