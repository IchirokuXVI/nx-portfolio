import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type { Comment, Page } from '@portfolio/velista/models';
import { CommentApi } from './comment-api';

/**
 * What people say about one line.
 *
 * Two operations and there will not be a third: a comment cannot be edited or deleted
 * anywhere in the API, which is worth knowing before designing a sheet that offers
 * either.
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
