import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  SetGlobalUsernameRequest,
  UserProfile,
  UsernameScope,
} from '@portfolio/velista/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { operation } from '../auth/http-context';
import { toUserProfile } from '../mapping/mappers';
import { isRecord } from '../mapping/primitives';
import { required } from '../mapping/required';
import type { AccountServiceI } from './account-service';

/**
 * The caller's own account, over HTTP. The default behind `ACCOUNT_SERVICE`.
 *
 * Provided by the app layer and never at root (rule D5): it depends on the `HttpClient`
 * the app configures.
 *
 * **This is where `UsernameScope` becomes `UsernamePropagation`**, and it is the only
 * place in the app that knows both names. Rule D4 maps one way — models come from the
 * wire, request bodies go to it — so the app's two valued question is translated at the
 * boundary rather than the wire's three valued enum being carried up into a radio
 * group.
 */
@Injectable()
export class AccountApi implements AccountServiceI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);

  async getProfile(): Promise<UserProfile> {
    const body = await firstValueFrom(
      this._http.get<unknown>(this._me(), { context: operation('account.me') })
    );

    return required(toUserProfile(body), 'account.me');
  }

  /**
   * `PATCH /v1/account/me`, five per **hour** (rule A4).
   *
   * The wait for a refusal rides in the problem body rather than in a `Retry-After`
   * header, for the CORS reason plan 0004 recorded, so nothing is read off the response
   * here: `gatewayInterceptor` has already put it on the `GatewayError`.
   */
  async setUsername(
    username: string,
    scope: UsernameScope
  ): Promise<UserProfile> {
    // Named and typed rather than an inline literal, because the gateway's validation
    // pipe runs with `forbidNonWhitelisted: true`: a property it does not recognise is
    // a 400 rather than something quietly stripped.
    const request: SetGlobalUsernameRequest = {
      username,
      // Always sent, never omitted. An absent field means `GLOBAL_ONLY` on the wire,
      // which is not what the sheet defaults to (rule A3).
      propagation: scope === 'MY_GROUPS_TOO' ? 'MATCHING_ZONES' : 'GLOBAL_ONLY',
    };

    const body = await firstValueFrom(
      this._http.patch<unknown>(this._me(), request, {
        context: operation('account.rename'),
      })
    );

    return required(toUserProfile(body), 'account.rename');
  }

  /**
   * `DELETE /v1/account`.
   *
   * The result is read with `isRecord` rather than through a mapper, because there is
   * no record here to be unrenderable: the answer is one boolean, and a body this build
   * cannot read means the same thing as `deleted: false`, which is what an idempotent
   * repeat already returns. Nothing on the screen branches on it.
   */
  async deleteAccount(): Promise<{ readonly deleted: boolean }> {
    const body = await firstValueFrom(
      this._http.delete<unknown>(this._urls.gateway('/v1/account'), {
        context: operation('account.delete'),
      })
    );

    return { deleted: isRecord(body) && body['deleted'] === true };
  }

  private _me(): string {
    return this._urls.gateway('/v1/account/me');
  }
}
