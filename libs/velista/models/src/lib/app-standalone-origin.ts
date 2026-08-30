import { InjectionToken } from '@angular/core';

/**
 * Where this app lives on its own origin, with no trailing slash.
 *
 * Plan 0033 D10. The app runs in two modes (plan 0013 D1): on its own origin, where it
 * has its own manifest and its own service worker and is therefore installable, and
 * mounted inside the portfolio, where the document, the manifest and the worker all
 * belong to the portfolio. An install triggered from the mounted mode would install the
 * **portfolio**, under the portfolio's name and icon, so the mounted mode never prompts
 * and points at this address instead.
 *
 * A token of its own rather than a field on `AppApiConfig`: that object describes where
 * the **backend** is, and this value is not that.
 *
 * The default is the empty string, meaning unknown, which is what a spec and a server
 * render get. A screen therefore has to treat an empty value as "no address to offer"
 * rather than building a link out of it. The app layer supplies the real one from its
 * `environment.ts`, where it is substituted at compile time from `VELISTA_APP_URL`
 * (plan 0014's mechanism, a third variable).
 */
export const APP_STANDALONE_ORIGIN = new InjectionToken<string>(
  'APP_STANDALONE_ORIGIN',
  { factory: () => '' }
);
