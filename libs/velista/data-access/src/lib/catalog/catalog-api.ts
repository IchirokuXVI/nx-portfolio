import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  SUGGEST_LIMIT_PER_KIND,
  type CatalogItem,
  type CatalogSuggestion,
} from '@portfolio/velista/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { operation } from '../auth/http-context';
import { toCatalogItem, toCatalogSuggestion } from '../mapping/mappers';
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
    // **Asked for here rather than left to the server's default**, which is twenty
    // per kind and therefore up to forty rows in a panel that shows four at a time.
    // It is stated once, in the one place every screen's dropdown goes through, so
    // no page has to remember it and no two pages can disagree about how long a
    // dropdown is.
    let params = new HttpParams()
      .set('q', query)
      .set('limit', SUGGEST_LIMIT_PER_KIND);
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

  /**
   * The names of a set of products, in one request (velista plan 0047, section 1).
   *
   * `POST` for a read, which the gateway route explains at length and which comes down
   * to this: the identifiers are the request, and at the documented cap they do not fit
   * in a URL.
   *
   * **Null on failure, never an empty array.** The screens tell the two apart, because
   * one of them is a fact about the line and the other is a fact about the request, and
   * collapsing them is the defect this plan exists to fix.
   */
  async itemsByIds(
    itemIds: readonly string[]
  ): Promise<readonly CatalogItem[] | null> {
    if (itemIds.length === 0) {
      // No request at all, and an empty answer rather than null: nothing was asked, so
      // nothing failed. A line with no products must not draw a failure line.
      return [];
    }

    try {
      const body = await firstValueFrom(
        this._http.post<unknown>(
          this._urls.gateway('/v1/catalog/items/lookup'),
          { ids: [...new Set(itemIds)] },
          { context: operation('catalog.itemsByIds') }
        )
      );

      return isRecord(body) ? mapArray(body['items'], toCatalogItem) : null;
    } catch {
      return null;
    }
  }
}
