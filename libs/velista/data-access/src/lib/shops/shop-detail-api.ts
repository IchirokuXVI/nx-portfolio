import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { LocalizedName } from '@portfolio/velista/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { operation } from '../auth/http-context';
import { GatewayError } from '../errors';
import { toSupermarket } from '../mapping/mappers';
import { toShopDetail } from '../mapping/shop-map-mappers';
import type { ShopDetailRead, ShopDetailServiceI } from './shop-detail-service';

/**
 * One shop over HTTP. The default behind `SHOP_DETAIL_SERVICE`.
 *
 * Provided by the app layer and never at root (rule D5): it depends on the
 * `HttpClient` the app configures.
 */
@Injectable()
export class ShopDetailApi implements ShopDetailServiceI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);

  async location(locationId: string): Promise<ShopDetailRead> {
    let body: unknown;
    try {
      body = await firstValueFrom(
        this._http.get<unknown>(
          this._urls.gateway(
            `/v1/catalog/locations/${encodeURIComponent(locationId)}`
          ),
          { context: operation('catalog.location') }
        )
      );
    } catch (error) {
      return error instanceof GatewayError && error.code === 'not_found'
        ? { kind: 'missing' }
        : { kind: 'failed' };
    }

    const chainId =
      typeof body === 'object' && body !== null && 'supermarketId' in body
        ? (body as { supermarketId: unknown }).supermarketId
        : null;
    const chain =
      typeof chainId === 'string' ? await this._chain(chainId) : null;
    const shop = toShopDetail(body, chain);
    return shop === null ? { kind: 'failed' } : { kind: 'shop', shop };
  }

  private async _chain(supermarketId: string): Promise<LocalizedName | null> {
    try {
      const body = await firstValueFrom(
        this._http.get<unknown>(
          this._urls.gateway(
            `/v1/catalog/supermarkets/${encodeURIComponent(supermarketId)}`
          ),
          { context: operation('catalog.supermarket') }
        )
      );
      return toSupermarket(body)?.name ?? null;
    } catch {
      return null;
    }
  }
}
