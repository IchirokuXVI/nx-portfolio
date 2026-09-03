import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  toDeployment,
  type Deployment,
} from '@portfolio/luna-shopper-admin/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import type { DeploymentServiceI } from './deployment-service';

/**
 * `GET /v1/admin/environment`, the unauthenticated read the app's colour comes from
 * (plan 0001, section 6).
 *
 * Provided by the app layer and never at root: it depends on the `HttpClient` the
 * app configures and on {@link ApiUrl}, which reaches a token only the app supplies.
 *
 * It maps into this app's own `Deployment` union rather than passing the payload's
 * string through (rule D4). A gateway that grows a fourth environment name must
 * reach this screen as "unknown", not as a value the colour lookup silently misses.
 *
 * A failed request answers `null` rather than throwing. Nothing else in the app is
 * waiting on this call, and an unreachable gateway is a thing the page has to be
 * able to draw: the alternative is an unhandled rejection during bootstrap and a
 * blank screen, which tells an operator less than "the environment is unknown"
 * does.
 */
@Injectable()
export class DeploymentApi implements DeploymentServiceI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);

  async read(): Promise<Deployment | null> {
    try {
      const body = await firstValueFrom(
        this._http.get<unknown>(this._urls.gateway('/v1/admin/environment'))
      );

      return toDeployment(
        (body as { environment?: unknown } | null)?.environment
      );
    } catch {
      return null;
    }
  }
}
