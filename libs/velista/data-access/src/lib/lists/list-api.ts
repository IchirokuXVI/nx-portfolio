import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  ListOrder,
  Page,
  ShoppingListSummary,
} from '@portfolio/velista/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { operation } from '../auth/http-context';
import { toPage, toShoppingListSummary } from '../mapping/mappers';
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

  async createList(zoneId: string, name: string): Promise<ShoppingListSummary> {
    const body = await firstValueFrom(
      this._http.post<unknown>(
        this._lists(zoneId),
        { name },
        { context: operation('lists.create') }
      )
    );

    return required(toShoppingListSummary(body), 'lists.create');
  }

  private _lists(zoneId: string): string {
    return this._urls.gateway(`/v1/zones/${zoneId}/lists`);
  }
}

function clampLimit(limit: number): string {
  return String(Math.min(100, Math.max(1, Math.trunc(limit))));
}
