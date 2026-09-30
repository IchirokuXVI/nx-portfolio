import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  AppendShopWalkEntryRequest,
  CreateShopWalkRequest,
  ShopWalkAppendResult,
  ShopWalkSummary,
  UpdateShopWalkRequest,
} from '@portfolio/velista/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { operation } from '../auth/http-context';
import { GatewayError } from '../errors';
import { isRecord } from '../mapping/primitives';
import { required } from '../mapping/required';
import {
  toShopWalkDetail,
  toShopWalkList,
  toShopWalkLog,
  toShopWalkSummary,
  toShopWalkTimelineEntry,
} from '../mapping/shop-walk-mappers';
import type {
  ShopWalkListRead,
  ShopWalkLogRead,
  ShopWalkRead,
  ShopWalkServiceI,
} from './shop-walk-service';

/**
 * A shop's walks over HTTP. The default behind `SHOP_WALK_SERVICE`.
 *
 * Provided by the app layer and never at root (rule D5): it depends on the
 * `HttpClient` the app configures.
 */
@Injectable()
export class ShopWalkApi implements ShopWalkServiceI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);

  async list(locationId: string): Promise<ShopWalkListRead> {
    try {
      const body = await this._get(
        `/v1/catalog/locations/${encodeURIComponent(locationId)}/walks`,
        'catalog.walks'
      );
      const walks = toShopWalkList(body);
      return walks === null ? { kind: 'failed' } : { kind: 'walks', walks };
    } catch (error) {
      return missingOrFailed(error);
    }
  }

  async walk(walkId: string): Promise<ShopWalkRead> {
    try {
      const detail = toShopWalkDetail(
        await this._get(this._walk(walkId), 'catalog.walk')
      );
      return detail === null ? { kind: 'failed' } : { kind: 'walk', detail };
    } catch (error) {
      return missingOrFailed(error);
    }
  }

  async log(walkId: string, fromSeq?: number): Promise<ShopWalkLogRead> {
    try {
      const query =
        fromSeq === undefined || fromSeq <= 0 ? '' : `?fromSeq=${fromSeq}`;
      const log = toShopWalkLog(
        await this._get(`${this._walk(walkId)}/log${query}`, 'catalog.walkLog')
      );
      return log === null ? { kind: 'failed' } : { kind: 'log', log };
    } catch (error) {
      return missingOrFailed(error);
    }
  }

  async create(locationId: string, name: string): Promise<ShopWalkSummary> {
    const request: CreateShopWalkRequest = { name };
    const body = await firstValueFrom(
      this._http.post<unknown>(
        this._urls.gateway(
          `/v1/catalog/locations/${encodeURIComponent(locationId)}/walks`
        ),
        request,
        { context: operation('catalog.walkCreate') }
      )
    );
    return required(toShopWalkSummary(body), 'catalog.walkCreate');
  }

  async update(
    walkId: string,
    change: UpdateShopWalkRequest
  ): Promise<ShopWalkSummary> {
    const request: UpdateShopWalkRequest = {
      ...(change.name !== undefined ? { name: change.name } : {}),
      ...(change.shown !== undefined ? { shown: change.shown } : {}),
    };
    const body = await firstValueFrom(
      this._http.patch<unknown>(this._walk(walkId), request, {
        context: operation('catalog.walkUpdate'),
      })
    );
    return required(toShopWalkSummary(body), 'catalog.walkUpdate');
  }

  async remove(walkId: string): Promise<void> {
    await firstValueFrom(
      this._http.delete<unknown>(this._walk(walkId), {
        context: operation('catalog.walkDelete'),
      })
    );
  }

  async append(
    walkId: string,
    entry: AppendShopWalkEntryRequest
  ): Promise<ShopWalkAppendResult> {
    const body = await firstValueFrom(
      this._http.post<unknown>(`${this._walk(walkId)}/entries`, entry, {
        context: operation('catalog.walkAppend'),
      })
    );
    const record = isRecord(body) ? body : {};
    const walk = toShopWalkSummary(record['walk']);
    const answered = toShopWalkTimelineEntry(record['entry']);
    return {
      walk: required(walk, 'catalog.walkAppend'),
      entry: required(answered, 'catalog.walkAppend'),
      replayed: record['replayed'] === true,
    };
  }

  private _walk(walkId: string): string {
    return this._urls.gateway(
      `/v1/catalog/walks/${encodeURIComponent(walkId)}`
    );
  }

  private _get(path: string, name: string): Promise<unknown> {
    return firstValueFrom(
      this._http.get<unknown>(
        path.startsWith('/') ? this._urls.gateway(path) : path,
        { context: operation(name) }
      )
    );
  }
}

/** An unknown or deleted walk or shop is missing; anything else did not answer. */
function missingOrFailed(
  error: unknown
): { readonly kind: 'missing' } | { readonly kind: 'failed' } {
  return error instanceof GatewayError && error.code === 'not_found'
    ? { kind: 'missing' }
    : { kind: 'failed' };
}
