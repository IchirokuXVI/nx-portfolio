import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  toAdminEnvironment,
  UNKNOWN_ENVIRONMENT,
  type AdminEnvironment,
} from '@portfolio/luna-shopper-admin/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { toGatewayError } from '../gateway-error';
import type { DeploymentServiceI } from './deployment-service';

/**
 * `GET /v1/admin/environment`, the unauthenticated read the app's colour and its
 * decision to show a login screen both come from (plan 0001, section 6; plan
 * 0002, section 5).
 *
 * Provided by the app layer and never at root: it depends on the `HttpClient`
 * the app configures and on {@link ApiUrl}, which reaches a token only the app
 * supplies.
 *
 * It maps into this app's own types rather than passing the payload through
 * (rule D4). A gateway that grows a fourth environment name must reach the
 * screen as "unknown", not as a value the colour lookup silently misses.
 *
 * A gateway that **answered** something this app cannot read produces
 * {@link UNKNOWN_ENVIRONMENT} rather than a rejection. Not knowing which
 * deployment this is has a safe value, the page has to draw either way, and an
 * unhandled rejection during bootstrap is a blank screen that tells an operator
 * less than "the environment is unknown" does. It also means the login screen is
 * shown rather than skipped, which is the safe way to be wrong about the
 * autologin.
 *
 * A request that produced **no response at all** is the one case that throws
 * (plan 0008, section 3). It is a different fact about a different thing: not
 * "the environment is unknown" but "there is nothing there to ask", and the app
 * draws a cover for it instead of a login form that cannot work. Status 0 is how
 * Angular reports it, and how the interceptor reports a timeout.
 */
@Injectable()
export class DeploymentApi implements DeploymentServiceI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);

  async read(): Promise<AdminEnvironment> {
    try {
      const body = await firstValueFrom(
        this._http.get<unknown>(this._urls.gateway('/v1/admin/environment'))
      );

      return toAdminEnvironment(body);
    } catch (error) {
      if (toGatewayError(error).status === 0) {
        throw error;
      }
      return UNKNOWN_ENVIRONMENT;
    }
  }
}
