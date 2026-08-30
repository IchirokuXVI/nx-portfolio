import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  AddCommentRequest,
  Comment,
  Page,
} from '@portfolio/velista/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { operation } from '../auth/http-context';
import { toComment, toPage } from '../mapping/mappers';
import { required } from '../mapping/required';
import type { CommentServiceI } from './comment-service';

/**
 * Comments, over HTTP. The default behind `COMMENT_SERVICE`.
 *
 * Provided by the app layer and never at root (rule D5): it depends on the `HttpClient`
 * the app configures.
 */
@Injectable()
export class CommentApi implements CommentServiceI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);

  async listComments(
    lineId: string,
    options?: { cursor?: string; limit?: number }
  ): Promise<Page<Comment>> {
    let params = new HttpParams();
    if (options?.cursor !== undefined) {
      params = params.set('cursor', options.cursor);
    }
    if (options?.limit !== undefined) {
      params = params.set('limit', clampLimit(options.limit));
    }

    const body = await firstValueFrom(
      this._http.get<unknown>(this._comments(lineId), {
        params,
        context: operation('comments.list'),
      })
    );

    return toPage(body, toComment);
  }

  async addComment(lineId: string, body: string): Promise<Comment> {
    const request: AddCommentRequest = { body };

    const answer = await firstValueFrom(
      this._http.post<unknown>(this._comments(lineId), request, {
        context: operation('comments.add'),
      })
    );

    return required(toComment(answer), 'comments.add');
  }

  /**
   * Leave a comment that is a recording (`POST /v1/lines/:id/comments/voice`).
   *
   * `FormData` and not a JSON body with base64 in it: base64 inflates the upload
   * by a third on the one leg that actually costs somebody something, which is a
   * phone on mobile data.
   *
   * The `Content-Type` is deliberately **not** set. The browser writes it itself
   * with the multipart boundary it generated, and a hand written header without a
   * boundary is a body no server can parse.
   *
   * The comment comes back with a recording and, usually, no body: the transcript
   * is filled in afterwards and arrives on the socket as `comment.updated`. So
   * this resolving is not the end of the send from the reader's point of view,
   * only the end of the wait.
   */
  async addVoiceComment(
    lineId: string,
    recording: Blob,
    durationSeconds: number
  ): Promise<Comment> {
    const form = new FormData();
    // The filename is required by the multipart format and read by nobody: the
    // server takes the content type off the part and never looks at the name.
    form.append('recording', recording, 'comment');
    form.append('durationSeconds', String(Math.round(durationSeconds)));

    const answer = await firstValueFrom(
      this._http.post<unknown>(`${this._comments(lineId)}/voice`, form, {
        context: operation('comments.addVoice'),
      })
    );

    return required(toComment(answer), 'comments.addVoice');
  }

  /**
   * Fetch a comment's recording as something an `audio` element can play.
   *
   * It goes through `HttpClient` rather than being handed to the element as a URL,
   * because the route is gated on `READ` of the list and an `audio` element cannot
   * carry an `Authorization` header. So the bytes are fetched with the token the
   * interceptor attaches and wrapped in an object URL, which the element can play
   * and the caller must revoke.
   *
   * Called **when play is pressed** and never on render, which is the property
   * plan 0039 section 4 rests on: a thread with fifteen voice comments downloads
   * nothing until somebody plays one.
   */
  async commentAudioUrl(commentId: string): Promise<string> {
    const blob = await firstValueFrom(
      this._http.get(this._urls.gateway(`/v1/comments/${commentId}/audio`), {
        responseType: 'blob',
        context: operation('comments.audio'),
      })
    );

    return URL.createObjectURL(blob);
  }

  private _comments(lineId: string): string {
    return this._urls.gateway(`/v1/lines/${lineId}/comments`);
  }
}

function clampLimit(limit: number): string {
  return String(Math.min(100, Math.max(1, Math.trunc(limit))));
}
