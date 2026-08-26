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
// Provided by the app layer, never root: rule D5, plan 0004 section 9. It reaches
// something only the app can supply, and the app injector is a child of the root one.
@Injectable()
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

  /**
   * Whether a URL belongs to the gateway.
   *
   * The HTTP interceptor is global, so this is the only thing standing between the
   * app and attaching a bearer token to a third party URL (plan 0004, section 4.3
   * step 1). It is a prefix match on the configured origin rather than a substring
   * search, because `https://evil.test/?x=https://gateway.example` contains the
   * origin without being it.
   */
  isGateway(url: string): boolean {
    return startsWithOrigin(url, this._config.gatewayBaseUrl);
  }

  /** Whether a URL belongs to the realtime service. See {@link isGateway}. */
  isRealtime(url: string): boolean {
    return startsWithOrigin(url, this._config.realtimeBaseUrl);
  }
}

function startsWithOrigin(url: string, base: string): boolean {
  if (!url.startsWith(base)) {
    return false;
  }

  // `https://api.example.com` must not match `https://api.example.com.evil.test`.
  // The character after the origin has to end it, or be the whole of the URL.
  const rest = url.slice(base.length);
  return (
    rest === '' ||
    rest.startsWith('/') ||
    rest.startsWith('?') ||
    rest.startsWith('#')
  );
}

function normalize(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}
