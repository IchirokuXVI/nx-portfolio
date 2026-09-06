import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  AddLineQuantityRequest,
  AddLineRequest,
  AlsoOnVm,
  Line,
  LineApprovalStatus,
  LineOrder,
  LineSettlement,
  Page,
  ReorderLinesRequest,
  SetLineApprovalRequest,
  SettleLineRequest,
  SettlementOutcome,
  UpdateLineRequest,
} from '@portfolio/velista/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { operation } from '../auth/http-context';
import {
  toAlsoOnPlace,
  toDeletedId,
  toLine,
  toLineSettlement,
  toPage,
} from '../mapping/mappers';
import { isRecord, mapArray } from '../mapping/primitives';
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
    quantity?: number,
    itemIds?: readonly string[]
  ): Promise<Line> {
    // Built as the request type rather than spread from anything, because the
    // gateway's pipe runs with `forbidNonWhitelisted` and an unexpected property is a
    // 400. `quantity` is omitted rather than sent as 1, so the server's own default
    // stays the single source of it.
    //
    // `itemIds` is omitted rather than sent empty for the same reason, and there is
    // no difference between the two on the server: a free text line is what an
    // absent set means, and it stays first class (plan 0043, section 6).
    const request: AddLineRequest = {
      content,
      ...(quantity === undefined ? {} : { quantity }),
      ...(itemIds === undefined || itemIds.length === 0 ? {} : { itemIds }),
    };

    const body = await firstValueFrom(
      this._http.post<unknown>(`${this._list(listId)}/lines`, request, {
        context: operation('lines.add'),
      })
    );

    // The route answers what the add did, not the line alone (plan 0091): it may
    // have raised a line the list already held rather than created one. Only the
    // line is read here, because the store upserts by id, so a merge lands on the
    // screen as the existing row moving rather than a new row appearing.
    const record = body as Record<string, unknown> | null;
    return required(toLine(record?.['line']), 'lines.add');
  }

  async updateLine(
    lineId: string,
    changes: {
      content?: string;
      quantity?: number;
      itemIds?: readonly string[];
      adoptItemIds?: readonly string[];
    }
  ): Promise<Line> {
    const request: UpdateLineRequest = {};
    if (changes.content !== undefined) {
      (request as { content?: string }).content = changes.content;
    }
    if (changes.quantity !== undefined) {
      (request as { quantity?: number }).quantity = changes.quantity;
    }
    // An empty array is **sent**, unlike on an add: there it means "say nothing
    // about products", here it means "clear the set back to free text", and the
    // server tells them apart by absence.
    if (changes.itemIds !== undefined) {
      (request as { itemIds?: readonly string[] }).itemIds = changes.itemIds;
    }
    // Sent only when there is something to adopt, and never as an empty array:
    // adopting nothing is not a gesture, and a field that was always present would
    // make every ordinary edit look like one (backend plan 0070, section 9).
    if (changes.adoptItemIds !== undefined) {
      (request as { adoptItemIds?: readonly string[] }).adoptItemIds =
        changes.adoptItemIds;
    }

    const body = await firstValueFrom(
      this._http.patch<unknown>(this._line(lineId), request, {
        context: operation('lines.update'),
      })
    );

    return required(toLine(body), 'lines.update');
  }

  async addQuantity(lineId: string, delta: number): Promise<Line> {
    const request: AddLineQuantityRequest = { delta };

    const body = await firstValueFrom(
      this._http.post<unknown>(`${this._line(lineId)}/quantity`, request, {
        context: operation('lines.addQuantity'),
      })
    );

    return required(toLine(body), 'lines.addQuantity');
  }

  async settle(
    lineId: string,
    outcome: SettlementOutcome,
    options?: { quantity?: number; itemId?: string }
  ): Promise<{ line: Line; settlement: LineSettlement }> {
    // `quantity` is refused outright on a trip that found nothing, so it is
    // dropped here rather than sent and rejected: the whitelist would answer 400
    // for a field the caller never meant to set.
    const request: SettleLineRequest = {
      outcome,
      ...(outcome === 'NOT_AVAILABLE' || options?.quantity === undefined
        ? {}
        : { quantity: options.quantity }),
      ...(options?.itemId === undefined ? {} : { itemId: options.itemId }),
    };

    const body = await firstValueFrom(
      this._http.post<unknown>(`${this._line(lineId)}/settle`, request, {
        context: operation('lines.settle'),
      })
    );

    const record = body as Record<string, unknown> | null;
    return {
      line: required(toLine(record?.['line']), 'lines.settle'),
      settlement: required(
        toLineSettlement(record?.['settlement']),
        'lines.settle'
      ),
    };
  }

  async listSettlements(
    lineId: string,
    options?: { cursor?: string; limit?: number }
  ): Promise<Page<LineSettlement>> {
    return this._settlements(
      `${this._line(lineId)}/settlements`,
      'lines.settlements',
      options
    );
  }

  async listItemSettlements(
    itemId: string,
    options?: { cursor?: string; limit?: number }
  ): Promise<Page<LineSettlement>> {
    return this._settlements(
      this._urls.gateway(`/v1/items/${itemId}/settlements`),
      'lines.itemSettlements',
      options
    );
  }

  /**
   * Which other lists still want a product (backend plan 0053, section 3).
   *
   * Mapped from `unknown` like every other read here (rule D4), and the mapping is
   * where `hasMore` stops being optional: the server sends it, and a client that let
   * it be undefined would silently never draw the "and more" it exists for.
   */
  async listsHoldingItem(
    itemId: string,
    options?: { excludeListId?: string }
  ): Promise<AlsoOnVm> {
    let params = new HttpParams();
    if (options?.excludeListId !== undefined) {
      params = params.set('excludeListId', options.excludeListId);
    }

    const body = await firstValueFrom(
      this._http.get<unknown>(
        this._urls.gateway(`/v1/items/${itemId}/lists`),
        { params, context: operation('lines.holdingLists') }
      )
    );

    return isRecord(body)
      ? {
          places: mapArray(body['lists'], toAlsoOnPlace),
          hasMore: body['hasMore'] === true,
        }
      : { places: [], hasMore: false };
  }

  /**
   * Both history reads, which differ only in their URL and their label.
   *
   * Collapsed into one helper where {@link _list} and {@link _line} deliberately
   * are not: those two stay apart because they say something about which id a
   * route needs, and these two say nothing except that a page of settlements is
   * a page of settlements.
   */
  private async _settlements(
    url: string,
    label: string,
    options?: { cursor?: string; limit?: number }
  ): Promise<Page<LineSettlement>> {
    let params = new HttpParams();
    if (options?.cursor !== undefined) {
      params = params.set('cursor', options.cursor);
    }
    if (options?.limit !== undefined) {
      params = params.set('limit', clampLimit(options.limit));
    }

    const body = await firstValueFrom(
      this._http.get<unknown>(url, { params, context: operation(label) })
    );

    return toPage(body, toLineSettlement);
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
