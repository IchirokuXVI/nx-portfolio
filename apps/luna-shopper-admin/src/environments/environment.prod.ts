import type { AdminApiConfig } from '@portfolio/luna-shopper-admin/models';

/**
 * Production counterpart of environment.ts, swapped in by `fileReplacements`.
 *
 * The gateway URL is **not** a literal (plan 0001, section 7). This is the second
 * image in the workspace that is not environment agnostic, velista being the first
 * and for the same reason: it is one of the two frontends with a backend, and
 * `fileReplacements` can only select one file. It is read from `process.env` and
 * replaced at compile time by the `DefinePlugin` in `webpack.prod.config.ts`, which
 * supplies the production host as the default, so a build with the variable unset is
 * exactly the intended production image and a staging build sets it to the staging
 * host.
 *
 * `process.env` does not exist in a browser. Nothing here works without that
 * substitution.
 */
/** Just enough of `process` for the read below. See environment.ts for why. */
declare const process: { env: Record<string, string | undefined> };

export const environment: {
  production: boolean;
  api: AdminApiConfig;
  /**
   * Which build this is (backend plan 0080, section 11). CI sets it to the
   * same string it passes as the image tag, so the version a back office
   * reports is the version of the image serving it.
   */
  version: string;
} = {
  production: true,
  api: {
    gatewayBaseUrl: process.env['LUNA_GATEWAY_URL'] as string,
  },
  version: process.env['LUNA_ADMIN_APP_VERSION'] as string,
};
