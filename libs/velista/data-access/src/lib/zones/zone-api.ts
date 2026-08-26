import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { MyZone, MyZoneOrder, Page } from '@portfolio/velista/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { operation } from '../auth/http-context';
import { TokenStore } from '../auth/token-store';
import {
  toMembership,
  toMyZone,
  toPage,
  toSessionTokens,
  toZone,
} from '../mapping/mappers';
import { isRecord } from '../mapping/primitives';
import type {
  ZoneCreationResult,
  ZoneJoinResult,
  ZoneServiceI,
} from './zone-service';

/**
 * Zones, over HTTP.
 *
 * Bound at the app injector with `provideService(ZONE_SERVICE, ZoneApi)`. The token's
 * default stays the in-memory implementation so tests and a backend-less run keep
 * working (plan 0004, section 9).
 *
 * Injects `ApiUrl`, not `ApiConsumer`: the shared helper resolves URLs from
 * `@portfolio/shared/environments`, which describes the **portfolio's** backend, and
 * extraction contract item 6 says this app reads its own environment surface.
 */
@Injectable({ providedIn: 'root' })
export class ZoneApi implements ZoneServiceI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);
  private readonly _tokens = inject(TokenStore);

  async listMyZones(options?: {
    cursor?: string;
    limit?: number;
    order?: MyZoneOrder;
  }): Promise<Page<MyZone>> {
    let params = new HttpParams();
    if (options?.cursor !== undefined) {
      params = params.set('cursor', options.cursor);
    }
    if (options?.limit !== undefined) {
      // The gateway validates this to [1, 100] and a value outside it is a 400, not
      // a clamp, so nothing may pass a page size through from user input unchecked.
      params = params.set('limit', clampLimit(options.limit));
    }
    if (options?.order !== undefined) {
      params = params.set('order', options.order);
    }

    const body = await firstValueFrom(
      this._http.get<unknown>(this._urls.gateway('/v1/zones'), {
        params,
        context: operation('zones.list'),
      })
    );

    return toPage(body, toMyZone);
  }

  /**
   * `POST /v1/zones`, which mints a guest account when it sees no valid identity.
   *
   * Rule D3 (plan 0004, section 5.5) is enforced **before** the request is built. The
   * gateway's `OptionalJwtAuthGuard` swallows an expired token and falls through to
   * anonymous, so sending one would hand the user a second guest account and orphan
   * the groups on their first. There is no way to detect that after the fact, which is
   * why the check cannot live in the interceptor's error path.
   */
  async createZone(
    name: string,
    username?: string
  ): Promise<ZoneCreationResult> {
    const authorized = await this._tokens.authorizeOptionalAuthCall();
    if (authorized.state === 'guest-account-lost') {
      return { state: 'guest-account-lost' };
    }

    const body = await firstValueFrom(
      this._http.post<unknown>(
        this._urls.gateway('/v1/zones'),
        // `username` is omitted rather than sent empty when the caller has no
        // per-zone name in mind: the backend fills it from their global username,
        // and the validation pipe runs with `forbidNonWhitelisted`, so a stray
        // `undefined` is not something to be casual about.
        username === undefined ? { name } : { name, username },
        { context: operation('zones.create') }
      )
    );

    this._persistMintedTokens(body);

    const zone = toZone(isRecord(body) ? body['data'] : null);
    if (zone === null) {
      // The write may well have succeeded, so this is not reported as a failure the
      // user should retry into a duplicate zone. The caller refetches.
      throw new Error('zones.create returned an unusable zone');
    }

    return { state: 'created', zone };
  }

  /** `POST /v1/zones/join`. Same handshake and the same rule D3 gate. */
  async joinZone(joinCode: string, username?: string): Promise<ZoneJoinResult> {
    const authorized = await this._tokens.authorizeOptionalAuthCall();
    if (authorized.state === 'guest-account-lost') {
      return { state: 'guest-account-lost' };
    }

    const body = await firstValueFrom(
      this._http.post<unknown>(
        this._urls.gateway('/v1/zones/join'),
        username === undefined ? { joinCode } : { joinCode, username },
        { context: operation('zones.join') }
      )
    );

    this._persistMintedTokens(body);

    const membership = toMembership(isRecord(body) ? body['data'] : null);
    if (membership === null) {
      throw new Error('zones.join returned an unusable membership');
    }

    return { state: 'joined', membership };
  }

  /**
   * Both optional-auth routes answer `{ tokens?, data }`, and `tokens` is present
   * **only** when a temporary user was just minted. An already authenticated caller
   * gets the key omitted, so its absence is normal and is not an error.
   *
   * Missing this is how a guest ends up holding no credential for the zone they just
   * created.
   */
  private _persistMintedTokens(body: unknown): void {
    if (!isRecord(body)) {
      return;
    }

    const tokens = toSessionTokens(body['tokens']);
    if (tokens !== null) {
      this._tokens.set(tokens);
    }
  }
}

function clampLimit(limit: number): string {
  return String(Math.min(100, Math.max(1, Math.trunc(limit))));
}
