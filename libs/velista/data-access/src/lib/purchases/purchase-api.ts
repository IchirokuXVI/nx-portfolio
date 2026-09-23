import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  PURCHASE_ROWS_PAGE_SIZE,
  purchasePathKind,
  PURCHASES_PAGE_SIZE,
  type Page,
  type PurchaseEntry,
  type PurchaseEntryPage,
  type PurchaseEntryRow,
} from '@portfolio/velista/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { operation } from '../auth/http-context';
import { toPage } from '../mapping/mappers';
import { toPurchaseEntryPage, toPurchaseEntryRow } from './purchase-mappers';
import type { PurchaseServiceI } from './purchase-service';

/**
 * The history, over HTTP. The default behind `PURCHASE_SERVICE`, provided by the app
 * layer and never at root (rule D5).
 */
@Injectable()
export class PurchaseApi implements PurchaseServiceI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);

  async sessions(cursor?: string): Promise<PurchaseEntryPage> {
    const body = await firstValueFrom(
      this._http.get<unknown>(this._urls.gateway('/v1/purchases/sessions'), {
        params: pageParams(cursor, PURCHASES_PAGE_SIZE),
        context: operation('purchases.sessions'),
      })
    );

    return toPurchaseEntryPage(body);
  }

  async rows(
    entry: Pick<PurchaseEntry, 'kind' | 'id'>,
    cursor?: string
  ): Promise<Page<PurchaseEntryRow>> {
    const body = await firstValueFrom(
      this._http.get<unknown>(
        this._urls.gateway(
          `/v1/purchases/sessions/${purchasePathKind(entry.kind)}/${encodeURIComponent(entry.id)}/rows`
        ),
        {
          params: pageParams(cursor, PURCHASE_ROWS_PAGE_SIZE),
          context: operation('purchases.rows'),
        }
      )
    );

    return toPage(body, toPurchaseEntryRow);
  }
}

function pageParams(cursor: string | undefined, limit: number): HttpParams {
  let params = new HttpParams().set('limit', String(limit));
  if (cursor !== undefined) {
    params = params.set('cursor', cursor);
  }
  return params;
}
