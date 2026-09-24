import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  CatalogBrowseContext,
  CatalogBrowseQuery,
  CatalogProduct,
  CatalogScopeOffer,
  Page,
  Supermarket,
} from '@portfolio/velista/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { operation } from '../auth/http-context';
import {
  toCatalogBrowseContext,
  toCatalogProduct,
  toCatalogScopeOffer,
} from '../mapping/catalog-browse-mappers';
import { toSupermarket } from '../mapping/mappers';
import { isRecord, mapArray, nullableStr } from '../mapping/primitives';
import type { CatalogBrowseServiceI } from './catalog-browse-service';

/**
 * How many source rows the sheet reads per request, and how many requests at most.
 *
 * A product is sold in one scope per warehouse or region, and a chain has tens of
 * them (LIDL has 59). Four pages of a hundred is every scope of every chain we
 * harvest, and a bound is still stated: a server that answered with the cursor it
 * was handed would otherwise keep a sheet asking forever.
 */
const OFFER_PAGE_SIZE = 100;
const MAX_OFFER_PAGES = 4;

/** The chain names, one page, which is every chain the catalog holds today. */
const SUPERMARKET_PAGE_SIZE = 100;

/**
 * The catalog tab over HTTP. The default behind `CATALOG_BROWSE_SERVICE`.
 *
 * Provided by the app layer and never at root (rule D5): it depends on the
 * `HttpClient` the app configures.
 */
@Injectable()
export class CatalogBrowseApi implements CatalogBrowseServiceI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);

  async context(): Promise<CatalogBrowseContext | null> {
    // No selector on either read, so both resolve the person's default profile:
    // the one their lists are priced from everywhere else in the app.
    const [scope, summary, supermarkets] = await Promise.all([
      this._get('/v1/catalog/scope', new HttpParams(), 'catalog.scope'),
      this._get(
        '/v1/catalog/shops/summary',
        new HttpParams(),
        'catalog.shopSummary'
      ),
      this._supermarkets(),
    ]);

    return scope === null
      ? null
      : toCatalogBrowseContext(scope, summary, supermarkets);
  }

  async browse(
    query: CatalogBrowseQuery
  ): Promise<Page<CatalogProduct> | null> {
    let params = new HttpParams()
      .set('order', query.order)
      .set('limit', query.limit);
    const words = query.query.trim();
    if (words !== '') {
      params = params.set('query', words);
    }
    if (query.soldBy !== null) {
      // What the chain sells (backend `0146`), which is not where the prices come
      // from: that is the scope list below.
      params = params.append('soldBy', query.soldBy);
    }
    for (const scope of query.priceScopeIds) {
      params = params.append('priceScopeId', scope);
    }
    if (query.cursor !== null) {
      params = params.set('cursor', query.cursor);
    }

    const body = await this._get('/v1/catalog/items', params, 'catalog.browse');
    if (!isRecord(body)) {
      return null;
    }
    return {
      items: mapArray(body['items'], toCatalogProduct),
      nextCursor: nullableStr(body['nextCursor']),
    };
  }

  async scopeOffers(
    itemId: string
  ): Promise<readonly CatalogScopeOffer[] | null> {
    const rows: CatalogScopeOffer[] = [];
    let cursor: string | null = null;

    for (let page = 0; page < MAX_OFFER_PAGES; page++) {
      let params = new HttpParams().set('limit', OFFER_PAGE_SIZE);
      if (cursor !== null) {
        params = params.set('cursor', cursor);
      }
      const body = await this._get(
        `/v1/catalog/items/${encodeURIComponent(itemId)}/offers`,
        params,
        'catalog.itemOffers'
      );
      if (!isRecord(body)) {
        return null;
      }
      rows.push(...mapArray(body['items'], toCatalogScopeOffer));
      cursor = nullableStr(body['nextCursor']);
      if (cursor === null) {
        break;
      }
    }

    return rows;
  }

  /** Every chain's name. Empty on failure, which costs a name and nothing else. */
  private async _supermarkets(): Promise<readonly Supermarket[]> {
    const body = await this._get(
      '/v1/catalog/supermarkets',
      new HttpParams().set('limit', SUPERMARKET_PAGE_SIZE),
      'catalog.supermarkets'
    );
    return isRecord(body) ? mapArray(body['items'], toSupermarket) : [];
  }

  /** One GET, answering null for anything that did not come back. */
  private async _get(
    path: string,
    params: HttpParams,
    name: string
  ): Promise<unknown> {
    try {
      return await firstValueFrom(
        this._http.get<unknown>(this._urls.gateway(path), {
          params,
          context: operation(name),
        })
      );
    } catch {
      return null;
    }
  }
}
