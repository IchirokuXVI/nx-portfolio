import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  toAdminMe,
  toAdminSession,
  type AdminMe,
  type AdminSession,
} from '@portfolio/luna-shopper-admin/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { GatewayError, toGatewayError } from '../gateway-error';
import { withoutSessionRecovery } from './session-http-context';
import type { SessionServiceI } from './session-service';

/**
 * The real thing: `POST /v1/admin/auth/login` and `GET /v1/admin/auth/me`.
 *
 * Provided by the app layer and never at root, because it depends on the
 * `HttpClient` the app configures (interceptor and all) and on {@link ApiUrl},
 * which reaches a token only the app supplies.
 *
 * Every failure leaves here as a {@link GatewayError}, including a body that
 * arrived looking like a success and did not survive mapping. That last case is
 * a 200 the app cannot use, and calling it a `502` rather than inventing a new
 * shape says the true thing: something upstream answered with something this
 * app does not understand.
 */
@Injectable()
export class SessionApi implements SessionServiceI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);

  signIn(username: string, password: string): Promise<AdminSession> {
    return this.login({ username, password });
  }

  /**
   * The same route, with the credentials the gateway is about to ignore.
   *
   * When `ADMIN_DEV_AUTOLOGIN` is on, the gateway never looks at the body: it
   * mints a token for the configured admin. So there is nothing meaningful to
   * send, and sending nothing is not an option because the DTO requires both
   * fields to be present and non empty. The placeholders below satisfy that
   * validation and are read by nothing.
   *
   * If the switch is **off**, this is an ordinary login with a wrong password
   * and the server refuses it, which is the correct outcome: the app asked
   * first, and only a server that answered yes gets here.
   */
  signInForDevelopment(): Promise<AdminSession> {
    return this.login({ username: 'development', password: 'development' });
  }

  /**
   * The held token in the header, a new one in the answer (plan 0003).
   *
   * The body is empty because there is nothing to send: the gateway reads the
   * bearer token the interceptor attached, and auth is told only which admin it
   * named. An empty object rather than `null`, because a POST with no body at
   * all is a request some proxies handle differently from one with `{}`.
   */
  async refresh(): Promise<AdminSession> {
    let answer: unknown;
    try {
      answer = await firstValueFrom(
        this._http.post<unknown>(
          this._urls.gateway('/v1/admin/auth/refresh'),
          {},
          // A 401 here is the answer. Without this the interceptor would try to
          // recover from it by refreshing, from inside the refresh.
          { context: withoutSessionRecovery() }
        )
      );
    } catch (error) {
      throw toGatewayError(error);
    }

    const session = toAdminSession(answer);
    if (session === null) {
      throw unreadable();
    }
    return session;
  }

  async readMe(): Promise<AdminMe> {
    const body = await this.get('/v1/admin/auth/me');
    const me = toAdminMe(body);
    if (me === null) {
      throw unreadable();
    }
    return me;
  }

  private async login(body: {
    username: string;
    password: string;
  }): Promise<AdminSession> {
    let answer: unknown;
    try {
      answer = await firstValueFrom(
        this._http.post<unknown>(
          this._urls.gateway('/v1/admin/auth/login'),
          body,
          // A 401 here is a wrong password, not an expired session. Without this
          // the interceptor would raise a re-authentication overlay over the
          // login screen, and the overlay's own sign in would raise another.
          { context: withoutSessionRecovery() }
        )
      );
    } catch (error) {
      throw toGatewayError(error);
    }

    const session = toAdminSession(answer);
    if (session === null) {
      throw unreadable();
    }
    return session;
  }

  private async get(path: string): Promise<unknown> {
    try {
      return await firstValueFrom(
        this._http.get<unknown>(this._urls.gateway(path))
      );
    } catch (error) {
      throw toGatewayError(error);
    }
  }
}

/** A 2xx this app could not read. Reported as a bad gateway, because it is one. */
function unreadable(): GatewayError {
  return new GatewayError({
    code: 'unreadable_response',
    status: 502,
    correlationId: '',
  });
}
