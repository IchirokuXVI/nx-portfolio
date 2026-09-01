import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { CatalogSuggestion } from '@portfolio/velista/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { operation } from '../auth/http-context';
import { toCatalogSuggestion } from '../mapping/mappers';
import { isRecord, mapArray } from '../mapping/primitives';
import type { CatalogServiceI } from './catalog-service';

/**
 * The catalog search behind the composer, over HTTP. The default behind
 * `CATALOG_SERVICE`.
 *
 * Provided by the app layer and never at root (rule D5): it depends on the
 * `HttpClient` the app configures.
 */
@Injectable()
export class CatalogApi implements CatalogServiceI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);

  async suggest(
    query: string,
    options?: { profileId?: string; signal?: AbortSignal }
  ): Promise<readonly CatalogSuggestion[]> {
    let params = new HttpParams().set('q', query);
    if (options?.profileId !== undefined) {
      params = params.set('profileId', options.profileId);
    }

    try {
      const body = await firstValueFrom(
        this._http.get<unknown>(this._urls.gateway('/v1/catalog/suggest'), {
          params,
          context: operation('catalog.suggest'),
        })
      );

      // The order is the server's, from `item.searchOffers`, and is deliberately not
      // re-sorted: a group ranks above an item for a bare word, and the client has
      // none of the prices, scopes or synonyms that decided it.
      return isRecord(body)
        ? mapArray(body['suggestions'], toCatalogSuggestion)
        : [];
    } catch {
      // **Empty rather than thrown.** A dropdown is an offer, and an offer that
      // errors is worse than one that is not there: the composer still submits, the
      // line still gets added, and free text was always the fallback anyway. The one
      // thing this must never do is make adding something fail because a search did.
      return [];
    }
  }
}
