import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { toGatewayError } from '../gateway-error';
import type { PostalCodeServiceI } from './postal-code-service';

/** Core's answer about who is waiting (backend plan 0097, section 5). */
const USAGE_PATH = '/v1/admin/profiles/postal-codes/usage';

/** Catalog's shipped centroid table (backend plan 0074, section 2). */
const CATALOG_PATH = '/v1/admin/catalog/postal-codes';

/**
 * How many shipped rows one exact code can hide behind.
 *
 * The listing filters by **prefix**, and a Spanish code is five digits, so an
 * exact code is its own only match. One page is asked for anyway rather than
 * one row, because the route has no member and a page of one is what a prefix
 * of five digits returns.
 */
const SHIPPED_PAGE = 5;

/**
 * What catalog and core say about a postal code, over HTTP.
 *
 * Two backends behind one class, for the reason {@link PostalCodeServiceI} gives:
 * the screen is one subject asking three services, and the third is the
 * harvester's own queue.
 *
 * Provided by the app layer and never at root, because it depends on the
 * `HttpClient` carrying the bearer token.
 */
@Injectable()
export class PostalCodeApi implements PostalCodeServiceI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);

  usage(
    country: string,
    postalCodes: readonly string[]
  ): Promise<Wire.AdminCorePostalCodeUsageListView> {
    // Repeated rather than comma joined. The route reads both, and a repeated
    // parameter is what a browser sends and what the DTO documents first.
    let params = new HttpParams().set('country', country);
    for (const code of postalCodes) {
      params = params.append('postalCodes', code);
    }

    return this._send('get', USAGE_PATH, params);
  }

  nearby(
    country: string,
    postalCode: string,
    radiusMetres?: number
  ): Promise<Wire.CatalogNearbyPostalCodesView> {
    let params = new HttpParams().set('country', country);
    if (radiusMetres !== undefined) {
      params = params.set('radiusMetres', String(radiusMetres));
    }

    return this._send(
      'get',
      `${CATALOG_PATH}/${encodeURIComponent(postalCode)}/nearby`,
      params
    );
  }

  async shipped(
    country: string,
    postalCode: string
  ): Promise<Wire.CatalogAdminPostalCodeView | null> {
    const params = new HttpParams()
      .set('country', country)
      .set('postalCode', postalCode)
      .set('limit', String(SHIPPED_PAGE));

    const page = await this._send<Wire.CatalogAdminPostalCodePage>(
      'get',
      CATALOG_PATH,
      params
    );

    // The filter is a prefix, so the exact row is found rather than taken. A
    // page whose first row is a longer code would otherwise report somebody
    // else's shops as this code's.
    return page.items.find((row) => row.postalCode === postalCode) ?? null;
  }

  private async _send<R>(
    method: 'get',
    path: string,
    params: HttpParams
  ): Promise<R> {
    try {
      return await firstValueFrom(
        this._http.request<R>(method, this._urls.gateway(path), { params })
      );
    } catch (error) {
      throw toGatewayError(error);
    }
  }
}
