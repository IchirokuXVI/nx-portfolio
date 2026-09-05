/**
 * What this build calls itself when nobody says otherwise (backend plan 0080,
 * section 11), the way `apps/velista/app-version.ts` does for velista.
 *
 * Its own file, imported by both `webpack.config.ts` and `webpack.prod.config.ts`,
 * because the default is the *same* in development and in production and one
 * literal written twice is the drift this avoids.
 *
 * `0.0.0-dev` is deliberately not a release version. Only versions that parse as
 * semver are compared against a deployment's floor, and the prerelease tag on a
 * `0.0.0` sorts below every real release, so a build carrying this default is
 * never mistaken for one: it is not refused, and it never decides it is stale.
 */
export const DEFAULT_APP_VERSION = '0.0.0-dev';

/** The development build's version. Distinct from the production default only in name. */
export const DEV_APP_VERSION = DEFAULT_APP_VERSION;
