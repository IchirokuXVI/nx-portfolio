import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { toGatewayError } from '../gateway-error';
import type { DashboardDocument, DashboardServiceI } from './dashboard-service';

/** The one route this screen reads (backend plan 0088, section 1). */
const ROUTE = '/v1/admin/dashboard';

/**
 * The dashboard's read, as the screen calls it.
 *
 * One request, behind the same bearer token every other admin read carries.
 * Every failure leaves here as a `GatewayError`, so the store above never sees
 * an `HttpErrorResponse` and never switches on a status number.
 *
 * Provided by the app layer and never at root, because it depends on the
 * `HttpClient` carrying that token.
 */
@Injectable()
export class DashboardApi implements DashboardServiceI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);

  async read(): Promise<DashboardDocument> {
    try {
      return await firstValueFrom(
        this._http.get<DashboardDocument>(this._urls.gateway(ROUTE))
      );
    } catch (error) {
      throw toGatewayError(error);
    }
  }
}
