import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  tripPathKind,
  type Page,
  type TripKind,
  type TripPage,
  type TripRow,
} from '@portfolio/velista/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { operation } from '../auth/http-context';
import { toPage } from '../mapping/mappers';
import { toTripPage, toTripRow } from './trip-mappers';
import type { TripServiceI } from './trip-service';

/**
 * Trips, over HTTP. The default behind `TRIP_SERVICE`, provided by the app layer and
 * never at root (rule D5).
 */
@Injectable()
export class TripApi implements TripServiceI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);

  async listTrips(
    listId: string,
    options?: { cursor?: string; limit?: number }
  ): Promise<TripPage> {
    const body = await firstValueFrom(
      this._http.get<unknown>(this._urls.gateway(`/v1/lists/${listId}/trips`), {
        params: pageParams(options),
        context: operation('lists.trips'),
      })
    );

    return toTripPage(body);
  }

  async listTripRows(
    listId: string,
    kind: TripKind,
    tripId: string,
    options?: { cursor?: string; limit?: number }
  ): Promise<Page<TripRow>> {
    const body = await firstValueFrom(
      this._http.get<unknown>(
        this._urls.gateway(
          `/v1/lists/${listId}/trips/${tripPathKind(kind)}/${encodeURIComponent(tripId)}/rows`
        ),
        {
          params: pageParams(options),
          context: operation('lists.tripRows'),
        }
      )
    );

    return toPage(body, toTripRow);
  }
}

/** Validated to [1, 100] by the gateway, and out of range is a 400 rather than a clamp. */
function pageParams(options?: { cursor?: string; limit?: number }): HttpParams {
  let params = new HttpParams();
  if (options?.cursor !== undefined) {
    params = params.set('cursor', options.cursor);
  }
  if (options?.limit !== undefined) {
    params = params.set(
      'limit',
      String(Math.min(100, Math.max(1, Math.trunc(options.limit))))
    );
  }
  return params;
}
