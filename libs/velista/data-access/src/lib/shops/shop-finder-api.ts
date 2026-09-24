import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { NearbyShops, RecentShop } from '@portfolio/velista/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { operation } from '../auth/http-context';
import { PARTICIPANT_SECRET_HEADER } from '../baskets/basket-api';
import { BasketSessionStore } from '../baskets/basket-session-store';
import { toNearbyShops, toRecentShops } from './shop-finder-mappers';
import type { NearbyPoint, ShopFinderServiceI } from './shop-finder-service';

/**
 * The shops near you and the ones you bought at, over HTTP. The default behind
 * `SHOP_FINDER_SERVICE`.
 *
 * Provided by the app layer and never at root (rule D5): it depends on the
 * `HttpClient` the app configures.
 *
 * ## The point goes in the body and nowhere else
 *
 * A `POST` with the coordinates in the body, never in a query string, where every
 * proxy and access log on the way would keep them. The body is built here from the
 * three numbers and nothing else, and nothing in this class holds it after the call.
 */
@Injectable()
export class ShopFinderApi implements ShopFinderServiceI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);
  private readonly _sessions = inject(BasketSessionStore);

  async nearBasket(basketId: string, point: NearbyPoint): Promise<NearbyShops> {
    // A guest's session secret when this browser holds one for the basket, and
    // otherwise the account's bearer through the ordinary interceptor. That is the
    // rule `BasketApi` keeps: a caller never chooses the credential.
    const secret = this._sessions.read(basketId)?.secret;
    const body = await firstValueFrom(
      this._http.post<unknown>(
        this._urls.gateway(
          `/v1/baskets/${encodeURIComponent(basketId)}/shops/nearby`
        ),
        bodyOf(point),
        {
          context: operation('basket.nearbyShops'),
          ...(secret
            ? {
                headers: new HttpHeaders().set(
                  PARTICIPANT_SECRET_HEADER,
                  secret
                ),
              }
            : {}),
        }
      )
    );
    return toNearbyShops(body);
  }

  async nearProfile(
    point: NearbyPoint,
    profileId?: string
  ): Promise<NearbyShops> {
    const body = await firstValueFrom(
      this._http.post<unknown>(
        this._urls.gateway('/v1/catalog/shops/nearby'),
        {
          ...bodyOf(point),
          ...(profileId === undefined ? {} : { profileId }),
        },
        { context: operation('catalog.nearbyShops') }
      )
    );
    return toNearbyShops(body);
  }

  async recentShops(): Promise<readonly RecentShop[]> {
    const body = await firstValueFrom(
      this._http.get<unknown>(this._urls.gateway('/v1/account/recent-shops'), {
        context: operation('account.recentShops'),
      })
    );
    return toRecentShops(body);
  }
}

/** The three numbers the route takes, copied out so nothing else can ride along. */
function bodyOf(point: NearbyPoint): NearbyPoint {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
    accuracyMetres: point.accuracyMetres,
  };
}
