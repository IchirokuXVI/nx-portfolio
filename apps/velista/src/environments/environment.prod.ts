import { AppApiConfig } from '@portfolio/velista/models';

/**
 * Production counterpart of environment.ts, swapped in by `fileReplacements`.
 * See that file for why this app carries its own environment surface rather
 * than reading `@portfolio/shared/environments`.
 *
 * The two URLs are **not** literals any more (plan 0014). velista is the only
 * frontend here that talks to a backend, so it is the only one whose image is
 * environment specific, and `fileReplacements` can only select one file. They are
 * read from `process.env` and replaced at compile time by the `DefinePlugin` in
 * `webpack.prod.config.ts`, which supplies the production hosts as defaults — so
 * a build with neither variable set is exactly today's intended production image,
 * and a staging build sets the pair to the staging hosts.
 *
 * `process.env` does not exist in a browser. Nothing here works without that
 * substitution, which is why `velista-bundle.spec.ts` asserts no literal
 * `process.env` survives into the emitted bundle: the failure would otherwise
 * only be visible at runtime in the deployed app.
 */
/**
 * Just enough of `process` for the two reads below, declared file-locally.
 *
 * This is a browser tsconfig, so `process` is genuinely absent from the types,
 * and it is genuinely absent at runtime too — the `DefinePlugin` replaces both
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
  production: true,
  /**
   * The build's identity, sent as `x-client-version` on every gateway request so a
   * deployment can retire clients that are too old to serve (plan 0034 D4).
   *
   * CI sets it to the same string it passes as `DOCKER_IMAGE_TAG`, which for a
   * release is the version and for staging is `staging`. Unset it defaults to
   * `0.0.0-dev`, so a production build made on a developer machine identifies
   * itself as what it is rather than impersonating a release.
   */
  version: process.env['VELISTA_APP_VERSION'] as string,
  // The app's own origin (plan 0033 D10), which differs between staging and
  // production exactly as the two backend URLs do, and arrives the same way.
  appUrl: process.env['VELISTA_APP_URL'] as string,
  api: {
    gatewayBaseUrl: process.env['LUNA_GATEWAY_URL'] as string,
    realtimeBaseUrl: process.env['LUNA_REALTIME_URL'] as string,
  },
};
