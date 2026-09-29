import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { ShopSections } from '@portfolio/velista/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { anonymous } from '../auth/http-context';
import { GatewayError } from '../errors';
import { toShopSections } from '../mapping/shop-section-mappers';
import type { ShopSectionsServiceI } from './shop-sections-service';

/**
 * A shop's sections over HTTP. The default behind `SHOP_SECTIONS_SERVICE`.
 *
 * Provided by the app layer and never at root (rule D5): it depends on the
 * `HttpClient` the app configures.
 */
@Injectable()
export class ShopSectionsApi implements ShopSectionsServiceI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);

  async sections(locationId: string): Promise<ShopSections | null> {
    try {
      const body = await firstValueFrom(
        this._http.get<unknown>(
          this._urls.gateway(
            `/v1/catalog/locations/${encodeURIComponent(locationId)}/sections`
          ),
          // Sent without a token: the route takes no account (backend `0167`,
          // section 4), so a guest's missing one, or an expired one, must not
          // start a refresh for a read that never needed it.
          { context: anonymous('catalog.locationSections') }
        )
      );
      return toShopSections(body);
    } catch (error) {
      // An unknown shop has no sections, and asking again would not give it any.
      return error instanceof GatewayError && error.code === 'not_found'
        ? { sections: [], source: 'CHAIN' }
        : null;
    }
  }
}
