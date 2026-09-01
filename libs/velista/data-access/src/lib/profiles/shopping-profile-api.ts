import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  CatalogScope,
  ProfileGenerationScope,
  ShoppingProfile,
  Supermarket,
  WriteShoppingProfileRequest,
} from '@portfolio/velista/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { operation } from '../auth/http-context';
import {
  toCatalogScope,
  toPage,
  toProfileGenerationScope,
  toShoppingProfile,
  toSupermarket,
} from '../mapping/mappers';
import { mapArray } from '../mapping/primitives';
import { required } from '../mapping/required';
import type { ShoppingProfileServiceI } from './shopping-profile-service';

/**
 * The chains, in one request rather than a paged crawl.
 *
 * `MAX_PAGE_SIZE` on the gateway is 100, which is the ceiling this can ask for, and the
 * catalog holds a handful of Spanish chains. {@link ShoppingProfileApi.listSupermarkets}
 * still follows the cursor rather than assuming one page is all of them, because a
 * silently short chain list is a profile that cannot exclude the shop on its corner.
 */
const CHAIN_PAGE_SIZE = 100;

/**
 * A hard stop on the cursor loop.
 *
 * The catalog would have to grow a hundredfold before this bound was reached, so
 * hitting it means a server answering with a cursor it was handed, and a phone spinning
 * requests forever is a worse failure than a list that is short by a page.
 */
const MAX_CHAIN_PAGES = 20;

/**
 * The caller's shopping profiles and the catalog reads they are filled in from, over
 * HTTP. The default behind `SHOPPING_PROFILE_SERVICE`.
 *
 * Provided by the app layer and never at root (rule D5): it depends on the `HttpClient`
 * the app configures.
 *
 * **Every request body is a `WriteShoppingProfileRequest` and never a mapped model.**
 * Rule D4 maps one way, and the gateway's validation pipe runs with
 * `forbidNonWhitelisted: true`, so spreading a `ShoppingProfile` into a `PATCH` would
 * be a 400 on `id` before it was anything else.
 */
@Injectable()
export class ShoppingProfileApi implements ShoppingProfileServiceI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);

  async listProfiles(): Promise<readonly ShoppingProfile[]> {
    const body = await firstValueFrom(
      this._http.get<unknown>(this._profiles(), {
        context: operation('profiles.list'),
      })
    );

    // Not a page, and deliberately: there are at most ten profiles, so the gateway
    // answers a named object rather than a cursor nobody would ever pass back.
    return mapArray(
      (body as { profiles?: unknown } | null)?.profiles,
      toShoppingProfile
    );
  }

  /**
   * The generation scope of one profile (plan 0049, section 3).
   *
   * **A request of its own over the same route.** It reads the listing again rather
   * than reaching into whatever `ShoppingProfileStore` happens to hold, because the
   * whole property being bought here is that the profile object the page saves has
   * never carried these two fields at all. Sharing a cache would mean sharing a parse,
   * and one mapper answering both shapes is exactly the thing that eventually sends an
   * empty `generationSources` back.
   *
   * It is paid once, when the generation sheet opens, by somebody who is about to
   * generate a basket.
   */
  async readGenerationScope(
    profileId: string
  ): Promise<ProfileGenerationScope | null> {
    const body = await firstValueFrom(
      this._http.get<unknown>(this._profiles(), {
        context: operation('profiles.generationScope'),
      })
    );

    const scopes = mapArray(
      (body as { profiles?: unknown } | null)?.profiles,
      toProfileGenerationScope
    );

    // Null rather than a throw for a profile that is not there: it is a stale id, and
    // the sheet's answer to "no stored scope" is already the right answer to it.
    return scopes.find((scope) => scope.profileId === profileId) ?? null;
  }

  async createProfile(
    request: WriteShoppingProfileRequest
  ): Promise<ShoppingProfile> {
    const body = await firstValueFrom(
      this._http.post<unknown>(this._profiles(), request, {
        context: operation('profiles.create'),
      })
    );

    return required(toShoppingProfile(body), 'profiles.create');
  }

  async updateProfile(
    profileId: string,
    request: WriteShoppingProfileRequest
  ): Promise<ShoppingProfile> {
    const body = await firstValueFrom(
      this._http.patch<unknown>(this._profile(profileId), request, {
        context: operation('profiles.update'),
      })
    );

    return required(toShoppingProfile(body), 'profiles.update');
  }

  async makeDefault(profileId: string): Promise<ShoppingProfile> {
    const body = await firstValueFrom(
      this._http.post<unknown>(
        `${this._profile(profileId)}/default`,
        {},
        { context: operation('profiles.setDefault') }
      )
    );

    return required(toShoppingProfile(body), 'profiles.setDefault');
  }

  /**
   * The answer is `{ id }` and nothing here reads it.
   *
   * The store already knows which profile it asked about, and the list it reconciles
   * against comes from the server's own `profiles.changed` or from the next read. An id
   * echoed back is not news.
   */
  async deleteProfile(profileId: string): Promise<void> {
    await firstValueFrom(
      this._http.delete<unknown>(this._profile(profileId), {
        context: operation('profiles.delete'),
      })
    );
  }

  async listSupermarkets(): Promise<readonly Supermarket[]> {
    const chains: Supermarket[] = [];
    let cursor: string | null = null;

    for (let page = 0; page < MAX_CHAIN_PAGES; page++) {
      let params = new HttpParams()
        .set('limit', CHAIN_PAGE_SIZE)
        .set('order', 'name');
      if (cursor !== null) {
        params = params.set('cursor', cursor);
      }

      const body: unknown = await firstValueFrom(
        this._http.get<unknown>(
          this._urls.gateway('/v1/catalog/supermarkets'),
          {
            params,
            context: operation('catalog.supermarkets'),
          }
        )
      );

      const answered = toPage(body, toSupermarket);
      chains.push(...answered.items);
      cursor = answered.nextCursor;

      if (cursor === null) {
        break;
      }
    }

    return chains;
  }

  async describeScope(profileId: string): Promise<CatalogScope> {
    const body = await firstValueFrom(
      this._http.get<unknown>(this._urls.gateway('/v1/catalog/scope'), {
        params: new HttpParams().set('profileId', profileId),
        context: operation('catalog.scope'),
      })
    );

    return required(toCatalogScope(body), 'catalog.scope');
  }

  private _profiles(): string {
    return this._urls.gateway('/v1/account/shopping-profiles');
  }

  private _profile(profileId: string): string {
    return `${this._profiles()}/${encodeURIComponent(profileId)}`;
  }
}
