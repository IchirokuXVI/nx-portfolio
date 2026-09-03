import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  LocationPreference,
  Page,
  Shop,
  ShopChainSummary,
} from '@portfolio/velista/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { operation } from '../auth/http-context';
import { toPage } from '../mapping/mappers';
import { mapArray } from '../mapping/primitives';
import { toShop, toShopChainSummary } from '../mapping/shop-mappers';
import type { ShopQuery, ShopServiceI } from './shop-service';

/**
 * The shops in a profile's postal codes, over HTTP. The default behind
 * {@link SHOP_SERVICE}.
 *
 * Provided by the app layer and never at root (rule D5): it depends on the `HttpClient`
 * the app configures.
 *
 * One service over two of the gateway's areas, like `ShoppingProfileApi` beside it: the
 * two reads are catalog's and the write is core's. That is a fact about the screen rather
 * than about the transport, and both are the same base URL through the same client.
 */
@Injectable()
export class ShopApi implements ShopServiceI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);

  async summarizeChains(
    profileId: string
  ): Promise<readonly ShopChainSummary[]> {
    const body = await firstValueFrom(
      this._http.get<unknown>(this._urls.gateway('/v1/catalog/shops/summary'), {
        params: new HttpParams()
          .set('profileId', profileId)
          .set('includeExcluded', true),
        context: operation('catalog.shopSummary'),
      })
    );

    // A named object rather than a page, so there is no cursor to follow: the server
    // answers every chain in the codes at once (backend plan 0068, section 3.1).
    return mapArray(
      (body as { chains?: unknown } | null)?.chains,
      toShopChainSummary
    );
  }

  async searchShops(query: ShopQuery): Promise<Page<Shop>> {
    let params = new HttpParams()
      .set('profileId', query.profileId)
      // Never optional here. This is the screen that edits refusals, and a row it cannot
      // see is a row nobody can switch back on (backend plan 0068, section 6).
      .set('includeExcluded', true);

    if (query.supermarketId !== undefined) {
      params = params.set('supermarketId', query.supermarketId);
    }
    if (query.query !== undefined && query.query !== '') {
      params = params.set('query', query.query);
    }
    if (query.cursor !== undefined) {
      params = params.set('cursor', query.cursor);
    }
    if (query.limit !== undefined) {
      params = params.set('limit', query.limit);
    }

    const body = await firstValueFrom(
      this._http.get<unknown>(this._urls.gateway('/v1/catalog/shops'), {
        params,
        context: operation('catalog.shops'),
      })
    );

    return toPage(body, toShop);
  }

  /**
   * The bulk write, used for one shop as readily as for several.
   *
   * A `PUT` that patches, which reads oddly and is the server's own shape: each shop it
   * names is stated in full, so the body says what those shops are rather than how to
   * change them (backend plan 0064, section 5).
   */
  async setLocationPreferences(
    profileId: string,
    locations: readonly LocationPreference[]
  ): Promise<void> {
    await firstValueFrom(
      this._http.put<unknown>(
        `${this._urls.gateway('/v1/account/shopping-profiles')}/${encodeURIComponent(profileId)}/locations`,
        { locations },
        { context: operation('profiles.setLocations') }
      )
    );
  }
}
