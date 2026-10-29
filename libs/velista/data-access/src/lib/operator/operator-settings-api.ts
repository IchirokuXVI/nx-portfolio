import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { OperatorSettings } from '@portfolio/velista/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { anonymous } from '../auth/http-context';
import { toOperatorSettings } from '../mapping/operator-mappers';
import type { OperatorSettingsServiceI } from './operator-settings-service';

/**
 * The operator's settings, over HTTP. The default behind `OPERATOR_SETTINGS_SERVICE`.
 *
 * Provided by the app layer and never at root (rule D5): it depends on the
 * `HttpClient` the app configures.
 *
 * `anonymous()`, because the route is public and the answer is the same for
 * everybody. Without it the interceptor would refresh a token first, so a signed out
 * reader of the privacy policy would pay a refresh that can only fail.
 */
@Injectable()
export class OperatorSettingsApi implements OperatorSettingsServiceI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);

  async read(): Promise<OperatorSettings | null> {
    const body = await firstValueFrom(
      this._http.get<unknown>(this._urls.gateway('/v1/legal/settings'), {
        context: anonymous('legal.settings'),
      })
    );

    return toOperatorSettings(body);
  }
}
