import { AppApiConfig } from '@portfolio/velista/models';

/**
 * The app's own environment surface (plan 0001, the extraction contract, item 6).
 *
 * Deliberately NOT `@portfolio/shared/environments`: that object describes the
 * portfolio's own backend, and this app must not inherit assumptions baked into
 * shared portfolio code. When the app is extracted, this file moves with it and
 * nothing else changes.
 *
 * Swapped at build time by `fileReplacements` (see project.json), the standard
 * Angular mechanism the rest of the workspace already uses.
 *
 * The two URLs are read from `process.env` and replaced at compile time by the
 * `DefinePlugin` in `webpack.config.ts`, which supplies the local defaults
 * (`localhost:3000` and `localhost:3001`, the ports the backend's config schema
 * defaults to). This mirrors `environment.prod.ts`, and the reason it is worth
 * having in development too is the dev slots: several worktrees serve this app at
 * once, each against its own copy of the backend on its own ports, so the pair
 * cannot be a literal. `tools/dev/ng-slot.sh` writes them into `apps/velista/.env`
 * and Nx loads that into this project's tasks, so a build with neither variable
 * set is exactly the single stack workflow that came before.
 */
/**
 * Just enough of `process` for the two reads below, declared file-locally.
 *
 * This is a browser tsconfig, so `process` is genuinely absent from the types,
 * and it is genuinely absent at runtime too: the `DefinePlugin` replaces both
 * expressions with string literals before any of this reaches a browser. Adding
 * `"types": ["node"]` to tsconfig.app.json would compile, but it would also tell
 * every other file in this app that `fs` and `Buffer` are available, which is the
 * opposite of true. A four line declaration says exactly what is being relied on.
 */
declare const process: { env: Record<string, string | undefined> };

export const environment: {
  production: boolean;
  version: string;
  api: AppApiConfig;
  appUrl: string;
} = {
  production: false,
  /**
   * Which build this is, as one string, and the only source of that identity
   * (plan 0034 D4).
   *
   * It leaves the app in the `x-client-version` header on every gateway request,
   * which is what lets a deployment say a client is too old to be served. In
   * development it is the `0.0.0-dev` default, which by D6 does not parse as a
   * release version and so is never compared against a floor: a local build is
   * never stale and never refused.
   *
   * Deliberately not read from `ngsw-config.json`'s `appData`. That file is static
   * JSON, so a version written there is hand maintained and drifts from the build
   * it claims to describe; `appData` carries the `critical` flag and nothing else.
   */
  version: process.env['VELISTA_APP_VERSION'] as string,
  // Where this app answers on its own origin (plan 0033 D10). Not part of `api`,
  // which describes where the **backend** is: this is the address somebody reading
  // the portfolio's mounted copy has to go to in order to install anything.
  appUrl: process.env['VELISTA_APP_URL'] as string,
  api: {
    // The luna-shopper gateway (PORT defaults to 3000 in its config schema).
    gatewayBaseUrl: process.env['LUNA_GATEWAY_URL'] as string,
    // The realtime service (PORT defaults to 3001). The transport, a WebSocket
    // with an SSE fallback, is the realtime client's choice, not this URL's.
    realtimeBaseUrl: process.env['LUNA_REALTIME_URL'] as string,
  },
};
