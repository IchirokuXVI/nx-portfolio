import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  ListAccessEntry,
  ListOrder,
  Page,
  SetListAccessRequest,
  ShoppingListSummary,
  UpdateListRequest,
} from '@portfolio/velista/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { operation } from '../auth/http-context';
import {
  toDeletedId,
  toListAccessEntries,
  toPage,
  toShoppingListSummary,
} from '../mapping/mappers';
import { required } from '../mapping/required';
import type { ListServiceI } from './list-service';

/**
 * Lists, over HTTP. The default behind `LIST_SERVICE`.
 *
 * Provided by the app layer and never at root (rule D5): it depends on the `HttpClient`
 * the app configures.
 */
@Injectable()
export class ListApi implements ListServiceI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);

  async listLists(
    zoneId: string,
    options?: { cursor?: string; limit?: number; order?: ListOrder }
  ): Promise<Page<ShoppingListSummary>> {
    let params = new HttpParams();
    if (options?.cursor !== undefined) {
      params = params.set('cursor', options.cursor);
    }
    if (options?.limit !== undefined) {
      // Validated to [1, 100], and out of range is a 400 rather than a clamp.
      params = params.set('limit', clampLimit(options.limit));
    }
    if (options?.order !== undefined) {
      params = params.set('order', options.order);
    }

    const body = await firstValueFrom(
      this._http.get<unknown>(this._lists(zoneId), {
        params,
        context: operation('lists.list'),
      })
    );

    return toPage(body, toShoppingListSummary);
  }

  async createList(
    zoneId: string,
    name: string,
    shareWithZone: boolean
  ): Promise<ShoppingListSummary> {
    const body = await firstValueFrom(
      this._http.post<unknown>(
        this._lists(zoneId),
        { name, shareWithZone },
        { context: operation('lists.create') }
      )
    );

    return required(toShoppingListSummary(body), 'lists.create');
  }

  /**
   * Rename or reconfigure, sending **only** the fields the caller named.
   *
   * Built key by key rather than spread from `changes`, because the gateway validates
   * with `forbidNonWhitelisted` and an explicit `undefined` is still an own property:
   * `{ name: undefined }` serializes to `{}` here but would carry the key through any
   * intermediate that enumerates it. This also keeps a rename from ever carrying an
   * `autoApproveLines` the person did not touch, which on this endpoint is somebody
   * else's setting being overwritten (backend plan 0037, section 3).
   */
  async updateList(
    listId: string,
    changes: UpdateListRequest
  ): Promise<ShoppingListSummary> {
    const request: UpdateListRequest = {
      ...(changes.name === undefined ? {} : { name: changes.name }),
      ...(changes.autoApproveLines === undefined
        ? {}
        : { autoApproveLines: changes.autoApproveLines }),
    };

    const body = await firstValueFrom(
      this._http.patch<unknown>(this._list(listId), request, {
        context: operation('lists.update'),
      })
    );

    return required(toShoppingListSummary(body), 'lists.update');
  }

  async deleteList(listId: string): Promise<string> {
    const body = await firstValueFrom(
      this._http.delete<unknown>(this._list(listId), {
        context: operation('lists.delete'),
      })
    );

    return toDeletedId(body) ?? listId;
  }

  async setListAccess(
    listId: string,
    entries: readonly ListAccessEntry[]
  ): Promise<ShoppingListSummary> {
    // Rebuilt field by field rather than passed through, because a mapped model is
    // never sent back (rule D4, and the note at the top of `requests.ts`). The array is
    // copied for the same reason the fields are: what goes on the wire is this
    // function's own object, not a reference into a store.
    const request: SetListAccessRequest = {
      entries: entries.map((entry) => ({
        membershipId: entry.membershipId,
        permissions: [...entry.permissions],
      })),
    };

    const body = await firstValueFrom(
      this._http.put<unknown>(`${this._list(listId)}/access`, request, {
        context: operation('lists.setAccess'),
      })
    );

    return required(toShoppingListSummary(body), 'lists.setAccess');
  }

  /**
   * What each membership may do on this list, from the route backend plan 0036
   * section 6 lands.
   *
   * `MANAGE` only, so a caller without it gets a `forbidden` here rather than an empty
   * answer, and the sheet that called it is a sheet they should not have been able to
   * open. Group staff are not in the response by construction; the sheet adds their rows
   * from `MembershipStore`.
   */
  async getListAccess(listId: string): Promise<readonly ListAccessEntry[]> {
    const body = await firstValueFrom(
      this._http.get<unknown>(`${this._list(listId)}/access`, {
        context: operation('lists.getAccess'),
      })
    );

    return toListAccessEntries(body);
  }

  private _lists(zoneId: string): string {
    return this._urls.gateway(`/v1/zones/${zoneId}/lists`);
  }

  private _list(listId: string): string {
    return this._urls.gateway(`/v1/lists/${listId}`);
  }
}

function clampLimit(limit: number): string {
  return String(Math.min(100, Math.max(1, Math.trunc(limit))));
}
