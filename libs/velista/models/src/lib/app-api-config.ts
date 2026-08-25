import { InjectionToken } from '@angular/core';

/**
 * Where the backend lives, from the app's own point of view.
 *
 * Extraction contract item 6 (plan 0001): backend base URLs come from the app's own
 * environment surface, not from assumptions baked into shared portfolio code. The
 * app layer reads its `environment.ts` and provides this token; every service in
 * `data-access` injects the token and never touches an environment file itself, so
 * the libraries move to the standalone repository unchanged.
 */
export interface AppApiConfig {
  /** Origin of the luna-shopper gateway, no trailing slash. REST lives here. */
  readonly gatewayBaseUrl: string;
  /** Origin of the realtime service, no trailing slash. WebSocket, SSE fallback. */
  readonly realtimeBaseUrl: string;
}

export const APP_API_CONFIG = new InjectionToken<AppApiConfig>(
  'APP_API_CONFIG'
);
