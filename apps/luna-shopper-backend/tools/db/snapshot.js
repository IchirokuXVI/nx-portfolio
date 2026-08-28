// `pg_dump` snapshot of the Luna Shopper databases to a labelled, git-ignored
// directory (plan 0013, section 3.2). This is the BACKUP concern: it captures
// whatever is currently in the databases so a later `db:restore` puts them back
// exactly, which the seeder cannot do (it only knows the rows it creates).
//
//   nx run luna-shopper-backend:db:snapshot -- --label initial
//
// It is default-deny guarded (never production) and dumps in the custom format
// so `db:restore` can `--clean` and rebuild precisely.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { SERVICE_ORDER, resolveDbUrl, isTestEnv } = require('./env');
const { assertSafeTarget } = require('./guard');

const SNAPSHOT_ROOT = 'apps/luna-shopper-backend/.snapshots';

function parseArgs(argv) {
  const args = { label: 'snapshot' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--label') {
      args.label = argv[++i];
    } else if (a.startsWith('--label=')) {
      args.label = a.slice('--label='.length);
    } else if (!a.startsWith('-')) {
      // Bare positional is treated as the label (e.g. `db:snapshot initial`).
      args.label = a;
    }
  }
  return args;
}

function sanitizeLabel(label) {
  return String(label || 'snapshot').replace(/[^a-zA-Z0-9._-]/g, '-');
}

function assertPgToolAvailable(tool) {
  const probe = spawnSync(tool, ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    console.error(
      `[snapshot] '${tool}' is not available on PATH. Install the PostgreSQL\n` +
        `client tools (they must match the server major version, currently 16):\n` +
        `  macOS:   brew install libpq && brew link --force libpq\n` +
        `  Debian:  apt-get install postgresql-client-16\n` +
        `  Windows: install PostgreSQL and add its bin/ to PATH.`
    );
    process.exit(1);
  }
}

function main() {
  assertPgToolAvailable('pg_dump');

  const { label } = parseArgs(process.argv.slice(2));
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(SNAPSHOT_ROOT, `${sanitizeLabel(label)}-${timestamp}`);
  fs.mkdirSync(dir, { recursive: true });

  const dumped = [];
  for (const svc of SERVICE_ORDER) {
    const url = resolveDbUrl(svc);
    assertSafeTarget(url, `snapshot the ${svc} database`);
    const file = path.join(dir, `${svc}.dump`);
    const result = spawnSync(
      'pg_dump',
      ['-d', url, '-Fc', '--no-owner', '--no-privileges', '-f', file],
      { stdio: 'inherit' }
    );
    if (result.status !== 0) {
      console.error(
        `[snapshot] pg_dump failed for ${svc} (exit ${result.status})`
      );
      process.exit(result.status || 1);
    }
    dumped.push(svc);
  }

  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify(
      {
        label: sanitizeLabel(label),
        createdAt: new Date().toISOString(),
        env: isTestEnv() ? 'test' : 'default',
        services: dumped,
      },
      null,
      2
    )
  );

  console.log(`[snapshot] wrote ${dumped.join(', ')} to ${dir}`);
}

main();
