// Default-deny safety guard for the destructive database tooling (plan 0013,
// section 3.5). Seed, snapshot and restore refuse to run against any host that
// is not known-local unless an explicit opt-in is set, so a stray staging or
// production connection string can never be seeded, snapshot or restored by the
// test tooling. Production is never seeded and never snapshot/restored: its
// smoke path goes only through the public gateway API (plan 0013, section 3.5).

const { URL } = require('node:url');

// Loopback plus the docker-compose service hostnames from
// k8s/e2e/luna-shopper-backend/compose.yml (and their -test variants), which are
// the only hosts the local/CI stacks ever resolve.
const LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  'auth-db',
  'core-db',
  'catalog-db',
  'auth-db-test',
  'core-db-test',
  'catalog-db-test',
]);

function hostOf(rawUrl) {
  try {
    // Strip the brackets URL keeps around IPv6 literals so the Set compare works.
    return new URL(rawUrl).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return null;
  }
}

function extraAllowedHosts() {
  return (process.env['LUNA_DB_ALLOW_HOSTS'] || '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
}

function isAllowed(rawUrl) {
  const host = hostOf(rawUrl);
  if (!host) {
    return false;
  }
  if (LOCAL_HOSTS.has(host)) {
    return true;
  }
  if (extraAllowedHosts().includes(host)) {
    return true;
  }
  // A deliberate, opt-in escape hatch for a controlled staging run.
  return process.env['LUNA_DB_ALLOW_DESTRUCTIVE'] === '1';
}

function assertSafeTarget(rawUrl, action) {
  if (isAllowed(rawUrl)) {
    return;
  }
  const host = hostOf(rawUrl) || '(unparseable connection string)';
  throw new Error(
    `Refusing to ${action}: '${host}' is not an allowed database host.\n` +
      `The Luna Shopper seed / snapshot / restore tooling is default-deny and\n` +
      `only runs against local hosts. To target a non-local host on purpose\n` +
      `(for example a controlled staging run), set LUNA_DB_ALLOW_HOSTS=${host}\n` +
      `or LUNA_DB_ALLOW_DESTRUCTIVE=1. It must never run against production.`
  );
}

module.exports = { LOCAL_HOSTS, hostOf, isAllowed, assertSafeTarget };
