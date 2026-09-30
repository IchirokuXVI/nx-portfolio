import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { anonymous } from '../auth/http-context';
import { GatewayError } from '../errors';
import { toShopMapRead } from '../mapping/shop-map-mappers';
import type { ShopMapAnswer, ShopMapServiceI } from './shop-map-service';

/**
 * A shop's map over HTTP. The default behind `SHOP_MAP_SERVICE`.
 *
 * Provided by the app layer and never at root (rule D5): it depends on the
 * `HttpClient` the app configures.
 */
@Injectable()
export class ShopMapApi implements ShopMapServiceI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);

  async map(locationId: string): Promise<ShopMapAnswer> {
    try {
      const body = await firstValueFrom(
        this._http.get<unknown>(
          this._urls.gateway(
            `/v1/catalog/locations/${encodeURIComponent(locationId)}/map`
          ),
          // Sent without a token: the route takes no account (backend `0168`), so a
          // guest's missing token, or an expired one, must not start a refresh for a
          // read that never needed it.
          { context: anonymous('catalog.locationMap') }
        )
      );
      return { read: toShopMapRead(body), body };
    } catch (error) {
      // An unknown shop has no map, and asking again would not give it one.
      return error instanceof GatewayError && error.code === 'not_found'
        ? { read: { kind: 'none' }, body: null }
        : { read: { kind: 'failed' }, body: null };
    }
  }
}
