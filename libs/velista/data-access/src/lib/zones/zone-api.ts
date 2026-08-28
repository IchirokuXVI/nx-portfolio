import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  MyZone,
  MyZoneOrder,
  Page,
  SessionTokens,
  Zone,
} from '@portfolio/velista/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { operation } from '../auth/http-context';
import { TokenStore } from '../auth/token-store';
import { GatewayError } from '../errors';
import {
  toDeletedId,
  toMembership,
  toMyZone,
  toPage,
  toSessionTokens,
  toZone,
} from '../mapping/mappers';
import { isRecord } from '../mapping/primitives';
import { required } from '../mapping/required';
import type {
  ZoneCreationResult,
  ZoneJoinResult,
  ZoneServiceI,
} from './zone-service';

/**
 * Zones, over HTTP.
 *
 * **The default behind `ZONE_SERVICE`**, and still bound explicitly at the app injector
 * with `provideService(ZONE_SERVICE, ZoneApi)`. That helper provides the class as well
 * as binding it, which is what this needs: it depends on the `HttpClient` the app
 * configures, so it can only be built in the app's own injector, never at the root.
 * Anything wanting the fake asks for `ZoneMemory` by name (plan 0004, section 9).
 *
 * Injects `ApiUrl`, not `ApiConsumer`: the shared helper resolves URLs from
 * `@portfolio/shared/environments`, which describes the **portfolio's** backend, and
 * extraction contract item 6 says this app reads its own environment surface.
 */
// Provided by the app layer, never root: rule D5, plan 0004 section 9. It reaches
// something only the app can supply, and the app injector is a child of the root one.
@Injectable()
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
   * `POST /v1/zones`, which mints a guest account when the caller presents no identity.
   *
   * Rule D3 (plan 0004, section 5.5) is enforced **before** the request is built.
   * Backend plan 0020 made the gateway reject a stale token here rather than falling
   * through to anonymous, so a slip is now a recoverable 401 instead of a silent second
   * guest account. Refreshing first still saves that round trip, and the interceptor's
   * error path cannot tell a lost guest identity from a signed out user, which is the
   * distinction the caller needs.
   *
   * The gate cannot catch every case, and {@link _lostTheAccountWeSent} is the other
   * half. A token that is signed by the current key and has not expired passes it, and
   * the account it names may still be gone: deleted, or wiped with the database it
   * lived in. Only the server knows, so that one is answered afterwards.
   */
  async createZone(
    name: string,
    username?: string
  ): Promise<ZoneCreationResult> {
    const authorized = await this._tokens.authorizeOptionalAuthCall();
    if (authorized.state === 'guest-account-lost') {
      return { state: 'guest-account-lost' };
    }

    const presented = this._tokens.tokens();

    let body: unknown;
    try {
      body = await firstValueFrom(
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
    } catch (error) {
      if (this._lostTheAccountWeSent(error, presented)) {
        return { state: 'guest-account-lost' };
      }
      throw error;
    }

    this._persistMintedTokens(body);

    const zone = toZone(isRecord(body) ? body['data'] : null);
    if (zone === null) {
      // The write may well have succeeded, so this is not reported as a failure the
      // user should retry into a duplicate zone. The caller refetches.
      throw new Error('zones.create returned an unusable zone');
    }

    return { state: 'created', zone };
  }

  /** `POST /v1/zones/join`. Same handshake, the same rule D3 gate, the same net. */
  async joinZone(joinCode: string, username?: string): Promise<ZoneJoinResult> {
    const authorized = await this._tokens.authorizeOptionalAuthCall();
    if (authorized.state === 'guest-account-lost') {
      return { state: 'guest-account-lost' };
    }

    const presented = this._tokens.tokens();

    let body: unknown;
    try {
      body = await firstValueFrom(
        this._http.post<unknown>(
          this._urls.gateway('/v1/zones/join'),
          username === undefined ? { joinCode } : { joinCode, username },
          { context: operation('zones.join') }
        )
      );
    } catch (error) {
      if (this._lostTheAccountWeSent(error, presented)) {
        return { state: 'guest-account-lost' };
      }
      throw error;
    }

    this._persistMintedTokens(body);

    const membership = toMembership(isRecord(body) ? body['data'] : null);
    if (membership === null) {
      throw new Error('zones.join returned an unusable membership');
    }

    return { state: 'joined', membership };
  }

  /** `GET /v1/zones/:id`. The group page's header, counts and list previews. */
  async getZone(zoneId: string): Promise<MyZone> {
    const body = await firstValueFrom(
      this._http.get<unknown>(this._urls.gateway(`/v1/zones/${zoneId}`), {
        context: operation('zones.get'),
      })
    );

    return required(toMyZone(body), 'zones.get');
  }

  /** `PATCH /v1/zones/:id`, sending only `name`: the pipe forbids anything else. */
  async renameZone(zoneId: string, name: string): Promise<Zone> {
    const body = await firstValueFrom(
      this._http.patch<unknown>(
        this._urls.gateway(`/v1/zones/${zoneId}`),
        { name },
        { context: operation('zones.rename') }
      )
    );

    return required(toZone(body), 'zones.rename');
  }

  /** `POST /v1/zones/:id/regenerate-code`. */
  async regenerateJoinCode(zoneId: string): Promise<Zone> {
    const body = await firstValueFrom(
      this._http.post<unknown>(
        this._urls.gateway(`/v1/zones/${zoneId}/regenerate-code`),
        {},
        { context: operation('zones.regenerateCode') }
      )
    );

    return required(toZone(body), 'zones.regenerateCode');
  }

  /**
   * `DELETE /v1/zones/:id`.
   *
   * Falls back to the id it was asked to delete when the acknowledgement is
   * unreadable. Unlike a create, there is nothing here that could have gone to the
   * wrong record: a 2xx means this zone is gone, so refusing to say so over a
   * malformed body would leave a deleted group on screen.
   */
  async deleteZone(zoneId: string): Promise<string> {
    const body = await firstValueFrom(
      this._http.delete<unknown>(this._urls.gateway(`/v1/zones/${zoneId}`), {
        context: operation('zones.delete'),
      })
    );

    return toDeletedId(body) ?? zoneId;
  }

  /** `POST /v1/zones/:id/claim-ownership`. ADMIN only, and only while unowned. */
  async claimOwnership(zoneId: string): Promise<Zone> {
    const body = await firstValueFrom(
      this._http.post<unknown>(
        this._urls.gateway(`/v1/zones/${zoneId}/claim-ownership`),
        {},
        { context: operation('zones.claimOwnership') }
      )
    );

    return required(toZone(body), 'zones.claimOwnership');
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

  /**
   * Whether this failure is rule D3's case arriving after the fact: we sent a guest
   * identity, the server refused it, and the interceptor has since dropped the pair.
   *
   * The gate in `authorizeOptionalAuthCall` reads the only thing a client can read,
   * which is whether the access token has expired. A token can be unexpired and still
   * name nobody — the account was deleted, or the database it lived in was reset — and
   * the gateway answers that with a 401 (backend `asRejectedCredentials`), because a
   * token naming a deleted user is an invalid token rather than a missing resource.
   * The interceptor then tries to refresh, fails, and deletes the stored pair, so by
   * the time this runs the session is already gone.
   *
   * Three conditions, and each is load bearing. **A 401** and not any failure: a 404
   * on a join is "no zone has that code", which is the person's own typo. **No session
   * left**, so a 401 the app recovered from by refreshing is not reported as a lost
   * account. **A pair we actually presented, and a `TEMPORARY` one**: with nothing sent
   * there was no account to lose, and a registered user has credentials to sign back in
   * with, which is a different sentence and not this screen's.
   */
  private _lostTheAccountWeSent(
    error: unknown,
    presented: SessionTokens | null
  ): boolean {
    return (
      presented?.kind === 'TEMPORARY' &&
      error instanceof GatewayError &&
      error.status === 401 &&
      !this._tokens.hasSession()
    );
  }
}

function clampLimit(limit: number): string {
  return String(Math.min(100, Math.max(1, Math.trunc(limit))));
}
