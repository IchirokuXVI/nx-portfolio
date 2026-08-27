import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  AddLineRequest,
  Line,
  LineApprovalStatus,
  LineOrder,
  LineStatus,
  Page,
  ReorderLinesRequest,
  SetLineApprovalRequest,
  SetLineStatusRequest,
  UpdateLineRequest,
} from '@portfolio/velista/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { operation } from '../auth/http-context';
import { toDeletedId, toLine, toPage } from '../mapping/mappers';
import { required } from '../mapping/required';
import type { LineServiceI } from './line-service';

/**
 * Lines, over HTTP. The default behind `LINE_SERVICE`.
 *
 * Provided by the app layer and never at root (rule D5): it depends on the `HttpClient`
 * the app configures.
 *
 * The routes sit on two controllers and this class does not hide that: reading and
 * reordering go through the list, and everything addressed at one line goes through
 * `/v1/lines/:id`. Collapsing the two into one private helper would save a line and
 * lose the fact that the second group needs no list id at all, which is exactly why
 * a comment sheet opened as a route can still write.
 */
@Injectable()
export class LineApi implements LineServiceI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);

  async listLines(
    listId: string,
    options?: { cursor?: string; limit?: number; order?: LineOrder }
  ): Promise<Page<Line>> {
    let params = new HttpParams();
    if (options?.cursor !== undefined) {
      params = params.set('cursor', options.cursor);
    }
    if (options?.limit !== undefined) {
      // Validated to [1, 100], and out of range is a 400 rather than a clamp.
      params = params.set('limit', clampLimit(options.limit));
    }
    params = params.set('order', options?.order ?? 'position');

    const body = await firstValueFrom(
      this._http.get<unknown>(`${this._list(listId)}/lines`, {
        params,
        context: operation('lines.list'),
      })
    );

    return toPage(body, toLine);
  }

  async addLine(
    listId: string,
    content: string,
    quantity?: number
  ): Promise<Line> {
    // Built as the request type rather than spread from anything, because the
    // gateway's pipe runs with `forbidNonWhitelisted` and an unexpected property is a
    // 400. `quantity` is omitted rather than sent as 1, so the server's own default
    // stays the single source of it.
    const request: AddLineRequest =
      quantity === undefined ? { content } : { content, quantity };

    const body = await firstValueFrom(
      this._http.post<unknown>(`${this._list(listId)}/lines`, request, {
        context: operation('lines.add'),
      })
    );

    return required(toLine(body), 'lines.add');
  }

  async updateLine(
    lineId: string,
    changes: { content?: string; quantity?: number }
  ): Promise<Line> {
    const request: UpdateLineRequest = {};
    if (changes.content !== undefined) {
      (request as { content?: string }).content = changes.content;
    }
    if (changes.quantity !== undefined) {
      (request as { quantity?: number }).quantity = changes.quantity;
    }

    const body = await firstValueFrom(
      this._http.patch<unknown>(this._line(lineId), request, {
        context: operation('lines.update'),
      })
    );

    return required(toLine(body), 'lines.update');
  }

  async setStatus(lineId: string, status: LineStatus): Promise<Line> {
    const request: SetLineStatusRequest = { status };

    const body = await firstValueFrom(
      this._http.post<unknown>(`${this._line(lineId)}/status`, request, {
        context: operation('lines.setStatus'),
      })
    );

    return required(toLine(body), 'lines.setStatus');
  }

  async setApproval(
    lineId: string,
    status: LineApprovalStatus
  ): Promise<Line> {
    // `approvalStatus`, not `approved`. `SetApprovalDto` takes the enum, so a boolean
    // body is refused by the whitelist before core sees it.
    const request: SetLineApprovalRequest = { approvalStatus: status };

    const body = await firstValueFrom(
      this._http.post<unknown>(`${this._line(lineId)}/approval`, request, {
        context: operation('lines.setApproval'),
      })
    );

    return required(toLine(body), 'lines.setApproval');
  }

  async reorder(
    listId: string,
    orderedLineIds: readonly string[]
  ): Promise<void> {
    const request: ReorderLinesRequest = { orderedLineIds };

    await firstValueFrom(
      this._http.post<unknown>(
        `${this._list(listId)}/lines/reorder`,
        request,
        { context: operation('lines.reorder') }
      )
    );
  }

  async deleteLine(lineId: string): Promise<string> {
    const body = await firstValueFrom(
      this._http.delete<unknown>(this._line(lineId), {
        context: operation('lines.delete'),
      })
    );

    // The acknowledgement carries the id, and a body that does not is still a delete
    // that happened: the id the caller passed is the honest answer rather than a
    // thrown error over a successful request.
    return toDeletedId(body) ?? lineId;
  }

  private _list(listId: string): string {
    return this._urls.gateway(`/v1/lists/${listId}`);
  }

  private _line(lineId: string): string {
    return this._urls.gateway(`/v1/lines/${lineId}`);
  }
}

function clampLimit(limit: number): string {
  return String(Math.min(100, Math.max(1, Math.trunc(limit))));
}
