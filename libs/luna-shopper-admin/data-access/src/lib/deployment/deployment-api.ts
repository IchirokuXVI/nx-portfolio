import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  toAdminEnvironment,
  UNKNOWN_ENVIRONMENT,
  type AdminEnvironment,
} from '@portfolio/luna-shopper-admin/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
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
 * A failed request answers {@link UNKNOWN_ENVIRONMENT} rather than throwing.
 * Nothing else in the app is waiting on this call, and an unreachable gateway is
 * a thing the page has to be able to draw: the alternative is an unhandled
 * rejection during bootstrap and a blank screen, which tells an operator less
 * than "the environment is unknown" does. It also means an unreachable gateway
 * shows the login screen rather than skipping it, which is the safe way to be
 * wrong about that question.
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
    } catch {
      return UNKNOWN_ENVIRONMENT;
    }
  }
}
