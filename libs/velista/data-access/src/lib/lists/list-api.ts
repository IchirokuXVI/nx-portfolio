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

  async updateList(listId: string, name: string): Promise<ShoppingListSummary> {
    const request: UpdateListRequest = { name };

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
    const request: SetListAccessRequest = {
      entries: entries.map((entry) => ({
        membershipId: entry.membershipId,
        role: entry.role,
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
   * Who can read and write this list.
   *
   * Written against the route section 5.6 asks for and **not reachable today**:
   * `LIST_ACCESS_READABLE` is false, so nothing calls it and the share sheet is not
   * offered. It is here rather than absent because the shape is already decided (the
   * same `entries` the PUT accepts) and writing it now is what makes the endpoint
   * landing a one line flag change instead of a new feature.
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
