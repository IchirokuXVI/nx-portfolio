import { inject, Injectable } from '@angular/core';
import { ADMIN_API_CONFIG } from '@portfolio/luna-shopper-admin/models';

/**
 * Builds gateway URLs from the app-supplied configuration.
 *
 * Every service that talks to the backend goes through here rather than reading an
 * environment file, so the libraries carry no knowledge of where they are deployed.
 * The app layer provides {@link ADMIN_API_CONFIG}; this is its only consumer.
 *
 * There is no `realtime()` counterpart, and that is not an omission: this app polls
 * and never subscribes (plan 0001, section 4).
 */
@Injectable()
export class ApiUrl {
  private readonly _config = inject(ADMIN_API_CONFIG);

  /** An absolute gateway URL for a path such as `/v1/admin/environment`. */
  gateway(path: string): string {
    return `${this._config.gatewayBaseUrl}${normalize(path)}`;
  }

  /**
   * Whether a URL belongs to the gateway.
   *
   * Nothing reads this yet. It is here because `0002`'s interceptor is global and
   * this is the only thing that will stand between the app and attaching a bearer
   * token to a third party URL, and because getting it right is a prefix match on
   * the configured origin rather than a substring search:
   * `https://evil.test/?x=https://gateway.example` contains the origin without
   * being it.
   */
  isGateway(url: string): boolean {
    if (!url.startsWith(this._config.gatewayBaseUrl)) {
      return false;
    }

    // `https://api.example.com` must not match `https://api.example.com.evil.test`.
    // The character after the origin has to end it, or be the whole of the URL.
    const rest = url.slice(this._config.gatewayBaseUrl.length);
    return (
      rest === '' ||
      rest.startsWith('/') ||
      rest.startsWith('?') ||
      rest.startsWith('#')
    );
  }
}

function normalize(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}
