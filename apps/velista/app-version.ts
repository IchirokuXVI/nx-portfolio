/**
 * What this build calls itself when nobody says otherwise (plan 0034 D4).
 *
 * Its own file, imported by both `webpack.config.ts` and `webpack.prod.config.ts`,
 * because unlike the two backend URLs the default here is the *same* in development
 * and in production. The URLs differ by configuration on purpose and each config
 * states its own; this one would be one literal written twice, which is the drift
 * `velista-api-hosts.spec.ts` exists to catch elsewhere and is cheaper to avoid than
 * to check.
 *
 * `0.0.0-dev` is deliberately not a release version. By D6 only versions that parse
 * as semver are compared against a deployment's floor, and the prerelease tag on a
 * `0.0.0` sorts below every real release, so a build carrying this default is never
 * mistaken for one: it is not refused, and it never decides it is stale. A
 * production build made on a developer machine with the variable unset gets this
 * too, which is correct, because it is not a release either.
 */
export const DEFAULT_APP_VERSION = '0.0.0-dev';
