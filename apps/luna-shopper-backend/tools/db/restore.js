// `pg_restore` a named or latest snapshot back into the Luna Shopper databases
// (plan 0013, section 3.2). The other half of the BACKUP concern: it puts the
// databases back to exactly the captured state.
//
//   nx run luna-shopper-backend:db:restore              # newest snapshot
//   nx run luna-shopper-backend:db:restore -- initial   # newest snapshot labelled 'initial'
//   nx run luna-shopper-backend:db:restore -- --dir apps/luna-shopper-backend/.snapshots/initial-...
//
// Restoring the `initial` snapshot (captured right after the first seed) IS the
// development reset (plan 0013, section 3.2): there is no separate truncate and
// reseed path. It is default-deny guarded and never runs against production.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { SERVICE_ORDER, resolveDbUrl } = require('./env');
const { assertSafeTarget } = require('./guard');

const SNAPSHOT_ROOT = 'apps/luna-shopper-backend/.snapshots';

function parseArgs(argv) {
  const args = { label: null, dir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') {
      args.dir = argv[++i];
    } else if (a.startsWith('--dir=')) {
      args.dir = a.slice('--dir='.length);
    } else if (a === '--label') {
      args.label = argv[++i];
    } else if (a.startsWith('--label=')) {
      args.label = a.slice('--label='.length);
    } else if (!a.startsWith('-') && a !== 'latest') {
      args.label = a; // bare positional label, e.g. `db:restore initial`
    }
  }
  return args;
}

function listSnapshotDirs() {
  if (!fs.existsSync(SNAPSHOT_ROOT)) {
    return [];
  }
  return fs
    .readdirSync(SNAPSHOT_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(SNAPSHOT_ROOT, e.name))
    .sort(); // timestamps are ISO-ish, so lexical sort is chronological
}

function resolveSnapshotDir({ label, dir }) {
  if (dir) {
    return dir;
  }
  let dirs = listSnapshotDirs();
  if (label) {
    const base = path.basename;
    dirs = dirs.filter(
      (d) => base(d).startsWith(`${label}-`) || base(d) === label
    );
  }
  return dirs.length ? dirs[dirs.length - 1] : null;
}

function assertPgToolAvailable(tool) {
  const probe = spawnSync(tool, ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    console.error(
      `[restore] '${tool}' is not available on PATH. Install the PostgreSQL\n` +
        `client tools matching the server major version (currently 16).`
    );
    process.exit(1);
  }
}

function main() {
  assertPgToolAvailable('pg_restore');

  const args = parseArgs(process.argv.slice(2));
  const dir = resolveSnapshotDir(args);
  if (!dir || !fs.existsSync(dir)) {
    console.error(
      `[restore] no snapshot found` +
        (args.label ? ` for label '${args.label}'` : '') +
        `. Take one first: nx run luna-shopper-backend:db:snapshot -- --label initial`
    );
    process.exit(1);
  }

  const restored = [];
  for (const svc of SERVICE_ORDER) {
    const file = path.join(dir, `${svc}.dump`);
    if (!fs.existsSync(file)) {
      continue; // this snapshot did not include this service
    }
    const url = resolveDbUrl(svc);
    assertSafeTarget(url, `restore the ${svc} database`);
    const result = spawnSync(
      'pg_restore',
      [
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-privileges',
        '-d',
        url,
        file,
      ],
      { stdio: 'inherit' }
    );
    if (result.status !== 0) {
      console.error(
        `[restore] pg_restore failed for ${svc} (exit ${result.status})`
      );
      process.exit(result.status || 1);
    }
    restored.push(svc);
  }

  if (!restored.length) {
    console.error(`[restore] snapshot at ${dir} contained no known dumps.`);
    process.exit(1);
  }
  console.log(`[restore] restored ${restored.join(', ')} from ${dir}`);
}

main();
