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

  private _comments(lineId: string): string {
    return this._urls.gateway(`/v1/lines/${lineId}/comments`);
  }
}

function clampLimit(limit: number): string {
  return String(Math.min(100, Math.max(1, Math.trunc(limit))));
}
