// Layered env loading + database-URL resolution for the Luna Shopper db tooling
// (plan 0013, sections 2 and 3). Plain CommonJS so both the plain-node
// snapshot/restore scripts and the ts-node seed CLIs can require it before
// anything touches a database.
//
// It reads the SAME files each service reads through its data-source.ts, plus an
// opt-in `.env.test` override selected by LUNA_ENV=test. dotenv never overwrites
// an already-set variable, so the FIRST file to set a key wins: loading
// `.env.test` first makes the test database URL win over the service's own
// `.env`, which is the whole "connection string swap" mechanism (plan 0013,
// section 3.1) with no code branching.

const { config: loadEnv } = require('dotenv');

/** The three database-owning services and the env var each exposes its URL as. */
const SERVICES = {
  auth: { envDir: 'apps/luna-shopper-backend/auth', urlVar: 'AUTH_DB_URL' },
  core: { envDir: 'apps/luna-shopper-backend/core', urlVar: 'CORE_DB_URL' },
  catalog: { envDir: 'apps/luna-shopper-backend/catalog', urlVar: 'CATALOG_DB_URL' },
};

/** Every service that owns a database, in a safe seed/insert order (auth first). */
const SERVICE_ORDER = ['auth', 'catalog', 'core'];

function isTestEnv() {
  return process.env['LUNA_ENV'] === 'test';
}

function loadServiceEnv(service) {
  const svc = SERVICES[service];
  if (!svc) {
    throw new Error(`Unknown Luna Shopper service '${service}'`);
  }
  if (isTestEnv()) {
    loadEnv({ path: `${svc.envDir}/.env.test` });
  }
  loadEnv({ path: `${svc.envDir}/.env` });
  loadEnv({ path: 'apps/luna-shopper-backend/.env.luna-shopper-backend' });
  return svc;
}

function resolveDbUrl(service) {
  const svc = loadServiceEnv(service);
  const url = process.env[svc.urlVar];
  if (!url) {
    throw new Error(
      `${svc.urlVar} is not set. Copy ${svc.envDir}/.env.example to ` +
        `${svc.envDir}/.env` +
        (isTestEnv()
          ? `, and ${svc.envDir}/.env.test.example to ${svc.envDir}/.env.test ` +
            `for the LUNA_ENV=test database.`
          : '.')
    );
  }
  return url;
}

module.exports = {
  SERVICES,
  SERVICE_ORDER,
  isTestEnv,
  loadServiceEnv,
  resolveDbUrl,
};
