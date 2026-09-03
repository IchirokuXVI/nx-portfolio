/**
 * Is this service talking to a local database (plan 0071, section 8)?
 *
 * The one question `ADMIN_DEV_AUTOLOGIN` is checked against. A switch that mints
 * an operator token without a password is total compromise of every user's data
 * if it is ever on in production, so the answer has to come from something the
 * deployment cannot get wrong by accident. `NODE_ENV` is exactly what it must not
 * be: one mis set variable in a deploy, or one image built with the wrong target,
 * and it is on.
 *
 * `AUTH_DB_URL` is used instead because it is the least deniable thing about a
 * running auth service. A pod pointed at the production database is in
 * production, whatever it believes about itself, and no build flag or image tag
 * can disagree with the host it is actually connected to.
 *
 * **There is deliberately no escape hatch.** `tools/db/guard.js` asks a similar
 * question and offers `LUNA_DB_ALLOW_HOSTS` and `LUNA_DB_ALLOW_DESTRUCTIVE` for a
 * controlled staging run, because the worst case there is a seeded staging
 * database. The worst case here is an unauthenticated administrator, so an opt
 * out would be the compromise rather than a way round it.
 */

/**
 * Loopback plus the compose service hostnames from
 * `k8s/e2e/luna-shopper-backend/compose.yml` and their `-test` twins, which are
 * the only hosts a development or CI auth service ever resolves.
 */
const LOCAL_DB_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  'auth-db',
  'auth-db-test',
]);

/** The hostname of a connection string, or null when it will not parse. */
export function dbHost(rawUrl: string | undefined): string | null {
  if (!rawUrl) {
    return null;
  }
  try {
    // Strip the brackets URL keeps around an IPv6 literal so the compare works.
    return new URL(rawUrl).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return null;
  }
}

/**
 * True only for a host on the list above. An unparseable or absent URL answers
 * false, which is the safe way to be wrong: the cost is a development autologin
 * that refuses to start, and the cost of the other mistake is the whole database.
 */
export function isLocalDbHost(rawUrl: string | undefined): boolean {
  const host = dbHost(rawUrl);
  return host !== null && LOCAL_DB_HOSTS.has(host);
}

/**
 * Crash the boot when the development autologin is on somewhere it must not be.
 *
 * A crash and not a warning, because a service that will not start is a failed
 * deploy somebody has to look at, and a service that logs a warning is a
 * compromise nobody read.
 */
export function assertDevAutologinIsSafe(
  enabled: boolean,
  rawDbUrl: string | undefined
): void {
  if (!enabled || isLocalDbHost(rawDbUrl)) {
    return;
  }
  throw new Error(
    `ADMIN_DEV_AUTOLOGIN is on and AUTH_DB_URL points at ` +
      `'${dbHost(rawDbUrl) ?? '(unparseable connection string)'}', which is not ` +
      `a local database. That switch mints an operator token with no password, ` +
      `so it exists for a developer machine and nowhere else. Neither ` +
      `values.production.yaml nor values.staging.yaml ever sets it; if this is a ` +
      `cluster, the variable should not be here at all.`
  );
}
