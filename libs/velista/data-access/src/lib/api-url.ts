import { Injectable, inject } from '@angular/core';
import { APP_API_CONFIG } from '@portfolio/velista/models';

/**
 * Builds gateway and realtime URLs from the app-supplied configuration.
 *
 * Every service that talks to the backend goes through here rather than reading an
 * environment file, so the libraries carry no knowledge of where they are deployed
 * (plan 0001, the extraction contract, item 6). The app layer provides
 * `APP_API_CONFIG`; this is the only consumer of it in `data-access`.
 */
@Injectable({ providedIn: 'root' })
export class ApiUrl {
  private readonly _config = inject(APP_API_CONFIG);

  /** An absolute gateway URL for a path such as `/v1/zones`. */
  gateway(path: string): string {
    return `${this._config.gatewayBaseUrl}${normalize(path)}`;
  }

  /** An absolute realtime-service URL. */
  realtime(path: string): string {
    return `${this._config.realtimeBaseUrl}${normalize(path)}`;
  }
}

function normalize(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}
