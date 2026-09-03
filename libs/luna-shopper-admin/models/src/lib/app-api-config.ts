import { InjectionToken } from '@angular/core';

/**
 * Where the backend lives, from the app's own point of view (plan 0001, section 7).
 *
 * One URL, not velista's two. This app polls and never subscribes: harvest run
 * progress is polled by `0006`, which is what backlog `0001` section 6.6 settled as
 * phase one, so there is no socket to point anywhere and no `LUNA_REALTIME_URL`.
 *
 * The app layer reads its `environment.ts` and provides this token; every service in
 * `data-access` injects the token and never touches an environment file itself.
 */
export interface AdminApiConfig {
  /** Origin of the luna-shopper gateway, no trailing slash. */
  readonly gatewayBaseUrl: string;
}

export const ADMIN_API_CONFIG = new InjectionToken<AdminApiConfig>(
  'ADMIN_API_CONFIG'
);
